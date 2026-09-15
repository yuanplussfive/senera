import { EventEmitter } from "node:events";
import { WebSocket as NodeWebSocket, type RawData } from "ws";
import type { AgentChannelConnectionState } from "../AgentChannelTypes.js";
import {
  QqFatalCloseCodes,
  QqGatewayDispatch,
  QqGatewayOp,
  QqSessionResetCloseCodes,
  describe,
  isRecord,
  type QqDispatchData,
  type QqGatewayPayload,
  type QqHelloData,
} from "./AgentQqProtocol.js";

export interface AgentQqGatewaySocket {
  binaryType: "arraybuffer" | "blob";
  /** Node `ws` EventEmitter methods. */
  on?(event: "message", listener: (data: RawData) => void): void;
  on?(event: "close", listener: (code?: number, reason?: unknown) => void): void;
  on?(event: "error", listener: (error: Error) => void): void;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: "message", listener: (data: RawData) => void): void;
  off?(event: "close", listener: (code?: number, reason?: unknown) => void): void;
  off?(event: "error", listener: (error: Error) => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
  /** Browser/WebSocket EventTarget methods used by alternate runtimes. */
  addEventListener?(event: string, listener: (event: unknown) => void): void;
  removeEventListener?(event: string, listener: (event: unknown) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
  send(data: string): void;
  close(code?: number): void;
  terminate?(): void;
}

export class QqGatewayClosedError extends Error {
  readonly code?: number;

  constructor(code?: number, reason?: unknown) {
    super(`QQ gateway closed${code ? ` (${code})` : ""}${reason ? `: ${String(reason)}` : "."}`);
    this.name = "QqGatewayClosedError";
    this.code = code;
  }
}

export interface QqGatewaySessionState {
  readonly sessionId?: string;
  readonly lastSequence?: number;
}

export interface QqGatewayLoopOptions {
  readonly gatewayUrl: string;
  readonly signal: AbortSignal;
  readonly createGatewaySocket?: (url: string) => AgentQqGatewaySocket;
  readonly intents: number;
  readonly ackTimeoutMs: number;
  readonly maxMissedAcks: number;
  readonly reconnectBackoffBaseMs: number;
  readonly reconnectBackoffMaxMs: number;
  readonly maxReconnectAttempts: number;
  /** Hermes-compatible guard for repeated short-lived sessions. */
  readonly quickDisconnectThresholdMs?: number;
  readonly maxQuickDisconnects?: number;
  /** Pause applied when the quick-disconnect breaker trips before retrying. */
  readonly quickDisconnectCooldownMs?: number;
  readonly getToken: () => Promise<string>;
  readonly getSession: () => QqGatewaySessionState;
  readonly setSession: (sessionId?: string, lastSequence?: number) => void;
  readonly invalidateToken: () => void;
  readonly setConnectionState: (state: AgentChannelConnectionState) => void;
  readonly onSocket: (socket: AgentQqGatewaySocket | undefined) => void;
  readonly onDispatch: (eventType: string, data: QqDispatchData) => void | Promise<void>;
  readonly onInteraction: (data: unknown) => void | Promise<void>;
  readonly onFatal: (error: Error) => void;
}

/** Runs a persistent QQ gateway session with RESUME and bounded reconnects. */
export async function runQqGatewayLoop(options: QqGatewayLoopOptions): Promise<void> {
  let backoffMs = options.reconnectBackoffBaseMs;
  let attempts = 0;
  let quickDisconnects = 0;
  const quickDisconnectThresholdMs = options.quickDisconnectThresholdMs ?? 5_000;
  const maxQuickDisconnects = options.maxQuickDisconnects ?? 3;
  const quickDisconnectCooldownMs = options.quickDisconnectCooldownMs ?? 60_000;
  const refreshReconnectBudget = (): void => {
    // A session that reached READY/RESUMED proves credentials, intents, and
    // the gateway URL are valid: reset every reconnect counter so a series of
    // healthy sessions never marches the adapter toward permanent shutdown.
    attempts = 0;
    quickDisconnects = 0;
    backoffMs = options.reconnectBackoffBaseMs;
  };
  while (!options.signal.aborted) {
    const attemptStartedAt = Date.now();
    try {
      options.setConnectionState(attempts === 0 ? "connecting" : "reconnecting");
      await openGatewaySession(options, refreshReconnectBudget);
    } catch (error) {
      if (options.signal.aborted) return;
      const durationMs = Date.now() - attemptStartedAt;
      if (durationMs < quickDisconnectThresholdMs) quickDisconnects += 1;
      else quickDisconnects = 0;
      if (quickDisconnects >= maxQuickDisconnects) {
        // A burst of short-lived sessions usually means the gateway is
        // rejecting this client (stale session, permissions, throttling)
        // rather than a transient network drop. Drop the stale session so the
        // next attempt IDENTIFYs from scratch, cool down, and keep retrying
        // instead of abandoning the channel until the next process restart.
        refreshReconnectBudget();
        options.setSession(undefined, undefined);
        options.setConnectionState("degraded");
        options.onFatal(
          new Error(
            `QQ gateway hit ${maxQuickDisconnects} quick disconnects; retrying with a fresh session in ${Math.round(quickDisconnectCooldownMs / 1_000)}s (check bot permissions and gateway configuration if this repeats).`,
          ),
        );
        await sleepWithAbort(quickDisconnectCooldownMs, options.signal);
        continue;
      }
      if (error instanceof QqGatewayClosedError && error.code === 4004) options.invalidateToken();
      if (
        error instanceof QqGatewayClosedError &&
        error.code !== undefined &&
        QqSessionResetCloseCodes.has(error.code)
      ) {
        options.setSession(undefined, undefined);
      }
      attempts += 1;
      options.setConnectionState("reconnecting");
      if (isFatalGatewayError(error) || attempts >= options.maxReconnectAttempts) {
        options.setConnectionState("degraded");
        options.onFatal(new Error(`QQ gateway stopped: ${describe(error)}`));
        return;
      }
      options.onFatal(new Error(`QQ gateway reconnecting: ${describe(error)}`));
      const waitMs =
        error instanceof QqGatewayClosedError && error.code === 4008 ? Math.max(backoffMs, 60_000) : backoffMs;
      await sleepWithAbort(waitMs, options.signal);
      backoffMs = Math.min(backoffMs * 2, options.reconnectBackoffMaxMs);
    }
  }
}

async function openGatewaySession(options: QqGatewayLoopOptions, onEstablished: () => void): Promise<void> {
  const socket = (options.createGatewaySocket ?? defaultGatewaySocket)(options.gatewayUrl);
  options.onSocket(socket);
  socket.binaryType = "arraybuffer";
  const events = new EventEmitter();
  let hello: QqHelloData | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatPending = false;
  let missedAcks = 0;
  let ready = false;
  const startHeartbeat = (): void => {
    if (!hello || heartbeatTimer || !hello.heartbeat_interval) return;
    const intervalMs = Math.max(1_000, Math.floor(hello.heartbeat_interval * 0.8));
    heartbeatTimer = setInterval(() => {
      if (heartbeatPending) {
        missedAcks += 1;
        if (missedAcks >= options.maxMissedAcks) {
          safeSocketTerminate(socket);
          return;
        }
      }
      heartbeatPending = true;
      safeSocketSend(socket, { op: QqGatewayOp.Heartbeat, d: options.getSession().lastSequence ?? null });
    }, intervalMs);
    heartbeatTimer.unref?.();
  };
  const onMessage = (data: RawData): void => {
    const payload = parseGatewayPayload(data);
    if (!payload) return;
    if (typeof payload.s === "number") options.setSession(options.getSession().sessionId, payload.s);
    events.emit("payload", payload);
    switch (payload.op) {
      case QqGatewayOp.Heartbeat:
        safeSocketSend(socket, { op: QqGatewayOp.HeartbeatAck });
        return;
      case QqGatewayOp.HeartbeatAck:
        heartbeatPending = false;
        missedAcks = 0;
        return;
      case QqGatewayOp.Hello:
        hello = isRecord(payload.d) ? (payload.d as QqHelloData) : {};
        startHeartbeat();
        return;
      case QqGatewayOp.Reconnect:
        socket.close(4_000);
        return;
      case QqGatewayOp.InvalidSession:
        if (payload.d === false) options.setSession(undefined, undefined);
        socket.close(4_009);
        return;
      case QqGatewayOp.Dispatch:
        if (typeof payload.t !== "string") return;
        if (payload.t === QqGatewayDispatch.Resumed) {
          // QQ acknowledges RESUME with a dispatch whose body is null; the
          // session is live regardless of the payload body shape.
          ready = true;
          options.setConnectionState("connected");
          return;
        }
        if (!isRecord(payload.d)) return;
        if (payload.t === QqGatewayDispatch.Ready) {
          const session = (payload.d as { session_id?: unknown }).session_id;
          options.setSession(
            typeof session === "string" && session.length > 0 ? session : options.getSession().sessionId,
            options.getSession().lastSequence,
          );
          ready = true;
          options.setConnectionState("connected");
        } else if (payload.t === QqGatewayDispatch.InteractionCreate) {
          void Promise.resolve(options.onInteraction(payload.d)).catch((error) => {
            // A callback failure must not become an unhandled rejection on the
            // long-lived Gateway task. The interaction handler is responsible
            // for ACKing first; report the follow-up failure to the adapter's
            // isolated fatal boundary instead of tearing down the socket.
            options.onFatal(new Error(`QQ interaction handler failed: ${describe(error)}`));
          });
        } else {
          void Promise.resolve(options.onDispatch(payload.t, payload.d as QqDispatchData)).catch((error) => {
            // Dispatch handlers may perform attachment downloads or STT. A
            // rejected event must be observed without terminating the socket
            // reader or creating an unhandled rejection.
            options.onFatal(new Error(`QQ dispatch handler failed: ${describe(error)}`));
          });
        }
        return;
      default:
        return;
    }
  };
  const onClose = (code?: number, reason?: unknown): void => {
    events.emit("closed", code, reason);
  };
  const onError = (error: Error): void => {
    events.emit("error", error);
  };
  const detachMessage = bindGatewayEvent(socket, "message", onMessage);
  const detachClose = bindGatewayEvent(socket, "close", onClose);
  const detachError = bindGatewayEvent(socket, "error", onError);
  try {
    const helloPayload = await waitForOperation(
      events,
      (payload) => payload.op === QqGatewayOp.Hello,
      options.ackTimeoutMs,
      "hello",
    );
    hello = isRecord(helloPayload.d) ? (helloPayload.d as QqHelloData) : {};
    startHeartbeat();
    const token = await options.getToken();
    const session = options.getSession();
    safeSocketSend(
      socket,
      session.sessionId
        ? {
            op: QqGatewayOp.Resume,
            d: { token: `QQBot ${token}`, session_id: session.sessionId, seq: session.lastSequence ?? null },
          }
        : {
            op: QqGatewayOp.Identify,
            d: {
              token: `QQBot ${token}`,
              intents: options.intents,
              shard: [0, 1],
              properties: {
                // QQ only uses these fields for client diagnostics. Keep the
                // runtime value honest so a Linux/macOS deployment is not
                // advertised as Windows in the gateway session.
                $os: process.platform,
                $browser: "senera",
                $device: "senera",
              },
            },
          },
    );
    await waitForOperation(
      events,
      (payload) =>
        payload.op === QqGatewayOp.Dispatch &&
        (payload.t === QqGatewayDispatch.Ready || payload.t === QqGatewayDispatch.Resumed),
      options.ackTimeoutMs,
      "ready",
    );
    if (!ready) throw new Error("QQ gateway did not establish a resumable session.");
    onEstablished();
    await waitForClosed(events, options.signal);
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    detachMessage();
    detachClose();
    detachError();
    options.onSocket(undefined);
    safeSocketClose(socket);
  }
}

export function defaultGatewaySocket(url: string): AgentQqGatewaySocket {
  return new NodeWebSocket(url) as unknown as AgentQqGatewaySocket;
}

function parseGatewayPayload(data: RawData): QqGatewayPayload | undefined {
  const text =
    typeof data === "string"
      ? data
      : data instanceof ArrayBuffer
        ? Buffer.from(data).toString("utf8")
        : Buffer.from(data as Buffer).toString("utf8");
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as QqGatewayPayload;
    return typeof parsed.op === "number" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function waitForOperation(
  events: EventEmitter,
  predicate: (payload: QqGatewayPayload) => boolean,
  timeoutMs: number,
  label: string,
): Promise<QqGatewayPayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`QQ gateway ${label} timed out.`));
    }, timeoutMs + 5_000);
    const onPayload = (payload: QqGatewayPayload): void => {
      if (!predicate(payload)) return;
      cleanup();
      resolve(payload);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClosed = (code?: number, reason?: unknown): void => {
      cleanup();
      reject(new QqGatewayClosedError(code, reason));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      events.off("payload", onPayload);
      events.off("error", onError);
      events.off("closed", onClosed);
    };
    events.on("payload", onPayload);
    events.on("error", onError);
    events.on("closed", onClosed);
  });
}

function waitForClosed(events: EventEmitter, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onClosed = (code?: number, reason?: unknown): void => {
      cleanup();
      reject(new QqGatewayClosedError(code, reason));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onAbort = (): void => {
      cleanup();
      resolve();
    };
    const cleanup = (): void => {
      events.off("closed", onClosed);
      events.off("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    events.on("closed", onClosed);
    events.on("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function safeSocketSend(socket: AgentQqGatewaySocket, payload: Record<string, unknown>): void {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    safeSocketTerminate(socket);
  }
}

function safeSocketClose(socket: AgentQqGatewaySocket): void {
  try {
    socket.close();
  } catch {
    safeSocketTerminate(socket);
  }
}

function safeSocketTerminate(socket: AgentQqGatewaySocket): void {
  try {
    if (typeof socket.terminate === "function") {
      socket.terminate();
      return;
    }
    socket.close();
  } catch {
    // A socket that cannot be closed is already unusable; the reconnect loop
    // will observe the surrounding timeout and create a fresh connection.
  }
}

type GatewayEventListener =
  ((data: RawData) => void) | ((code?: number, reason?: unknown) => void) | ((error: Error) => void);

/**
 * Bind either Node's EventEmitter socket or a browser-style EventTarget.
 * Electron preload bridges and test doubles often expose only one of these
 * shapes; keeping the compatibility boundary here prevents the gateway loop
 * from depending on a particular WebSocket implementation.
 */
function bindGatewayEvent(
  socket: AgentQqGatewaySocket,
  event: "message" | "close" | "error",
  listener: GatewayEventListener,
): () => void {
  if (typeof socket.on === "function") {
    socket.on(event, listener as never);
    return () => {
      if (typeof socket.off === "function") {
        socket.off(event, listener as never);
      } else if (typeof socket.removeListener === "function") {
        socket.removeListener(event, listener as never);
      }
    };
  }

  if (typeof socket.addEventListener === "function") {
    const wrapped = (eventValue: unknown): void => {
      if (event === "message") {
        const data = isRecord(eventValue) && "data" in eventValue ? eventValue.data : eventValue;
        (listener as (data: RawData) => void)(data as RawData);
        return;
      }
      if (event === "close") {
        const record = isRecord(eventValue) ? eventValue : undefined;
        (listener as (code?: number, reason?: unknown) => void)(
          typeof record?.code === "number" ? record.code : undefined,
          record?.reason,
        );
        return;
      }
      const record = isRecord(eventValue) ? eventValue : undefined;
      const error =
        record?.error instanceof Error
          ? record.error
          : eventValue instanceof Error
            ? eventValue
            : new Error("QQ gateway WebSocket error.");
      (listener as (error: Error) => void)(error);
    };
    socket.addEventListener(event, wrapped);
    return () => socket.removeEventListener?.(event, wrapped);
  }

  throw new Error("QQ gateway socket does not implement EventEmitter or EventTarget events.");
}

function isFatalGatewayError(error: unknown): boolean {
  return error instanceof QqGatewayClosedError && error.code !== undefined && QqFatalCloseCodes.has(error.code);
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
