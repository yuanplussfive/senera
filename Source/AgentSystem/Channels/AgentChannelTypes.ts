import type { AgentDomainEvent } from "../Events/AgentEvent.js";

/** Stable platform identities supported by the channel subsystem. */
export const AgentChannelKinds = {
  Telegram: "telegram",
  Discord: "discord",
  Qq: "qq",
} as const;

export type AgentChannelKind = (typeof AgentChannelKinds)[keyof typeof AgentChannelKinds];

/** Normative chat shapes normalized from platform-specific update payloads. */
export const AgentChannelChatTypes = {
  Direct: "direct",
  Group: "group",
  Channel: "channel",
  Thread: "thread",
} as const;

export type AgentChannelChatType = (typeof AgentChannelChatTypes)[keyof typeof AgentChannelChatTypes];

/**
 * Routing for natural-language messages that arrive while the lane's session
 * has an active run. `steer` injects the message at the next tool-batch
 * boundary so the model sees it mid-task; `follow_up` delivers it only when
 * the active turn settles.
 */
export const AgentChannelBusyMessageModes = {
  Steer: "steer",
  FollowUp: "follow_up",
} as const;

export type AgentChannelBusyMessageMode =
  (typeof AgentChannelBusyMessageModes)[keyof typeof AgentChannelBusyMessageModes];

/** Platform-independent identity of one conversation lane on one channel. */
export interface AgentChannelSource {
  readonly platform: AgentChannelKind;
  readonly chatType: AgentChannelChatType;
  readonly chatId: string;
  readonly userId: string;
  readonly threadId?: string;
  readonly messageId?: string;
  readonly displayName?: string;
}

/** A media attachment received from or sent to a channel. */
export interface AgentChannelAttachment {
  readonly id?: string;
  readonly url?: string;
  readonly filename?: string;
  readonly contentType?: string;
  /** Normalized platform media kind, when the channel exposes one. */
  readonly mediaType?: "image" | "video" | "audio" | "file";
  readonly size?: number;
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
  readonly altText?: string;
  /** Provider-native transcript, for example QQ's asr_refer_text. */
  readonly transcript?: string;
  /** Provider-native WAV URL for voice messages that need local conversion. */
  readonly voiceWavUrl?: string;
}

/** Native media accepted by adapters that support uploads. */
export interface AgentChannelMedia {
  readonly kind: "image" | "video" | "audio" | "file";
  /** Canonical Senera identity used for cross-stage delivery de-duplication. */
  readonly resourceUri?: string;
  /** Content identity shared by inline and resolved representations. */
  readonly contentHash?: string;
  /** Hosted URL that QQ can fetch directly. */
  readonly url?: string;
  /** Local file path. Adapters may use chunked upload for large files. */
  readonly path?: string;
  /** Data URI or base64 payload for small in-memory media. */
  readonly data?: string;
  readonly filename?: string;
  readonly contentType?: string;
  readonly altText?: string;
}

export interface AgentChannelKeyboardButton {
  readonly id: string;
  readonly label: string;
  readonly visitedLabel?: string;
  readonly action?: "callback" | "link";
  readonly data?: string;
  readonly url?: string;
  readonly style?: 0 | 1;
  readonly clickLimit?: number;
  readonly groupId?: string;
}

export interface AgentChannelKeyboard {
  readonly rows: readonly (readonly AgentChannelKeyboardButton[])[];
}

/** Normalized button interaction emitted by adapters with native keyboards. */
export interface AgentChannelInteraction {
  readonly id: string;
  readonly source: AgentChannelSource;
  readonly buttonId?: string;
  readonly buttonData?: string;
  readonly type?: number;
  readonly raw?: unknown;
}

/** Normalized inbound message handed to the session pipeline. */
export interface AgentChannelInboundMessage {
  readonly source: AgentChannelSource;
  readonly text: string;
  readonly attachments?: readonly AgentChannelAttachment[];
  readonly replyToMessageId?: string;
  readonly command?: AgentChannelCommand;
  readonly sentAt?: string;
  readonly raw?: unknown;
}

export const AgentChannelCommands = {
  New: "new",
  Stop: "stop",
  Status: "status",
  Help: "help",
  Queue: "queue",
  Steer: "steer",
} as const;

export type AgentChannelCommand = (typeof AgentChannelCommands)[keyof typeof AgentChannelCommands];

export type AgentChannelSendResult =
  | { readonly kind: "sent"; readonly messageId: string; readonly editTarget?: boolean }
  | { readonly kind: "edited"; readonly messageId: string }
  | { readonly kind: "deleted" }
  | { readonly kind: "unsupported" };

export interface AgentChannelSendReplyOptions {
  readonly replyToMessageId?: string;
  readonly chatType: AgentChannelChatType;
  readonly media?: readonly AgentChannelMedia[];
  readonly keyboard?: AgentChannelKeyboard;
}

/**
 * A platform webhook may answer a request without delivering a message.
 * QQ uses this for its callback URL verification challenge. Keeping the
 * response shape at the channel boundary lets the HTTP surface stay generic
 * while each adapter owns its protocol-specific signing rules.
 */
export interface AgentChannelWebhookResponse {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: unknown;
}

/**
 * Declarative capability surface of one platform adapter. Mirrors the
 * platform capability flags of reference gateways while keeping behavior in
 * the shared pipeline instead of duplicated per-adapter branches.
 */
export interface AgentChannelCapabilities {
  /** Long messages are split by the shared pipeline before delivery. */
  readonly splitsLongMessages: boolean;
  /** Maximum payload units the platform accepts in one message. */
  readonly maxMessageLength: number;
  /** The platform can edit an already delivered message (progressive streaming). */
  readonly supportsEdit: boolean;
  /** The platform supports native draft streaming (unused today; future proofing). */
  readonly supportsDraft: boolean;
  /** The platform can render markdown text as-is. */
  readonly markdown: "none" | "markdown_v2" | "markdown" | "plain";
  /** Inbound text carries a command prefix character (e.g. Telegram bots do not). */
  readonly commandPrefix: string;
  /** The platform accepts native rich media uploads. */
  readonly supportsMedia?: boolean;
  /** The platform accepts native inline keyboards. */
  readonly supportsKeyboard?: boolean;
  /** The platform emits button interactions. */
  readonly supportsInteractions?: boolean;
}

export interface AgentChannelDefinition {
  readonly kind: AgentChannelKind;
  readonly displayName: string;
  readonly capabilities: AgentChannelCapabilities;
  readonly create: () => AgentChannelAdapter;
}

export interface AgentChannelAdapter {
  readonly kind: AgentChannelKind;
  readonly capabilities: AgentChannelCapabilities;

  /** Starts the outbound connection (polling or websocket gateway). */
  connect(signal: AbortSignal): Promise<void>;
  /** Stops the outbound connection. */
  disconnect(): Promise<void>;

  /** Sends one rendered message chunk. Implementations must reject on failure. */
  send(
    target: AgentChannelSource,
    content: string,
    options?: AgentChannelSendReplyOptions,
  ): Promise<AgentChannelSendResult>;

  /** Advances a streaming preview when the platform supports edits. */
  edit?(target: AgentChannelSource, messageId: string, content: string): Promise<AgentChannelSendResult>;

  /** Invoked by the webhook HTTP entry with the raw platform payload. */
  handleWebhookUpdate?(payload: unknown, rawBody: string, headers: Record<string, string | string[]>): Promise<boolean>;

  /** Optional protocol handshake response (for example QQ op=13). */
  handleWebhookVerification?(
    payload: unknown,
    rawBody: string,
    headers: Record<string, string | string[]>,
  ): Promise<AgentChannelWebhookResponse | undefined>;

  /** Optional native typing/presence hint. It must never be required for delivery. */
  sendTyping?(target: AgentChannelSource): Promise<void>;

  /**
   * Returns short-lived authorization headers for inbound attachment URLs.
   * QQ CDN links commonly require the bot bearer token; the service passes
   * these headers only to its durable upload resolver and never persists them.
   */
  getInboundAttachmentHeaders?(
    attachment: AgentChannelAttachment,
    source: AgentChannelSource,
  ): Promise<Readonly<Record<string, string>> | undefined>;

  /** Called once after connect with the inbound pipeline bound. */
  bind(handlers: AgentChannelAdapterHandlers): void;

  /** Live transport state used by status surfaces and delivery guards. */
  getConnectionState(): AgentChannelConnectionState;
}

export type AgentChannelConnectionState = "stopped" | "connecting" | "connected" | "reconnecting" | "degraded";

export interface AgentChannelAdapterHandlers {
  onMessage(message: AgentChannelInboundMessage): void | Promise<void>;
  onFatal(error: unknown, kind: AgentChannelKind): void;
  /** Emits transport state transitions that happen after connect() returns. */
  onConnectionStateChanged?(state: AgentChannelConnectionState): void;
  onInteraction?(interaction: AgentChannelInteraction): void | Promise<void>;
}

/** Settings-driven configuration of one channel instance. */
export interface AgentChannelConfig {
  readonly enabled: boolean;
  readonly token?: string;
  readonly appId?: string;
  readonly appSecret?: string;
  readonly webhookUrl?: string;
  readonly webhookSecret?: string;
  readonly mode?: string;
  readonly allowedUsers?: readonly string[];
  readonly allowedRoles?: readonly string[];
  readonly allowAllUsers?: boolean;
  readonly requireMention?: boolean;
  readonly groupSessionsPerUser?: boolean;
  readonly homeChannelId?: string;
  readonly maxMessageLength?: number;
  readonly streamProgress?: boolean;
  readonly markdownSupport?: boolean;
  readonly intents?: number;
  readonly ackTimeoutMs?: number;
  readonly maxReconnectAttempts?: number;
  readonly quickDisconnectThresholdMs?: number;
  readonly maxQuickDisconnects?: number;
  readonly quickDisconnectCooldownMs?: number;
  readonly maxMediaBytes?: number;
  readonly inlineMediaLimitBytes?: number;
  readonly mediaUploadTimeoutMs?: number;
  readonly chunkUploadTimeoutMs?: number;
  readonly uploadConcurrency?: number;
  readonly mediaCacheTtlMs?: number;
  readonly typingDebounceMs?: number;
  readonly dmPolicy?: "disabled" | "allowlist" | "pairing" | "open";
  readonly groupPolicy?: "disabled" | "allowlist" | "pairing" | "open";
  readonly groupAllowedUsers?: readonly string[];
  readonly dedupWindowMs?: number;
  readonly dedupMaxSize?: number;
  /** Routing for messages that arrive while the session has an active run. */
  readonly busyMessageMode: AgentChannelBusyMessageMode;
  /** Optional OpenAI-compatible voice transcription fallback for QQ audio. */
  readonly stt?: Readonly<Record<string, unknown>>;
  readonly unknown?: Readonly<Record<string, unknown>>;
}

/** The full channel bundle resolved from configuration. */
export interface AgentChannelsConfig {
  readonly channels: Readonly<Record<AgentChannelKind, AgentChannelConfig>>;
  readonly enabled: boolean;
  readonly defaultApprovalMode?: "agent" | "always_ask" | "full_access";
}

export interface AgentChannelEventObserver {
  (event: AgentDomainEvent): void | Promise<void>;
}
