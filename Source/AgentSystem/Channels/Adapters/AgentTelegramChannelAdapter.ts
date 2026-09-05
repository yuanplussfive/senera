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
import { convertAgentChannelMarkdown } from "../AgentChannelText.js";

export const TelegramChannelAdapterDefaults = Object.freeze({
  apiBase: "https://api.telegram.org",
  pollTimeoutSeconds: 30,
  pollIntervalMs: 300,
  conflictRetryDelayMs: 15_000,
  maxOngoingConflicts: 5,
  networkBackoffBaseMs: 1_000,
  networkBackoffMaxMs: 45_000,
  webhookSecretHeader: "X-Telegram-Bot-Api-Secret-Token",
});

export interface AgentTelegramChannelAdapterOptions {
  readonly token: string;
  readonly mode?: "long_polling" | "webhook";
  readonly webhookSecret?: string;
  readonly webhookUrl?: string;
  readonly apiBase?: string;
  readonly pollTimeoutSeconds?: number;
  readonly pollIntervalMs?: number;
  readonly conflictRetryDelayMs?: number;
  readonly maxOngoingConflicts?: number;
  readonly networkBackoffBaseMs?: number;
  readonly networkBackoffMaxMs?: number;
  readonly transport?: AgentChannelHttpTransport;
  readonly now?: () => Date;
}

interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: TelegramMessage;
  readonly channel_post?: TelegramMessage;
}

interface TelegramMessage {
  readonly message_id: number;
  readonly chat: {
    readonly id: number;
    readonly type: "private" | "group" | "supergroup" | "channel";
    readonly title?: string;
  };
  readonly from?: {
    readonly id: number;
    readonly first_name?: string;
    readonly last_name?: string;
    readonly username?: string;
    readonly is_bot?: boolean;
  };
  readonly text?: string;
  readonly reply_to_message?: { readonly message_id: number };
}

/**
 * Telegram bot adapter. Long polling is the default transport (works behind
 * NAT without public URLs and tolerates interruptions); webhook mode is
 * selected explicitly and registered on connect. Flood control and network
 * failures use injectable retry policies instead of hard-coded sleeps.
 */
export class AgentTelegramChannelAdapter implements AgentChannelAdapter {
  readonly kind = AgentChannelKinds.Telegram;
  readonly capabilities: AgentChannelCapabilities = {
    splitsLongMessages: true,
    maxMessageLength: 4_096,
    supportsEdit: true,
    supportsDraft: false,
    markdown: "markdown_v2",
    commandPrefix: "/",
  };

  private handlers?: AgentChannelAdapterHandlers;
  private readonly token: string;
  private readonly transport: AgentChannelHttpTransport;
  private readonly pollTimeoutSeconds: number;
  private readonly pollIntervalMs: number;
  private readonly conflictRetryDelayMs: number;
  private readonly maxOngoingConflicts: number;
  private readonly networkBackoffBaseMs: number;
  private readonly networkBackoffMaxMs: number;
  private readonly apiBase: string;
  private pollOffset = 0;
  private internal?: AbortController;
  private connected = false;
  private readonly now: () => Date;

  constructor(options: AgentTelegramChannelAdapterOptions) {
    this.token = options.token.trim();
    if (!this.token) throw new Error("Telegram bot token is required.");
    this.secret = options.webhookSecret;
    this.webhookUrl = options.webhookUrl;
    this.apiBase = stripTrailingSlash(options.apiBase ?? TelegramChannelAdapterDefaults.apiBase);
    this.transport = options.transport ?? new AgentChannelFetchTransport();
    this.pollTimeoutSeconds = positive(
      options.pollTimeoutSeconds ?? TelegramChannelAdapterDefaults.pollTimeoutSeconds,
      "pollTimeoutSeconds",
    );
    this.pollIntervalMs = nonNegative(
      options.pollIntervalMs ?? TelegramChannelAdapterDefaults.pollIntervalMs,
      "pollIntervalMs",
    );
    this.conflictRetryDelayMs = positive(
      options.conflictRetryDelayMs ?? TelegramChannelAdapterDefaults.conflictRetryDelayMs,
      "conflictRetryDelayMs",
    );
    this.maxOngoingConflicts = positive(
      options.maxOngoingConflicts ?? TelegramChannelAdapterDefaults.maxOngoingConflicts,
      "maxOngoingConflicts",
    );
    this.networkBackoffBaseMs = positive(
      options.networkBackoffBaseMs ?? TelegramChannelAdapterDefaults.networkBackoffBaseMs,
      "networkBackoffBaseMs",
    );
    this.networkBackoffMaxMs = positive(
      options.networkBackoffMaxMs ?? TelegramChannelAdapterDefaults.networkBackoffMaxMs,
      "networkBackoffMaxMs",
    );
    this.now = options.now ?? (() => new Date());
  }

  bind(handlers: AgentChannelAdapterHandlers): void {
    this.handlers = handlers;
  }

  async connect(signal: AbortSignal): Promise<void> {
    this.internal = new AbortController();
    signal.addEventListener("abort", () => this.internal?.abort(), { once: true });
    const me = await this.call("getMe", {});
    if (!me || me.ok !== true) {
      throw new Error("Telegram token validation failed (getMe rejected).");
    }
    this.connected = true;
    if (!this.internal.signal.aborted) {
      void this.pollLoop(this.internal.signal).catch((error) => this.handlers?.onFatal(error, this.kind));
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.internal?.abort();
  }

  async handleWebhookUpdate(
    payload: unknown,
    rawBody: string,
    headers: Record<string, string | string[]>,
  ): Promise<boolean> {
    const expected = this.webhookSecret;
    if (expected) {
      const actual = headerValue(headers, TelegramChannelAdapterDefaults.webhookSecretHeader);
      if (actual !== expected) {
        throw new Error("Telegram webhook rejected: mismatched secret token.");
      }
    }
    void rawBody;
    const update = payload as TelegramUpdate;
    if (!update || typeof update.update_id !== "number") return false;
    await this.processUpdate(update);
    return true;
  }

  private get webhookSecret(): string | undefined {
    return this.secret;
  }

  private secret?: string;

  async send(
    source: AgentChannelSource,
    content: string,
    options?: AgentChannelSendReplyOptions,
  ): Promise<AgentChannelSendResult> {
    const formatted = convertAgentChannelMarkdown(content, "markdown_v2");
    const payload: Record<string, unknown> = {
      chat_id: telegramTargetId(source),
      text: formatted,
    };
    if (options?.replyToMessageId && source.chatType !== AgentChannelChatTypes.Channel) {
      payload.reply_to_message_id = options.replyToMessageId;
    }
    try {
      const response = await this.call("sendMessage", payload);
      const messageId = messageIdOf(response);
      return messageId ? { kind: "sent", messageId: String(messageId) } : { kind: "unsupported" };
    } catch (error) {
      if (error instanceof AgentChannelHttpError && error.status === 400) {
        // MarkdownV2 is strict; a model artifact that defeats our escaping
        // degrades to plain text instead of blocking the answer.
        payload.parse_mode = undefined;
        const response = await this.call("sendMessage", payload);
        const messageId = messageIdOf(response);
        return messageId ? { kind: "sent", messageId: String(messageId) } : { kind: "unsupported" };
      }
      if (error instanceof AgentChannelHttpError && error.status === 429) {
        const retryAfter = retryAfterOf(error.body);
        throw createFloodError("Telegram flood control.", retryAfter);
      }
      throw error;
    }
  }

  async edit(source: AgentChannelSource, messageId: string, content: string): Promise<AgentChannelSendResult> {
    const payload: Record<string, unknown> = {
      chat_id: telegramTargetId(source),
      message_id: Number(messageId),
      text: convertAgentChannelMarkdown(content, "markdown_v2"),
    };
    try {
      await this.call("editMessageText", payload);
      return { kind: "edited", messageId };
    } catch (error) {
      if (error instanceof AgentChannelHttpError && error.status === 400) {
        payload.parse_mode = undefined;
        await this.call("editMessageText", payload);
        return { kind: "edited", messageId };
      }
      throw error;
    }
  }

  async registerWebhook(): Promise<boolean> {
    const url = this.webhookUrl;
    if (!url) throw new Error("Telegram webhook mode requires webhookUrl.");
    if (!this.connected) throw new Error("Telegram adapter must be connected before registering a webhook.");
    const response = await this.call("setWebhook", {
      url,
      ...(this.secret ? { secret_token: this.secret } : {}),
    });
    return response?.ok === true;
  }

  private webhookUrl?: string;

  private async pollLoop(signal: AbortSignal): Promise<void> {
    let ongoingConflicts = 0;
    let networkBackoffMs = this.networkBackoffBaseMs;
    while (!signal.aborted && this.connected) {
      try {
        const response = await this.call("getUpdates", {
          timeout: this.pollTimeoutSeconds,
          offset: this.pollOffset,
          allowed_updates: JSON.stringify(["message", "channel_post"]),
        });
        if (response?.ok !== true || !Array.isArray(response.result)) {
          await sleep(this.pollIntervalMs);
          continue;
        }
        ongoingConflicts = 0;
        networkBackoffMs = this.networkBackoffBaseMs;
        for (const update of response.result as TelegramUpdate[]) {
          if (typeof update.update_id === "number") {
            this.pollOffset = Math.max(this.pollOffset, update.update_id + 1);
          }
          await this.processUpdate(update);
        }
        await sleep(this.pollIntervalMs);
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof AgentChannelHttpError && error.status === 409) {
          ongoingConflicts += 1;
          if (ongoingConflicts >= this.maxOngoingConflicts) {
            this.handlers?.onFatal?.(
              new Error(
                `Telegram long-polling keeps conflicting after ${this.maxOngoingConflicts} attempts (another bot instance is likely active).`,
              ),
              this.kind,
            );
            ongoingConflicts = 0;
          }
          await sleep(this.conflictRetryDelayMs);
          continue;
        }
        if (error instanceof AgentChannelHttpError && error.status === 429) {
          const retryAfter = retryAfterOf(error.body) ?? 1;
          await sleep(retryAfter * 1_000);
          continue;
        }
        await sleep(networkBackoffMs);
        networkBackoffMs = Math.min(networkBackoffMs * 2, this.networkBackoffMaxMs);
      }
    }
  }

  private async processUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message ?? update.channel_post;
    if (!message || !message.chat) return;
    if (!message.text && !message.chat.type) return;
    const source = telegramSource(message);
    const inbound: AgentChannelInboundMessage = {
      source,
      text: message.text ?? "",
      replyToMessageId: message.reply_to_message?.message_id ? String(message.reply_to_message.message_id) : undefined,
      sentAt: new Date(this.now().getTime()).toISOString(),
    };
    if (this.handlers) {
      await this.handlers.onMessage(inbound);
    }
  }

  private async call(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<{ ok?: boolean; result?: unknown; description?: string } | undefined> {
    const response = await this.transport.request(`${this.apiBase}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: (method === "getUpdates" ? this.pollTimeoutSeconds : 30) * 1_000 + 5_000,
    });
    return response.body as { ok?: boolean; result?: unknown; description?: string } | undefined;
  }
}

function telegramSource(message: TelegramMessage): AgentChannelSource {
  const chatType = toChannelChatType(message.chat.type);
  return {
    platform: AgentChannelKinds.Telegram,
    chatType,
    chatId: String(message.chat.id),
    userId: message.from ? String(message.from.id) : String(message.chat.id),
    messageId: String(message.message_id),
    displayName: message.from?.username ?? message.chat.title ?? message.from?.first_name,
  };
}

function toChannelChatType(
  telegramType: TelegramMessage["chat"]["type"],
): import("../AgentChannelTypes.js").AgentChannelChatType {
  switch (telegramType) {
    case "private":
      return AgentChannelChatTypes.Direct;
    case "group":
    case "supergroup":
      return AgentChannelChatTypes.Group;
    case "channel":
      return AgentChannelChatTypes.Channel;
  }
}

function telegramTargetId(source: AgentChannelSource): string {
  return source.chatType === AgentChannelChatTypes.Direct ? source.userId : source.chatId;
}

function messageIdOf(response: { ok?: boolean; result?: unknown } | undefined): string | undefined {
  const result = response?.result as { message_id?: number } | undefined;
  return result && typeof result.message_id === "number" ? String(result.message_id) : undefined;
}

function retryAfterOf(body: unknown): number | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value = (body as { retry_after?: unknown }).retry_after;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function headerValue(headers: Record<string, string | string[]>, name: string): string | undefined {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  if (!key) return undefined;
  const value = headers[key];
  return Array.isArray(value) ? value[0] : value;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`);
  return value;
}

function nonNegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer.`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
