import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { oneBot11Id, type AgentOneBot11ConnectionConfig } from "./AgentOneBot11ConnectionConfig.js";
import type { AgentChannelConnectionState } from "../AgentChannelTypes.js";

interface PendingAction {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface ClientHandlers {
  readonly login: (value: unknown) => string;
  readonly status: (value: unknown) => void;
  readonly event: (value: Record<string, unknown>) => Promise<void>;
  readonly state: (state: AgentChannelConnectionState) => void;
  readonly error: (error: unknown) => void;
}

/** Forward OB11 WebSocket plus an explicitly selected action transport. No resend queue. */
export class AgentOneBot11ClientTransport {
  private socket?: WebSocket;
  private readonly pending = new Map<string, PendingAction>();
  private controller?: AbortController;
  private running?: Promise<void>;
  private accepting = false;
  private sessionSignal?: AbortSignal;
  private stable = false;

  constructor(
    private readonly config: AgentOneBot11ConnectionConfig,
    private readonly handlers: ClientHandlers,
  ) {}

  start(signal: AbortSignal): void {
    if (this.running || signal.aborted) return;
    this.controller = new AbortController();
    const connectionSignal = AbortSignal.any([signal, this.controller.signal]);
    this.running = this.run(connectionSignal).finally(() => {
      this.running = undefined;
    });
  }

  async stop(): Promise<void> {
    this.controller?.abort();
    this.socket?.terminate();
    await this.running;
  }

  async action(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.accepting || this.socket?.readyState !== WebSocket.OPEN)
      throw new Error("The external OneBot account is not connected.");
    return this.request(action, params);
  }

  private async run(signal: AbortSignal): Promise<void> {
    let attempts = 0;
    while (!signal.aborted) {
      this.handlers.state(attempts ? "reconnecting" : "connecting");
      try {
        await this.session(signal);
      } catch (error) {
        if (!signal.aborted) this.handlers.error(error);
      }
      if (signal.aborted) break;
      if (this.stable) attempts = 0;
      this.handlers.state("reconnecting");
      const ceiling = Math.min(
        this.config.maxReconnectDelayMs,
        this.config.reconnectDelayMs * 2 ** Math.min(attempts++, 30),
      );
      try {
        await delay(Math.max(this.config.reconnectDelayMs, Math.random() * ceiling), undefined, { signal });
      } catch (error) {
        if (!signal.aborted) throw error;
      }
    }
    this.handlers.state("stopped");
  }

  private async session(signal: AbortSignal): Promise<void> {
    const sessionAbort = new AbortController();
    this.sessionSignal = AbortSignal.any([signal, sessionAbort.signal]);
    const socket = new WebSocket(this.config.wsUrl, {
      headers: this.config.wsToken ? { Authorization: `Bearer ${this.config.wsToken}` } : {},
      handshakeTimeout: this.config.requestTimeoutMs,
      followRedirects: false,
    });
    this.socket = socket;
    this.accepting = false;
    this.stable = false;
    const buffered: Record<string, unknown>[] = [];
    let work = Promise.resolve();
    let accountId: string | undefined;
    const dispatch = (event: Record<string, unknown>) => {
      if (oneBot11Id(event.self_id) !== accountId) {
        socket.terminate();
        throw new Error("OneBot event self_id does not match the authenticated account.");
      }
      work = work.then(() => this.handlers.event(event)).catch((error: unknown) => this.handlers.error(error));
    };
    const abort = () => socket.terminate();
    signal.addEventListener("abort", abort, { once: true });
    const closed = new Promise<void>((resolve) =>
      socket.once("close", () => {
        this.accepting = false;
        for (const entry of this.pending.values()) {
          clearTimeout(entry.timer);
          entry.reject(uncertain("OneBot connection closed before an action receipt arrived."));
        }
        this.pending.clear();
        resolve();
      }),
    );
    socket.on("message", (bytes) => {
      try {
        const payload = record(JSON.parse(bytes.toString()));
        if (typeof payload.post_type === "string") {
          if (this.accepting) dispatch(payload);
          else buffered.push(payload);
          return;
        }
        if (typeof payload.echo !== "string") return;
        const pending = this.pending.get(payload.echo);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(payload.echo);
        try {
          pending.resolve(actionResult(payload));
        } catch (error) {
          pending.reject(asError(error));
        }
      } catch (error) {
        socket.terminate();
        this.handlers.error(error);
      }
    });
    // The open promise handles initial errors; subsequent errors also close the socket.
    socket.on("error", () => socket.terminate());
    let timer: ReturnType<typeof setInterval> | undefined;
    let pong = true;
    let checking = false;
    socket.on("pong", () => {
      pong = true;
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
        socket.once("close", () => reject(new Error("OneBot connection closed during handshake.")));
      });
      if (signal.aborted) return;
      const login = await this.request("get_login_info", {});
      if (socket.readyState !== WebSocket.OPEN || signal.aborted) return;
      accountId = this.handlers.login(login);
      const status = await this.request("get_status", {});
      if (socket.readyState !== WebSocket.OPEN || signal.aborted) return;
      for (const event of buffered.splice(0)) dispatch(event);
      this.accepting = true;
      this.handlers.status(status);
      timer = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (!pong) {
          socket.terminate();
          return;
        }
        pong = false;
        socket.ping();
        if (checking) return;
        checking = true;
        void this.request("get_status", {})
          .then((value) => {
            if (socket.readyState !== WebSocket.OPEN || sessionAbort.signal.aborted) return;
            this.handlers.status(value);
            this.stable = true;
          })
          .catch((error: unknown) => {
            if (sessionAbort.signal.aborted) return;
            this.handlers.error(error);
            socket.terminate();
          })
          .finally(() => {
            checking = false;
          });
      }, this.config.requestTimeoutMs);
      timer.unref();
      await closed;
      if (!signal.aborted) throw new Error("The external OneBot WebSocket disconnected.");
    } finally {
      clearInterval(timer);
      sessionAbort.abort();
      this.accepting = false;
      signal.removeEventListener("abort", abort);
      socket.terminate();
      await closed;
      await work;
      if (this.socket === socket) this.socket = undefined;
    }
  }

  private async request(action: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.config.actionTransport === "http") {
      const base = new URL(this.config.httpUrl!);
      base.pathname = `${base.pathname.replace(/\/$/u, "")}/${action}`;
      try {
        const response = await fetch(base, {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            ...(this.config.httpToken ? { Authorization: `Bearer ${this.config.httpToken}` } : {}),
          },
          body: JSON.stringify(params),
          signal: AbortSignal.any([this.sessionSignal!, AbortSignal.timeout(this.config.requestTimeoutMs)]),
        });
        if (response.status >= 500 || response.status === 408)
          throw uncertain(`OneBot HTTP ended without a confirmed action result (${response.status}).`);
        if (!response.ok)
          throw Object.assign(new Error(`OneBot HTTP action rejected (${response.status}).`), { retryable: false });
        return actionResult(record(await response.json()));
      } catch (error) {
        if (error instanceof Error && "retryable" in error) throw error;
        throw uncertain("OneBot HTTP action ended without a valid receipt.");
      }
    }
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("OneBot WebSocket is not open.");
    const echo = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(uncertain("OneBot action receipt timed out; delivery may have completed."));
      }, this.config.requestTimeoutMs);
      this.pending.set(echo, { resolve, reject, timer });
      socket.send(JSON.stringify({ action, params, echo }), (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(echo);
        reject(uncertain("OneBot action write ended without a receipt."));
      });
    });
  }
}

export function oneBot11Record(value: unknown): Record<string, unknown> {
  return record(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a OneBot object payload.");
  return value as Record<string, unknown>;
}

function actionResult(payload: Record<string, unknown>): unknown {
  if (
    typeof payload.retcode !== "number" ||
    (payload.status !== "ok" && payload.status !== "failed" && payload.status !== "async")
  )
    throw uncertain("OneBot returned no valid action result envelope.");
  if (payload.status === "async" || payload.retcode === 1)
    throw uncertain("OneBot accepted an asynchronous action without a final receipt.");
  if (payload.status !== "ok" || payload.retcode !== 0) {
    throw Object.assign(new Error(`OneBot action rejected (retcode ${String(payload.retcode)}).`), {
      retryable: false,
    });
  }
  return payload.data;
}

function uncertain(message: string): Error {
  return Object.assign(new Error(message), { code: "ECONNRESET" });
}
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
