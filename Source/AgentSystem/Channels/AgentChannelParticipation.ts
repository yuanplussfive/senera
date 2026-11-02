import type { AgentChannelInboundMessage, AgentChannelSource } from "./AgentChannelTypes.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";

export type AgentChannelWakeEvent = "message" | "mention" | "reply" | "poke" | "recall" | "membership";

/** Conditions are protocol facts. Topic relevance is decided by the participant's model. */
export interface AgentChannelWaitConditions {
  /** Native participant scope comes from this task; ambient activity cannot extend its wait. */
  readonly taskId?: string;
  readonly events: readonly AgentChannelWakeEvent[];
  /** Limits ambient messages/events; selected mention/reply/poke events address you independently. */
  readonly senderIds?: readonly string[];
  readonly wakeAt?: string;
}

export interface AgentChannelObservedEvent {
  readonly actor?: { readonly reference: string; readonly kind: "user" | "agent" };
  readonly sequence: number;
  readonly message: AgentChannelInboundMessage;
  readonly attachments?: readonly AgentUploadAttachment[];
}

export interface AgentChannelParticipant {
  /** Host scheduling receipt; never a model-supplied wait condition. */
  readonly scheduledRevision?: number;
  readonly actor?: import("../Interaction/AgentInteractionIdentity.js").AgentInteractionIdentity;
  readonly sessionId: string;
  readonly source: AgentChannelSource;
  readonly cursor: number;
  readonly status: "active" | "waiting" | "ready" | "paused";
  readonly waitId?: string;
  readonly requestId?: string;
  readonly conditions?: AgentChannelWaitConditions;
  readonly wakeReason?: "event" | "time";
  readonly pendingSequence?: number;
  readonly resumeRequestId?: string;
  readonly activeRequestId?: string;
}

export interface AgentChannelHistoryPage {
  readonly entries: readonly AgentChannelObservedEvent[];
  readonly throughSequence: number;
  readonly hasMore: boolean;
}

export interface AgentChannelWaitRegistration {
  readonly status: "waiting";
  readonly waiting: true;
  readonly waitId: string;
  readonly afterSequence: number;
  readonly conditions: AgentChannelWaitConditions;
  readonly control: { readonly kind: "SuspendRun"; readonly reason: "channel-wait"; readonly id: string };
}

export interface AgentChannelInboxReview {
  readonly status: "needs_review";
  readonly inbox: import("../Interaction/AgentInteractionContext.js").AgentInteractionInbox;
}

export type AgentChannelSendReceipt = { readonly status: "sent"; readonly messageId: string } | AgentChannelInboxReview;

/** messageIds contains only confirmed deliveries, in input order, including partial success. */
export type AgentChannelMessageBatchReceipt =
  | { readonly status: "sent"; readonly messageIds: readonly string[] }
  | (AgentChannelInboxReview & { readonly messageIds: readonly string[] })
  | {
      readonly status: "failed";
      readonly messageIds: readonly string[];
      readonly code:
        | import("./AgentChannelDelivery.js").AgentChannelDeliveryFailureCode
        | "cancelled"
        | "review_failed"
        | "delivery_failed"
        | "history_failed";
      readonly error: string;
    };

/** The same protocol identity is used by ingestion, history binding and invalidation. */
export function agentChannelHistoryEntryKey(
  message: Pick<AgentChannelInboundMessage, "source" | "event">,
): string | undefined {
  return message.event
    ? `event:${message.event.id}`
    : message.source.messageId
      ? `message:${message.source.messageId}`
      : undefined;
}

export function matchesAgentChannelWait(
  participant: AgentChannelParticipant,
  message: AgentChannelInboundMessage,
  selfId?: string,
): boolean {
  const conditions = participant.conditions;
  if (message.task?.sessionId === participant.sessionId) return false;
  if (!conditions) return true;
  const senderId = message.event?.actorId ?? message.senderId ?? message.source.userId;
  if (senderId === selfId) return false;
  const senderMatches = !conditions.senderIds?.length || conditions.senderIds.includes(senderId);
  return conditions.events.some((event) => {
    switch (event) {
      case "message":
        return senderMatches && (!message.event || message.event.type === "file");
      case "mention":
        return Boolean(
          message.addressedToSelf ||
          (selfId &&
            message.segments?.some(
              (segment) => segment.type === "at" && (String(segment.data.qq) === selfId || segment.data.qq === "all"),
            )),
        );
      case "reply":
        return Boolean(selfId && message.replyToSenderId === selfId);
      case "poke":
        return message.event?.type === "poke" && message.event.targetId === selfId;
      case "recall":
        return senderMatches && message.event?.type === "recall";
      case "membership":
        return senderMatches && (message.event?.type === "member_joined" || message.event?.type === "member_left");
    }
  });
}
