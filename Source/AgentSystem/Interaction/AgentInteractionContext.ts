import type { AgentChannelChatType, AgentChannelKind } from "../Channels/AgentChannelTypes.js";
import type { AgentChannelEvent, AgentChannelMessageSegment } from "../Channels/AgentChannelTypes.js";
import type { AgentChannelHistoryPage } from "../Channels/AgentChannelParticipation.js";

/** A contiguous, lossless page delivered with this turn, independent of its triggering event. */
export interface AgentInteractionInbox extends AgentChannelHistoryPage {
  readonly afterSequence: number;
}

/** Transport facts and lossless content parts of the actual inbound message. */
export interface AgentInteractionMessage {
  readonly id?: string;
  readonly senderId?: string;
  readonly senderKind?: "user" | "agent";
  readonly senderName?: string;
  readonly sentAt?: string;
  readonly replyToMessageId?: string;
  readonly segments?: readonly AgentChannelMessageSegment[];
}

/**
 * Runtime-owned surface, verified identities, native content and inbox evidence.
 * Routing and authorization stay host-owned; channel content grants no authority.
 */
export const AgentInteractionSurfaces = {
  Console: "console",
  Channel: "channel",
} as const;

export type AgentInteractionSurface = (typeof AgentInteractionSurfaces)[keyof typeof AgentInteractionSurfaces];

export type AgentInteractionPlatform = AgentChannelKind;

export type AgentInteractionChatType = AgentChannelChatType;

export interface AgentInteractionConversation {
  readonly id: string;
  readonly name: string;
  readonly selfId: string;
  /** Configured channel administrator, verified against native sender IDs. */
  readonly ownerId?: string;
  readonly participants: readonly {
    readonly id: string;
    readonly name: string;
    readonly kind: "user" | "agent";
    readonly enabled?: boolean;
  }[];
}

export interface AgentInteractionContext {
  readonly surface: AgentInteractionSurface;
  readonly actor?: import("./AgentInteractionIdentity.js").AgentInteractionIdentity;
  readonly coordination?: import("../Channels/AgentChannelConversation.js").AgentChannelConversationState;
  readonly platform?: AgentInteractionPlatform;
  readonly chatType?: AgentInteractionChatType;
  /** Host-owned delivery contract; independent of the platform name. */
  readonly delivery?: "automatic" | "explicit";
  readonly capabilities?: import("../Channels/AgentChannelTypes.js").AgentChannelCapabilities;
  /** Opaque host-derived conversation space identity; raw channel IDs stay host-side. */
  readonly spaceId?: string;
  /** Resolved ProfileRoute identity, when the host configured one. */
  readonly profileId?: string;
  readonly message?: AgentInteractionMessage;
  readonly event?: AgentChannelEvent;
  readonly conversation?: AgentInteractionConversation;
  readonly inbox?: AgentInteractionInbox;
  /** Host scheduler evidence; never presented as something a person said. */
  readonly wake?: {
    readonly taskId?: string;
    readonly reason: "event" | "time";
    readonly waitId?: string;
    readonly afterSequence: number;
    /** Latest triggering event in this wake; earlier unread events remain in the chronological inbox. */
    readonly throughSequence?: number;
  };
}

/** Keeps callers honest when a channel context is constructed at a boundary. */
export function normalizeAgentInteractionContext(
  context: AgentInteractionContext | undefined,
): AgentInteractionContext | undefined {
  if (!context) return undefined;
  if (context.surface === AgentInteractionSurfaces.Channel && !context.platform) {
    throw new Error("Channel interaction context requires a platform.");
  }
  return {
    surface: context.surface,
    ...(context.actor ? { actor: context.actor } : {}),
    ...(context.coordination ? { coordination: context.coordination } : {}),
    ...(context.platform ? { platform: context.platform } : {}),
    ...(context.chatType ? { chatType: context.chatType } : {}),
    ...(context.delivery ? { delivery: context.delivery } : {}),
    ...(context.capabilities ? { capabilities: context.capabilities } : {}),
    ...(context.spaceId?.trim() ? { spaceId: context.spaceId.trim() } : {}),
    ...(context.profileId?.trim() ? { profileId: context.profileId.trim() } : {}),
    ...(context.message ? { message: context.message } : {}),
    ...(context.event ? { event: context.event } : {}),
    ...(context.conversation ? { conversation: context.conversation } : {}),
    ...(context.inbox ? { inbox: context.inbox } : {}),
    ...(context.wake ? { wake: context.wake } : {}),
  };
}
