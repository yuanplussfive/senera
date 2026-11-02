import type { AgentDomainEvent } from "../Events/AgentEvent.js";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import type { AgentProfileRouteRegistry } from "../Conversation/AgentConversationSpace.js";

/** Stable platform identities supported by the channel subsystem. */
export const AgentChannelKinds = {
  Telegram: "telegram",
  Discord: "discord",
  Qq: "qq",
  /** Embedded Senera QQ client. */
  OneBot11: "onebot11",
  /** External OneBot 11 services such as SnowLuma. */
  OneBot: "onebot",
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
  /** Adapter-verified namespace for application-scoped native account IDs. */
  readonly authority?: string;
  /** Host-selected recipient; never supplied by message text. */
  readonly agentId?: string;
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
  /** Opaque gateway locator, resolved by the originating adapter after durable admission. */
  readonly nativeId?: string;
  /** A file already uploaded to this workspace; reuse its identity and bytes. */
  readonly resourceUri?: string;
  readonly url?: string;
  /**
   * Exact bytes supplied by a channel protocol. Inline bytes are never placed
   * in model text: the channel ingestion boundary persists them as a normal
   * Senera upload before a turn can consume them.
   */
  readonly inlineData?: {
    readonly encoding: "base64";
    readonly data: string;
  };
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

/**
 * A lossless, protocol-neutral message part. `text` remains available as the
 * convenient conversational projection, while this sequence preserves rich
 * platform semantics such as mentions, replies, media, cards and reactions.
 */
export interface AgentChannelMessageSegment {
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
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
  readonly size?: number;
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
export interface AgentChannelEvent {
  readonly id: string;
  readonly type: string;
  readonly actorId: string;
  readonly actorName?: string;
  readonly targetId?: string;
  readonly targetName?: string;
  readonly messageId?: string;
  readonly sentAt: string;
}

export interface AgentChannelInboundMessage {
  readonly source: AgentChannelSource;
  /** Actual speaker; routing userId may identify the local client account. */
  readonly senderId?: string;
  /** Host-owned provenance for an Agent's explicit outgoing channel action. */
  readonly task?: AgentChannelTask;
  readonly text: string;
  readonly event?: AgentChannelEvent;
  /** Complete ordered content parts when a platform supports rich messages. */
  readonly segments?: readonly AgentChannelMessageSegment[];
  readonly attachments?: readonly AgentChannelAttachment[];
  readonly replyToMessageId?: string;
  readonly replyToSenderId?: string;
  /** The native dispatch explicitly addresses this bot, even if it omits its account ID. */
  readonly addressedToSelf?: boolean;
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
  /** Host-owned idempotency identity for this exact transport payload. */
  readonly deliveryId?: string;
  readonly task?: AgentChannelTask;
  readonly replyToMessageId?: string;
  readonly chatType: AgentChannelChatType;
  readonly media?: readonly AgentChannelMedia[];
  /** Ordered text/media when the adapter can deliver a native mixed message. */
  readonly parts?: readonly AgentChannelOutboundSegment[];
  /** Explicit protocol mentions; never parsed out of literal message text. */
  readonly mentionIds?: readonly string[];
  readonly keyboard?: AgentChannelKeyboard;
}

export type AgentChannelOutboundSegment =
  { readonly kind: "text"; readonly content: string } | { readonly kind: "media"; readonly media: AgentChannelMedia };

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
  readonly mediaKinds?: readonly AgentChannelMedia["kind"][];
  readonly supportsPoke?: boolean;
  readonly supportsMentions?: boolean;
  /** Whether replying displays a native quote, rather than only authorizing a passive response. */
  readonly supportsQuotedReplies?: boolean;
  /** Native events available to model-selected wait conditions. */
  readonly inboundEvents?: readonly import("./AgentChannelParticipation.js").AgentChannelWakeEvent[];
  /** The platform accepts native inline keyboards. */
  readonly supportsKeyboard?: boolean;
  /** The platform emits button interactions. */
  readonly supportsInteractions?: boolean;
  /**
   * Whether model events are automatically rendered to the channel.
   * Explicit channels publish only through model-selected channel tools.
   */
  readonly automaticDelivery?: boolean;
}

export interface AgentChannelDefinition {
  readonly kind: AgentChannelKind;
  readonly displayName: string;
  readonly capabilities: AgentChannelCapabilities;
  readonly create: () => AgentChannelAdapter;
}

export interface AgentChannelAdapter {
  /** Verified identity authority; no display name, message text or model arguments participate. */
  resolveActor?(
    senderId: string,
    source?: AgentChannelSource,
  ):
    | {
        readonly authority: string;
        readonly account: string;
        readonly kind?: "user" | "agent";
        readonly owner?: boolean;
      }
    | undefined;
  /** Every participant may observe an event, independently of the initial activation policy. */
  observeInbound?(message: AgentChannelInboundMessage): readonly AgentChannelSource[];
  /** Current directory membership and enabled state, independent of an incoming message. */
  canParticipate?(source: AgentChannelSource): boolean;
  /** Rejects delayed ingestion after native recall, task removal, or conversation clearing. */
  isHistoryEntryCurrent?(source: AgentChannelSource, key: string): boolean;
  /** Selects host-owned recipient lanes from native mention/reply/event semantics. */
  routeInbound?(message: AgentChannelInboundMessage): readonly AgentChannelSource[];
  routeCommand?(message: AgentChannelInboundMessage): readonly AgentChannelSource[];
  canExecuteCommand?(message: AgentChannelInboundMessage, command: AgentChannelCommand): boolean;
  conversationContext?(
    source: AgentChannelSource,
  ): import("../Interaction/AgentInteractionContext.js").AgentInteractionConversation;
  resolveMessageTasks?(source: AgentChannelSource, messageId: string): readonly AgentChannelTask[];
  readonly kind: AgentChannelKind;
  readonly capabilities: AgentChannelCapabilities;

  /** Source-specific features when one protocol hosts several gateways. */
  capabilitiesFor?(source: AgentChannelSource): AgentChannelCapabilities;
  /** Whether the adapter itself journals successfully sent messages. */
  recordsOutboundHistory?(source: AgentChannelSource): boolean;

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

  /** Removes an already-delivered message when the platform supports it. */
  deleteMessage?(target: AgentChannelSource, messageId: string): Promise<AgentChannelSendResult>;
  /** Sends a native platform poke to the other participant in the current lane. */
  poke?(target: AgentChannelSource, task?: AgentChannelTask, targetId?: string): Promise<void>;

  bindHistory?(source: AgentChannelSource, key: string, task: AgentChannelTask, preserveExisting?: boolean): void;
  resolveMessageTask?(source: AgentChannelSource, messageId: string): AgentChannelTask | undefined;
  readClientTimeline?(
    source: AgentChannelSource,
    before?: number,
    limit?: number,
    sync?: AgentChannelTimelineSync,
  ): Promise<AgentChannelTimelinePage>;
  readClientConversations?(): Promise<readonly AgentChannelClientConversationSummary[]>;

  /** Optional adapter-owned view of the current external conversation lane. */
  readHistory?(
    target: AgentChannelSource,
    options?: { readonly limit?: number; readonly beforeMessageId?: string },
  ): Promise<readonly AgentChannelHistoryMessage[]>;

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
  resolveInboundAttachment?(
    attachment: AgentChannelAttachment,
    source: AgentChannelSource,
    segments?: readonly AgentChannelMessageSegment[],
  ): Promise<AgentChannelAttachment>;

  /** Called once after connect with the inbound pipeline bound. */
  bind(handlers: AgentChannelAdapterHandlers): void;

  /** Live transport state used by status surfaces and delivery guards. */
  getConnectionState(source?: AgentChannelSource): AgentChannelConnectionState;

  /**
   * Optional host-safe connection facts for settings surfaces. Credentials are
   * intentionally excluded: this is presentation metadata, not a transport
   * configuration export.
   */
  getConnectionInfo?(): AgentChannelConnectionInfo | undefined;

  /** Resolves the authenticated local client's lane without trusting a caller-supplied sender ID. */
  resolveClientSource?(conversation: AgentChannelClientConversation): AgentChannelSource;

  /** Attaches a host-authenticated socket to an embedded channel protocol. */
  connectClient?(socket: WebSocket, request: IncomingMessage): void;
}

export interface AgentChannelClientConversation {
  readonly chatType: "direct" | "group";
  readonly chatId: string;
}

export interface AgentChannelClientConversationSummary extends AgentChannelClientConversation {
  readonly name: string;
  readonly latest: AgentChannelTimelinePage["entries"][number];
}

export interface AgentChannelTask {
  readonly sessionId: string;
  readonly requestId: string;
}

export interface AgentChannelTimelineCursor {
  readonly revision: number;
  readonly sequence: number;
}

export interface AgentChannelTimelineSync {
  readonly after: AgentChannelTimelineCursor;
}

export interface AgentChannelTimelinePage {
  readonly entries: readonly {
    readonly sequence: number;
    readonly key: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly task?: AgentChannelTask;
  }[];
  readonly before: number | null;
  readonly sync?: {
    readonly cursor: AgentChannelTimelineCursor;
    readonly hasMore: boolean;
    readonly reset: boolean;
  };
}

/** A presentational external-message record. Senera session history remains authoritative. */
export interface AgentChannelHistoryMessage {
  readonly id: string;
  readonly direction: "inbound" | "outbound";
  readonly text: string;
  /** Complete ordered content parts when the adapter retains rich history. */
  readonly segments?: readonly AgentChannelMessageSegment[];
  readonly sentAt: string;
  readonly senderId?: string;
  readonly displayName?: string;
}

export type AgentChannelConnectionState = "stopped" | "connecting" | "connected" | "reconnecting" | "degraded";

export interface AgentChannelConnectionInfo {
  /** Client endpoint after the adapter has completed its own identity setup. */
  readonly endpoint?: string;
  /** Public adapter/account identifier when the protocol exposes one. */
  readonly accountId?: string;
}

export interface AgentChannelAdapterHandlers {
  /** Local client management rewinds the authoritative task before altering its timeline. */
  onRecall?(source: AgentChannelSource, messageId: string): Promise<void>;
  onMessage(message: AgentChannelInboundMessage): void | Promise<void>;
  onFatal(error: unknown, kind: AgentChannelKind): void;
  /** Emits transport state transitions that happen after connect() returns. */
  onConnectionStateChanged?(state: AgentChannelConnectionState): void;
  /** Membership or Agent availability changed; reconcile durable participation immediately. */
  onParticipantsChanged?(): void | Promise<void>;
  onInteraction?(interaction: AgentChannelInteraction): void | Promise<void>;
  onEvent?(source: AgentChannelSource, event: AgentChannelEvent, task?: AgentChannelTask): void | Promise<void>;
}

/** Settings-driven configuration of one channel instance. */
export interface AgentChannelConfig {
  readonly enabled: boolean;
  readonly connection?: import("./Adapters/AgentOneBot11ConnectionConfig.js").AgentOneBot11ConnectionConfig;
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
  /** Extension-owned channel options without a typed runtime field. */
  readonly unknown?: Readonly<Record<string, unknown>>;
}

/** The full channel bundle resolved from configuration. */
export interface AgentChannelsConfig {
  readonly channels: Readonly<Record<AgentChannelKind, AgentChannelConfig>>;
  readonly enabled: boolean;
  readonly defaultApprovalMode?: "agent" | "always_ask" | "full_access";
  /** Host-owned conversation routing, resolved from the extension configuration. */
  readonly profileRoutes?: AgentProfileRouteRegistry;
}

export interface AgentChannelEventObserver {
  (event: AgentDomainEvent): void | Promise<void>;
}
