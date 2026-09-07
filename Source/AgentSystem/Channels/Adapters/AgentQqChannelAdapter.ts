import {
  AgentChannelKinds,
  type AgentChannelAdapter,
  type AgentChannelAdapterHandlers,
  type AgentChannelAttachment,
  type AgentChannelCapabilities,
  type AgentChannelConnectionState,
  type AgentChannelInboundMessage,
  type AgentChannelKeyboard,
  type AgentChannelMedia,
  type AgentChannelSendReplyOptions,
  type AgentChannelSendResult,
  type AgentChannelSource,
  type AgentChannelWebhookResponse,
} from "../AgentChannelTypes.js";
import { AgentChannelFetchTransport, type AgentChannelHttpTransport } from "../AgentChannelHttpTransport.js";
import {
  QqGatewayDispatch,
  type QqApprovalRequest,
  type QqDispatchData,
  type QqInteractionPayload,
  type QqUpdatePromptRequest,
  type QqWebhookVerificationData,
  type QqWebhookEnvelope,
  boundedInteger,
  cleanQqContent,
  collectQqAttachments,
  createQqWebhookVerificationResponse,
  defaultQqIntents,
  describe,
  inferWebhookEventType,
  isLegacyWebhookSink,
  isRecord,
  normalizeQqAttachments,
  positive,
  qqDispatchSource,
  qqInteractionSource,
  quotedQqContent,
  sanitizeGatewayUrl,
  stringValue,
  verifyQqSignature,
} from "./AgentQqProtocol.js";
import { defaultGatewaySocket, runQqGatewayLoop, type AgentQqGatewaySocket } from "./AgentQqGateway.js";
import { AgentQqRestClient } from "./AgentQqRestClient.js";
import { AgentQqMessageClient } from "./AgentQqMessageClient.js";
import { AgentQqVoiceTranscriber } from "./AgentQqVoiceTranscriber.js";
export { QqGatewayClosedError } from "./AgentQqGateway.js";
export type { AgentQqGatewaySocket } from "./AgentQqGateway.js";
import { QqMediaUploader } from "./AgentQqMediaUploader.js";
export { QqDailyUploadLimitError } from "./AgentQqMediaUploader.js";
export {
  QqCallbackSignatures,
  QqMessageTypes,
  QqMediaTypes,
  createQqWebhookVerificationResponse,
  createQqApprovalKeyboard,
  createQqUpdatePromptKeyboard,
  verifyQqSignature,
} from "./AgentQqProtocol.js";

export const QqChannelAdapterDefaults = Object.freeze({
  tokenApiBase: "https://bots.qq.com",
  apiBase: "https://api.sgroup.qq.com",
  tokenExpirySkewMs: 5 * 60_000,
  maxContentLength: 4_000,
  ackTimeoutMs: 10_000,
  maxMissedAcks: 2,
  reconnectBackoffBaseMs: 1_000,
  reconnectBackoffMaxMs: 60_000,
  maxReconnectAttempts: 100,
  dedupWindowMs: 5 * 60_000,
  dedupMaxSize: 1_000,
  inlineMediaLimitBytes: 10_000_000,
  maxMediaBytes: 100_000_000,
  mediaUploadTimeoutMs: 120_000,
  chunkUploadTimeoutMs: 300_000,
  uploadConcurrency: 3,
  mediaCacheTtlMs: 10 * 60_000,
  typingDebounceMs: 45_000,
  quickDisconnectThresholdMs: 5_000,
  maxQuickDisconnects: 3,
  quickDisconnectCooldownMs: 60_000,
});

export interface AgentQqChannelAdapterOptions {
  readonly appId: string;
  readonly appSecret: string;
  readonly webhookSecret?: string;
  readonly mode?: "websocket" | "webhook";
  readonly tokenApiBase?: string;
  readonly apiBase?: string;
  readonly transport?: AgentChannelHttpTransport;
  readonly createGatewaySocket?: (url: string) => AgentQqGatewaySocket;
  readonly intents?: number;
  readonly ackTimeoutMs?: number;
  readonly maxMissedAcks?: number;
  readonly reconnectBackoffBaseMs?: number;
  readonly reconnectBackoffMaxMs?: number;
  readonly maxReconnectAttempts?: number;
  readonly maxMessageLength?: number;
  readonly markdownSupport?: boolean;
  readonly dedupWindowMs?: number;
  readonly dedupMaxSize?: number;
  readonly maxMediaBytes?: number;
  readonly inlineMediaLimitBytes?: number;
  readonly mediaUploadTimeoutMs?: number;
  readonly chunkUploadTimeoutMs?: number;
  /** Maximum number of signed COS parts uploaded concurrently. */
  readonly uploadConcurrency?: number;
  /** How long a successful file_info token can be reused. */
  readonly mediaCacheTtlMs?: number;
  /** How often an input-notify signal may be sent for one lane. */
  readonly typingDebounceMs?: number;
  /** Short-lived gateway sessions usually indicate invalid permissions/config. */
  readonly quickDisconnectThresholdMs?: number;
  readonly maxQuickDisconnects?: number;
  /** Pause before the gateway retries with a fresh session after a quick-disconnect burst. */
  readonly quickDisconnectCooldownMs?: number;
  /** Optional Hermes-compatible voice transcription configuration. */
  readonly stt?: unknown;
  readonly now?: () => Date;
}

export type { QqApprovalRequest, QqUpdatePromptRequest } from "./AgentQqProtocol.js";

/**
 * QQ open-platform bot adapter. It keeps a resumable gateway session for
 * inbound events and uses the official v2 REST API for rich outbound messages.
 * All network and socket dependencies are injectable for deterministic tests.
 */
export class AgentQqChannelAdapter implements AgentChannelAdapter {
  readonly kind = AgentChannelKinds.Qq;
  readonly capabilities: AgentChannelCapabilities;

  private handlers?: AgentChannelAdapterHandlers;
  private readonly transport: AgentChannelHttpTransport;
  private readonly rest: AgentQqRestClient;
  private readonly appSecret: string;
  private readonly webhookSecret?: string;
  private readonly mode: "websocket" | "webhook";
  private readonly createGatewaySocket: (url: string) => AgentQqGatewaySocket;
  private readonly intents: number;
  private readonly ackTimeoutMs: number;
  private readonly maxMissedAcks: number;
  private readonly reconnectBackoffBaseMs: number;
  private readonly reconnectBackoffMaxMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly dedupWindowMs: number;
  private readonly dedupMaxSize: number;
  private readonly typingDebounceMs: number;
  private readonly quickDisconnectThresholdMs: number;
  private readonly maxQuickDisconnects: number;
  private readonly quickDisconnectCooldownMs: number;
  private readonly markdownSupport: boolean;
  private readonly now: () => Date;
  private readonly seenMessages = new Map<string, number>();
  private readonly mediaUploader: QqMediaUploader;
  private readonly messageClient: AgentQqMessageClient;
  private readonly voiceTranscriber: AgentQqVoiceTranscriber;
  private gatewayUrl?: string;
  private sessionId?: string;
  private lastSequence?: number;
  private internal?: AbortController;
  private gatewayPromise?: Promise<void>;
  private gatewaySocket?: AgentQqGatewaySocket;
  private connectionState: AgentChannelConnectionState = "stopped";

  constructor(options: AgentQqChannelAdapterOptions) {
    this.mode = options.mode === "webhook" ? "webhook" : "websocket";
    this.appSecret = options.appSecret.trim();
    this.webhookSecret = options.webhookSecret?.trim() || undefined;
    this.transport = options.transport ?? new AgentChannelFetchTransport();
    const now = options.now ?? (() => new Date());
    this.now = now;
    this.rest = new AgentQqRestClient({
      appId: options.appId,
      appSecret: this.appSecret,
      tokenApiBase: options.tokenApiBase ?? QqChannelAdapterDefaults.tokenApiBase,
      apiBase: options.apiBase ?? QqChannelAdapterDefaults.apiBase,
      transport: this.transport,
      tokenExpirySkewMs: QqChannelAdapterDefaults.tokenExpirySkewMs,
      now,
    });
    this.createGatewaySocket = options.createGatewaySocket ?? defaultGatewaySocket;
    this.intents = (options.intents ?? 0) || defaultQqIntents();
    this.ackTimeoutMs = positive(options.ackTimeoutMs ?? QqChannelAdapterDefaults.ackTimeoutMs, "ackTimeoutMs");
    this.maxMissedAcks = positive(options.maxMissedAcks ?? QqChannelAdapterDefaults.maxMissedAcks, "maxMissedAcks");
    this.reconnectBackoffBaseMs = positive(
      options.reconnectBackoffBaseMs ?? QqChannelAdapterDefaults.reconnectBackoffBaseMs,
      "reconnectBackoffBaseMs",
    );
    this.reconnectBackoffMaxMs = positive(
      options.reconnectBackoffMaxMs ?? QqChannelAdapterDefaults.reconnectBackoffMaxMs,
      "reconnectBackoffMaxMs",
    );
    this.maxReconnectAttempts = positive(
      options.maxReconnectAttempts ?? QqChannelAdapterDefaults.maxReconnectAttempts,
      "maxReconnectAttempts",
    );
    this.quickDisconnectThresholdMs = positive(
      options.quickDisconnectThresholdMs ?? QqChannelAdapterDefaults.quickDisconnectThresholdMs,
      "quickDisconnectThresholdMs",
    );
    this.maxQuickDisconnects = positive(
      options.maxQuickDisconnects ?? QqChannelAdapterDefaults.maxQuickDisconnects,
      "maxQuickDisconnects",
    );
    this.quickDisconnectCooldownMs = positive(
      options.quickDisconnectCooldownMs ?? QqChannelAdapterDefaults.quickDisconnectCooldownMs,
      "quickDisconnectCooldownMs",
    );
    this.dedupWindowMs = positive(options.dedupWindowMs ?? QqChannelAdapterDefaults.dedupWindowMs, "dedupWindowMs");
    this.dedupMaxSize = positive(options.dedupMaxSize ?? QqChannelAdapterDefaults.dedupMaxSize, "dedupMaxSize");
    const maxMediaBytes = positive(options.maxMediaBytes ?? QqChannelAdapterDefaults.maxMediaBytes, "maxMediaBytes");
    const inlineMediaLimitBytes = positive(
      options.inlineMediaLimitBytes ?? QqChannelAdapterDefaults.inlineMediaLimitBytes,
      "inlineMediaLimitBytes",
    );
    const mediaUploadTimeoutMs = positive(
      options.mediaUploadTimeoutMs ?? QqChannelAdapterDefaults.mediaUploadTimeoutMs,
      "mediaUploadTimeoutMs",
    );
    const chunkUploadTimeoutMs = positive(
      options.chunkUploadTimeoutMs ?? QqChannelAdapterDefaults.chunkUploadTimeoutMs,
      "chunkUploadTimeoutMs",
    );
    const uploadConcurrency = boundedInteger(
      options.uploadConcurrency ?? QqChannelAdapterDefaults.uploadConcurrency,
      1,
      10,
      "uploadConcurrency",
    );
    const mediaCacheTtlMs = positive(
      options.mediaCacheTtlMs ?? QqChannelAdapterDefaults.mediaCacheTtlMs,
      "mediaCacheTtlMs",
    );
    this.typingDebounceMs = positive(
      options.typingDebounceMs ?? QqChannelAdapterDefaults.typingDebounceMs,
      "typingDebounceMs",
    );
    // Hermes enables QQ's native Markdown path by default. Operators can
    // explicitly disable it when an app has not been granted that capability.
    this.markdownSupport = options.markdownSupport !== false;
    const configuredMax = options.maxMessageLength ?? QqChannelAdapterDefaults.maxContentLength;
    const maxMessageLength = Math.min(
      QqChannelAdapterDefaults.maxContentLength,
      positive(configuredMax, "maxMessageLength"),
    );
    this.capabilities = {
      splitsLongMessages: true,
      maxMessageLength,
      supportsEdit: false,
      supportsDraft: false,
      markdown: this.markdownSupport ? "markdown" : "plain",
      commandPrefix: "/",
      supportsMedia: true,
      supportsKeyboard: true,
      supportsInteractions: true,
    };
    this.mediaUploader = new QqMediaUploader({
      transport: this.transport,
      request: (path, method, body, timeoutMs) => this.rest.request(path, method, body, timeoutMs),
      maxMediaBytes,
      inlineMediaLimitBytes,
      mediaUploadTimeoutMs,
      chunkUploadTimeoutMs,
      uploadConcurrency,
      mediaCacheTtlMs,
      now: this.now,
    });
    this.voiceTranscriber = new AgentQqVoiceTranscriber({
      transport: this.transport,
      config: options.stt,
      resolveMediaHeaders: async () => ({ Authorization: `QQBot ${await this.rest.getToken()}` }),
    });
    this.messageClient = new AgentQqMessageClient({
      rest: this.rest,
      mediaUploader: this.mediaUploader,
      maxMessageLength,
      markdownSupport: this.markdownSupport,
      typingDebounceMs: this.typingDebounceMs,
      now: this.now,
      waitForAvailability: () => this.waitForSendAvailability(),
      getConnectionState: () => this.connectionState,
    });
  }

  getConnectionState(): AgentChannelConnectionState {
    return this.connectionState;
  }

  private setConnectionState(state: AgentChannelConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.handlers?.onConnectionStateChanged?.(state);
  }

  bind(handlers: AgentChannelAdapterHandlers): void {
    this.handlers = handlers;
  }

  /**
   * QQ CDN attachment URLs are short-lived and may require the bot bearer
   * token. The channel service uses these headers only while materializing an
   * inbound attachment into its private upload store.
   */
  async getInboundAttachmentHeaders(
    attachment: AgentChannelAttachment,
    _source: AgentChannelSource,
  ): Promise<Readonly<Record<string, string>> | undefined> {
    return this.rest.getInboundAttachmentHeaders(attachment, _source);
  }

  async connect(signal: AbortSignal): Promise<void> {
    if (this.internal && !this.internal.signal.aborted) return;
    if (signal.aborted) {
      this.setConnectionState("stopped");
      return;
    }
    const internal = new AbortController();
    this.internal = internal;
    this.setConnectionState("connecting");
    signal.addEventListener(
      "abort",
      () => {
        internal.abort();
        this.setConnectionState("stopped");
      },
      { once: true },
    );
    try {
      await this.rest.getToken();
      if (this.mode === "webhook") {
        this.setConnectionState("connected");
        return;
      }
      const gateway = await this.fetchGatewayUrl();
      this.gatewayUrl = sanitizeGatewayUrl(gateway.url);
      const gatewayUrl = this.gatewayUrl;
      if (!gatewayUrl) throw new Error("QQ gateway URL is not resolved.");
      this.gatewayPromise = runQqGatewayLoop({
        gatewayUrl,
        signal: internal.signal,
        createGatewaySocket: this.createGatewaySocket,
        intents: this.intents,
        ackTimeoutMs: this.ackTimeoutMs,
        maxMissedAcks: this.maxMissedAcks,
        reconnectBackoffBaseMs: this.reconnectBackoffBaseMs,
        reconnectBackoffMaxMs: this.reconnectBackoffMaxMs,
        maxReconnectAttempts: this.maxReconnectAttempts,
        quickDisconnectThresholdMs: this.quickDisconnectThresholdMs,
        maxQuickDisconnects: this.maxQuickDisconnects,
        quickDisconnectCooldownMs: this.quickDisconnectCooldownMs,
        getToken: () => this.rest.getToken(),
        getSession: () => ({ sessionId: this.sessionId, lastSequence: this.lastSequence }),
        setSession: (sessionId, lastSequence) => {
          this.sessionId = sessionId;
          this.lastSequence = lastSequence;
        },
        invalidateToken: () => this.rest.invalidate(),
        setConnectionState: (state) => this.setConnectionState(state),
        onSocket: (socket) => {
          this.gatewaySocket = socket;
        },
        onDispatch: (eventType, data) => this.processDispatch(eventType, data),
        onInteraction: (data) => this.processInteraction(data),
        onFatal: (error) => this.handlers?.onFatal?.(error, this.kind),
      }).catch((error) => {
        if (!internal.signal.aborted) {
          this.setConnectionState("degraded");
          this.handlers?.onFatal?.(error, this.kind);
        }
      });
    } catch (error) {
      this.setConnectionState(internal.signal.aborted ? "stopped" : "degraded");
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.setConnectionState("stopped");
    this.internal?.abort();
    this.gatewaySocket?.close(1000);
    await this.gatewayPromise?.catch(() => undefined);
    this.gatewayPromise = undefined;
    this.gatewaySocket = undefined;
    this.mediaUploader.clear();
    this.rest.clear();
  }

  /**
   * Answers QQ's callback URL verification challenge (gateway op=13).
   * Verification is handled before normal webhook signature validation: the
   * platform sends the challenge without the regular callback headers and
   * expects the signed response immediately.
   */
  async handleWebhookVerification(
    payload: unknown,
    _rawBody: string,
    _headers: Record<string, string | string[]>,
  ): Promise<AgentChannelWebhookResponse | undefined> {
    if (this.mode !== "webhook" || !isRecord(payload) || Number(payload.op) !== 13) return undefined;
    if (!isRecord(payload.d)) throw new Error("QQ webhook verification payload is invalid.");
    const secret = this.webhookSecret ?? this.appSecret;
    const body = createQqWebhookVerificationResponse(secret, payload.d as QqWebhookVerificationData);
    return { status: 200, body };
  }

  async handleWebhookUpdate(
    payload: unknown,
    rawBody: string,
    headers: Record<string, string | string[]>,
  ): Promise<boolean> {
    // QQ signs callbacks with the app secret by default. `webhookSecret` is
    // an optional rotation/override value, kept for deployments that use a
    // separate callback secret. Webhook mode must therefore remain usable
    // when only the required AppSecret is configured.
    const signatureSecret = this.webhookSecret ?? this.appSecret;
    if (!verifyQqSignature(rawBody, headers, signatureSecret)) {
      throw new Error("QQ webhook rejected: signature verification failed.");
    }
    if (!isRecord(payload)) return false;
    const envelope = payload as QqWebhookEnvelope;
    if (!envelope.d || !isRecord(envelope.d)) return false;
    const eventType = envelope.t ?? inferWebhookEventType(envelope.d);
    if (eventType === QqGatewayDispatch.InteractionCreate) {
      // Webhook callers receive success only after QQ's interaction ACK has
      // completed. This keeps button clicks out of the platform's timeout
      // window even when the HTTP handler is backed by a short-lived request.
      await this.processInteraction(envelope.d);
      return true;
    }
    const forcedKind = typeof envelope.s === "number" && isLegacyWebhookSink(envelope.s) ? envelope.s : undefined;
    await this.processDispatch(eventType, envelope.d, forcedKind);
    return true;
  }

  send(
    source: AgentChannelSource,
    content: string,
    options?: AgentChannelSendReplyOptions,
  ): Promise<AgentChannelSendResult> {
    return this.messageClient.send(source, content, options);
  }

  sendWithKeyboard(
    source: AgentChannelSource,
    content: string,
    keyboard: AgentChannelKeyboard,
    replyToMessageId?: string,
  ): Promise<AgentChannelSendResult> {
    return this.messageClient.sendWithKeyboard(source, content, keyboard, replyToMessageId);
  }

  sendApprovalRequest(source: AgentChannelSource, request: QqApprovalRequest): Promise<AgentChannelSendResult> {
    return this.messageClient.sendApprovalRequest(source, request);
  }

  sendUpdatePrompt(source: AgentChannelSource, request: QqUpdatePromptRequest): Promise<AgentChannelSendResult> {
    return this.messageClient.sendUpdatePrompt(source, request);
  }

  sendExecApproval(source: AgentChannelSource, request: QqApprovalRequest): Promise<AgentChannelSendResult> {
    return this.messageClient.sendExecApproval(source, request);
  }

  sendMediaMessage(
    source: AgentChannelSource,
    media: AgentChannelMedia,
    caption = "",
    options?: Pick<AgentChannelSendReplyOptions, "replyToMessageId" | "keyboard">,
  ): Promise<AgentChannelSendResult> {
    return this.messageClient.sendMediaMessage(source, media, caption, options);
  }

  private async waitForSendAvailability(): Promise<void> {
    if (this.connectionState !== "reconnecting") return;
    const deadline = Date.now() + 15_000;
    while (this.connectionState === "reconnecting" && Date.now() < deadline) {
      await this.sleep(250);
    }
    if (this.connectionState === "reconnecting") {
      throw new Error("QQ gateway is reconnecting; message delivery timed out waiting for the connection.");
    }
  }

  private async sleep(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const handle = setTimeout(resolve, delayMs);
      handle.unref?.();
    });
  }

  edit(source: AgentChannelSource, messageId: string, content: string): Promise<AgentChannelSendResult> {
    return this.messageClient.edit(source, messageId, content);
  }

  /**
   * Sends QQ's native input-notify signal. QQ accepts a 60-second indicator
   * window, so the adapter debounces refreshes per conversation.
   * This is deliberately best-effort: a typing hint must never block a turn.
   */
  sendTyping(source: AgentChannelSource): Promise<void> {
    return this.messageClient.sendTyping(source);
  }

  // ---------------------------------------------------------------------
  // Gateway WebSocket transport
  // ---------------------------------------------------------------------

  private async fetchGatewayUrl(): Promise<{ url: string }> {
    return this.rest.fetchGatewayUrl();
  }

  private async processDispatch(eventType: string, data: QqDispatchData, forcedKind?: number): Promise<void> {
    if (!data || typeof data !== "object") return;
    const messageId = stringValue(data.id);
    if (messageId && this.isDuplicate(messageId)) return;
    const source = qqDispatchSource(eventType, data, forcedKind);
    if (!source) return;
    if (messageId) this.messageClient.rememberInboundMessage(source, messageId);
    const normalizedAttachments = normalizeQqAttachments(collectQqAttachments(data));
    const attachments = await this.voiceTranscriber.enrich(normalizedAttachments);
    const inbound: AgentChannelInboundMessage = {
      source,
      text: [quotedQqContent(data), cleanQqContent(data.content ?? "")].filter(Boolean).join("\n\n").trim(),
      attachments,
      replyToMessageId: data.message_reference?.message_id ?? data.referenced_message?.id,
      sentAt: data.timestamp ?? this.now().toISOString(),
      raw: data,
    };
    if (!inbound.text && (inbound.attachments?.length ?? 0) === 0) return;
    // Gateway and webhook dispatch are fire-and-forget by design: the
    // platform transport must keep consuming events while the session
    // pipeline may wait on uploads/model work. Always observe the Promise so
    // a rejected handler cannot become an unhandled rejection.
    void Promise.resolve(this.handlers?.onMessage(inbound)).catch((error) => {
      this.handlers?.onFatal?.(new Error(`QQ message handler failed: ${describe(error)}`), this.kind);
    });
  }

  private async processInteraction(raw: unknown): Promise<void> {
    if (!isRecord(raw)) return;
    const payload = raw as QqInteractionPayload;
    const id = stringValue(payload.id);
    if (!id) return;
    try {
      await this.rest.request(`/interactions/${encodeURIComponent(id)}`, "PUT", { code: 0 }, 15_000);
    } catch (error) {
      this.handlers?.onFatal?.(new Error(`QQ interaction ACK failed: ${describe(error)}`), this.kind);
    }
    const source = qqInteractionSource(payload);
    if (!source) return;
    try {
      await this.handlers?.onInteraction?.({
        id,
        source,
        type:
          typeof payload.type === "number"
            ? payload.type
            : typeof payload.data?.type === "number"
              ? payload.data.type
              : undefined,
        buttonId: stringValue(payload.data?.resolved?.button_id),
        buttonData: stringValue(payload.data?.resolved?.button_data),
        raw,
      });
    } catch (error) {
      // The interaction has already been ACKed. Do not reject the webhook or
      // let a Gateway task become an unhandled rejection and trigger retries.
      this.handlers?.onFatal?.(new Error(`QQ interaction handler failed: ${describe(error)}`), this.kind);
    }
  }

  private isDuplicate(messageId: string): boolean {
    const now = this.now().getTime();
    for (const [id, seenAt] of this.seenMessages) {
      if (now - seenAt > this.dedupWindowMs) this.seenMessages.delete(id);
    }
    if (this.seenMessages.has(messageId)) return true;
    this.seenMessages.set(messageId, now);
    while (this.seenMessages.size > this.dedupMaxSize) {
      const oldest = this.seenMessages.keys().next().value;
      if (typeof oldest !== "string") break;
      this.seenMessages.delete(oldest);
    }
    return false;
  }
}
