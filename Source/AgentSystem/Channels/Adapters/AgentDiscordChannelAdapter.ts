import { EventEmitter } from "node:events";
import WebSocket from "ws";
import {
  AgentChannelChatTypes,
  AgentChannelKinds,
  type AgentChannelAdapter,
  type AgentChannelAdapterHandlers,
  type AgentChannelCapabilities,
  type AgentChannelInboundMessage,
  type AgentChannelSendReplyOptions,
  type AgentChannelSendResult,
  type AgentChannelSource,
} from "../AgentChannelTypes.js";
import {
  AgentChannelHttpError,
  type AgentChannelHttpTransport,
  AgentChannelFetchTransport,
} from "../AgentChannelHttpTransport.js";
import { createFloodError } from "../AgentChannelDelivery.js";

export const DiscordChannelAdapterDefaults = Object.freeze({
  apiBase: "https://discord.com/api/v10",
  intents: 0,
  ackTimeoutMs: 10_000,
  maxMissedAcks: 2,
  reconnectBackoffBaseMs: 1_000,
  reconnectBackoffMaxMs: 60_000,
});

export interface AgentDiscordChannelAdapterOptions {
  readonly token: string;
  readonly apiBase?: string;
  readonly transport?: AgentChannelHttpTransport;
  readonly intents?: number;
  readonly ackTimeoutMs?: number;
  readonly maxMissedAcks?: number;
  readonly reconnectBackoffBaseMs?: number;
  readonly reconnectBackoffMaxMs?: number;
  readonly now?: () => Date;
}

interface DiscordGatewayPayload {
  readonly op: number;
  readonly d?: unknown;
  readonly t?: string;
  readonly s?: number;
}

interface DiscordHelloData {
  readonly heartbeat_interval: number;
}

interface DiscordReadyData {
  readonly session_id: string;
}

interface DiscordMessageCreateData {
  readonly id: string;
  readonly channel_id: string;
  readonly guild_id?: string;
  readonly content?: string;
  readonly author?: {
    readonly id: string;
    readonly username?: string;
    readonly bot?: boolean;
  };
  readonly channel_type?: number;
  readonly message_reference?: { readonly message_id?: string };
}

const GatewayOp = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  Resume: 6,
  Reconnect: 7,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
} as const;

const GatewayDispatch = {
  Ready: "READY",
  MessageCreate: "MESSAGE_CREATE",
} as const;

const DirectMessageChannelType = 1;
const MinGatewayHeartbeatIntervalMs = 1_000;
const MaxGatewayHeartbeatIntervalMs = 120_000;
const MaxGatewayWaitTimeoutMs = 120_000;

/**
 * Discord bot adapter over the gateway WebSocket. Owns the full protocol:
 * identify/resume, heartbeat supervision with ACK accounting, reconnection
 * with exponential backoff, and authenticated REST delivery for sends and
 * edits. The token is never logged.
 */
export class AgentDiscordChannelAdapter implements AgentChannelAdapter {
  readonly kind = AgentChannelKinds.Discord;
  readonly capabilities: AgentChannelCapabilities = {
    splitsLongMessages: true,
    maxMessageLength: 2_000,
    supportsEdit: true,
    supportsDraft: false,
    markdown: "markdown",
    commandPrefix: "/",
  };

  private handlers?: AgentChannelAdapterHandlers;
  private readonly token: string;
  private readonly transport: AgentChannelHttpTransport;
  private readonly apiBase: string;
  private readonly intents: number;
  private readonly ackTimeoutMs: number;
  private readonly maxMissedAcks: number;
  private readonly reconnectBackoffBaseMs: number;
  private readonly reconnectBackoffMaxMs: number;
  private readonly now: () => Date;
  private gatewayHost?: string;
  private internal?: AbortController;
  private sessionId?: string;
  private lastSequence?: number;
  private gatewayPromise?: Promise<void>;

  constructor(options: AgentDiscordChannelAdapterOptions) {
    this.token = options.token.trim();
    if (!this.token) throw new Error("Discord bot token is required.");
    this.apiBase = stripTrailingSlash(options.apiBase ?? DiscordChannelAdapterDefaults.apiBase);
    this.transport = options.transport ?? new AgentChannelFetchTransport();
    this.intents = options.intents ?? DiscordChannelAdapterDefaults.intents;
    this.ackTimeoutMs = positive(options.ackTimeoutMs ?? DiscordChannelAdapterDefaults.ackTimeoutMs, "ackTimeoutMs");
    this.maxMissedAcks = positive(
      options.maxMissedAcks ?? DiscordChannelAdapterDefaults.maxMissedAcks,
      "maxMissedAcks",
    );
    this.reconnectBackoffBaseMs = positive(
      options.reconnectBackoffBaseMs ?? DiscordChannelAdapterDefaults.reconnectBackoffBaseMs,
      "reconnectBackoffBaseMs",
    );
    this.reconnectBackoffMaxMs = positive(
      options.reconnectBackoffMaxMs ?? DiscordChannelAdapterDefaults.reconnectBackoffMaxMs,
      "reconnectBackoffMaxMs",
    );
    this.now = options.now ?? (() => new Date());
  }

  bind(handlers: AgentChannelAdapterHandlers): void {
    this.handlers = handlers;
  }

  async connect(signal: AbortSignal): Promise<void> {
    this.internal = new AbortController();
    signal.addEventListener("abort", () => this.internal?.abort(), { once: true });
    const gateway = await this.discoverGateway();
    this.gatewayHost = sanitizeGatewayUrl(gateway.url);
    this.gatewayPromise = this.gatewayLoop(this.internal.signal).catch((error) => {
      this.handlers?.onFatal?.(error, this.kind);
    });
  }

  async disconnect(): Promise<void> {
    this.internal?.abort();
    if (this.gatewayPromise) {
      try {
        await this.gatewayPromise;
      } catch {
        // Best effort; a dead gateway already reported itself.
      }
    }
  }

  async send(
    source: AgentChannelSource,
    content: string,
    options?: AgentChannelSendReplyOptions,
  ): Promise<AgentChannelSendResult> {
    const targetId = discordTargetId(source);
    if (!targetId) throw new Error("Discord send requires a channel or user target.");
    const payload: Record<string, unknown> = { content };
    if (options?.replyToMessageId) payload.message_reference = { message_id: options.replyToMessageId };
    try {
      const response = (await this.rest("POST", `/channels/${targetId}/messages`, payload)) as { id?: string };
      return response.id ? { kind: "sent", messageId: response.id } : { kind: "unsupported" };
    } catch (error) {
      throw translateRestError(error);
    }
  }

  async edit(source: AgentChannelSource, messageId: string, content: string): Promise<AgentChannelSendResult> {
    const targetId = discordTargetId(source);
    if (!targetId) throw new Error("Discord edit requires a channel or user target.");
    await this.rest("PATCH", `/channels/${targetId}/messages/${messageId}`, { content });
    return { kind: "edited", messageId };
  }

  private async discoverGateway(): Promise<{ url: string }> {
    const body = (await this.rest("GET", "/gateway/bot", undefined)) as { url?: string };
    if (!body?.url) throw new Error("Discord gateway discovery returned no URL.");
    return { url: body.url };
  }

  private async gatewayLoop(signal: AbortSignal): Promise<void> {
    let backoffMs = this.reconnectBackoffBaseMs;
    while (!signal.aborted) {
      try {
        await this.openGatewaySession(signal);
        backoffMs = this.reconnectBackoffBaseMs;
      } catch (error) {
        if (signal.aborted) return;
        this.handlers?.onFatal?.(new Error(`Discord gateway session failed: ${describe(error)}`), this.kind);
        await sleepWithAbort(backoffMs, signal);
        backoffMs = Math.min(backoffMs * 2, this.reconnectBackoffMaxMs);
      }
    }
  }

  private async openGatewaySession(signal: AbortSignal): Promise<void> {
    if (!this.gatewayHost) throw new Error("Discord gateway URL is not resolved.");
    const socket = new WebSocket(this.gatewayHost);
    socket.binaryType = "arraybuffer";
    const events = new EventEmitter();
    let hello: DiscordHelloData | undefined;
    let acked = 0;
    let missedAcks = 0;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

    socket.on("message", (data: WebSocket.RawData) => {
      const payload = parseGatewayPayload(data);
      if (payload === undefined) return;
      if (typeof payload.s === "number") this.lastSequence = payload.s;
      switch (payload.op) {
        case GatewayOp.Heartbeat:
          socket.send(JSON.stringify({ op: 11 }));
          return;
        case GatewayOp.HeartbeatAck:
          acked += 1;
          missedAcks = 0;
          return;
        case GatewayOp.Hello:
          hello = (payload.d ?? {}) as DiscordHelloData;
          startHeartbeat();
          return;
        case GatewayOp.Reconnect:
          socket.close(4_000);
          return;
        case GatewayOp.InvalidSession:
          if (payload.d === false) {
            this.sessionId = undefined;
            this.lastSequence = undefined;
          }
          socket.close();
          return;
        case GatewayOp.Dispatch:
          if (typeof payload.t !== "string") return;
          acked += 1;
          missedAcks = 0;
          events.emit("dispatch", payload);
          this.onDispatch(payload);
          return;
        default:
          return;
      }
    });
    socket.on("close", () => events.emit("closed"));
    socket.on("error", (error) => events.emit("error", error));

    const startHeartbeat = (): void => {
      if (!hello || heartbeatTimer) return;
      heartbeatTimer = setInterval(
        () => {
          socket.send(JSON.stringify({ op: 1, d: this.lastSequence ?? null }));
          const notAckedThisBeat = acked === 0;
          acked = 0;
          if (notAckedThisBeat) {
            missedAcks += 1;
            if (missedAcks >= this.maxMissedAcks) {
              // The gateway stopped acknowledging heartbeats; recycle the
              // connection so the resume path (with sequence) can take over.
              socket.terminate();
            }
          }
        },
        Math.min(Math.max(hello.heartbeat_interval, MinGatewayHeartbeatIntervalMs), MaxGatewayHeartbeatIntervalMs),
      );
      heartbeatTimer.unref?.();
    };

    try {
      await waitForOperation(socket, events, GatewayOp.Hello, this.ackTimeoutMs, "hello");

      socket.send(
        JSON.stringify(
          this.sessionId
            ? {
                op: GatewayOp.Resume,
                d: { token: this.token, session_id: this.sessionId, seq: this.lastSequence ?? null },
              }
            : {
                op: GatewayOp.Identify,
                d: {
                  token: this.token,
                  intents: this.intents,
                  properties: { os: "windows", browser: "senera", device: "senera" },
                },
              },
        ),
      );

      const ready = await waitForDispatch(events, GatewayDispatch.Ready, this.ackTimeoutMs);
      this.sessionId = ((ready.d ?? {}) as DiscordReadyData).session_id;
      startHeartbeat();

      await waitForClosed(events, signal);
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      socket.close();
    }
  }

  private onDispatch(payload: DiscordGatewayPayload): void {
    if (payload.t !== GatewayDispatch.MessageCreate) return;
    const data = payload.d as DiscordMessageCreateData;
    if (!data || !data.author || data.author.bot === true) return;
    const source = discordSource(data);
    const inbound: AgentChannelInboundMessage = {
      source,
      text: data.content ?? "",
      replyToMessageId: data.message_reference?.message_id,
      sentAt: new Date(this.now().getTime()).toISOString(),
    };
    void this.handlers?.onMessage(inbound);
  }

  private async rest(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await this.transport.request(`${this.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: 15_000,
    });
    return response.body;
  }
}

function discordSource(data: DiscordMessageCreateData): AgentChannelSource {
  const isDirect = data.channel_type === DirectMessageChannelType;
  return {
    platform: AgentChannelKinds.Discord,
    chatType: isDirect ? AgentChannelChatTypes.Direct : AgentChannelChatTypes.Channel,
    chatId: data.channel_id,
    userId: data.author?.id ?? data.channel_id,
    messageId: data.id,
    displayName: data.author?.username,
  };
}

function discordTargetId(source: AgentChannelSource): string | undefined {
  if (source.chatType === AgentChannelChatTypes.Direct) return source.userId;
  return source.threadId ?? source.chatId;
}

function parseGatewayPayload(data: WebSocket.RawData): DiscordGatewayPayload | undefined {
  const text = typeof data === "string" ? data : Buffer.from(data as Buffer).toString("utf8");
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as DiscordGatewayPayload;
    return typeof parsed.op === "number" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function waitForOperation(
  socket: WebSocket,
  events: EventEmitter,
  op: number,
  timeoutMs: number,
  label: string,
): Promise<DiscordGatewayPayload> {
  return new Promise((resolve, reject) => {
    const boundedTimeoutMs = Math.min(timeoutMs, MaxGatewayWaitTimeoutMs);
    const timer = setTimeout(() => reject(new Error(`Discord gateway ${label} timed out.`)), boundedTimeoutMs + 5_000);
    const onMessage = (data: WebSocket.RawData): void => {
      const payload = parseGatewayPayload(data);
      if (payload?.op === op) {
        cleanup();
        resolve(payload);
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClosed = (): void => {
      cleanup();
      reject(new Error(`Discord gateway closed before ${label}.`));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("error", onError);
      socket.off("close", onClosed);
      events.removeAllListeners();
    };
    socket.on("message", onMessage);
    socket.on("error", onError);
    socket.on("close", onClosed);
  });
}

function waitForDispatch(events: EventEmitter, name: string, timeoutMs: number): Promise<DiscordGatewayPayload> {
  return new Promise((resolve, reject) => {
    const boundedTimeoutMs = Math.min(timeoutMs, MaxGatewayWaitTimeoutMs);
    const timer = setTimeout(() => {
      events.removeAllListeners();
      reject(new Error(`Discord gateway dispatch ${name} timed out.`));
    }, boundedTimeoutMs + 5_000);
    events.once("dispatch", (payload: DiscordGatewayPayload) => {
      clearTimeout(timer);
      events.removeAllListeners();
      if (payload.t === name) {
        resolve(payload);
      } else {
        reject(new Error(`Discord gateway dispatch mismatch: ${String(payload.t)}.`));
      }
    });
    events.once("error", (error: Error) => {
      clearTimeout(timer);
      events.removeAllListeners();
      reject(error);
    });
  });
}

function waitForClosed(events: EventEmitter, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onClosed = (): void => resolve();
    const onAbort = (): void => {
      events.off("closed", onClosed);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    events.once("closed", onClosed);
  });
}

function translateRestError(error: unknown): unknown {
  if (error instanceof AgentChannelHttpError && error.status === 429) {
    return createFloodError("Discord rate limited.", retryAfterOf(error.body));
  }
  return error;
}

function retryAfterOf(body: unknown): number | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const ms = (body as { retry_after_ms?: unknown }).retry_after_ms;
  const seconds = (body as { retry_after?: unknown }).retry_after;
  const value = ms ?? seconds;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sanitizeGatewayUrl(url: string): string {
  return url
    .replace(/\/$/, "")
    .replace(/^http:/, "ws:")
    .replace(/^https:/, "wss:");
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`);
  return value;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
