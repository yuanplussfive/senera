import type { ConversationEntryMetadata } from "../../api/eventTypes";
import type { ChatMessage, SessionRecord } from "./types";

type QueueMode = NonNullable<ConversationEntryMetadata["queue"]>["mode"];

function readQueuedUserMessage(session: SessionRecord, requestId: string | undefined): ChatMessage | undefined {
  if (!requestId) return undefined;
  return session.messages.find((message) => message.role === "user" && message.requestId === requestId);
}

/** Records the host's durable acceptance of a message joined to an active run. */
export function confirmQueuedMessage(
  session: SessionRecord,
  input: {
    requestId?: string;
    parentRequestId: string;
    mode: QueueMode;
    status?: import("../../../../Source/AgentSystem/Core/AgentSessionInputContract").AgentSessionInputState;
    message?: string;
  },
): boolean {
  const message = readQueuedUserMessage(session, input.requestId);
  if (!message) return false;
  message.metadata = {
    ...message.metadata,
    queue: {
      parentRequestId: input.parentRequestId,
      mode: input.mode,
      status: input.status,
      ...(input.message ? { message: input.message } : {}),
    },
  };
  delete message.queueAdmission;
  if (input.parentRequestId === input.requestId && input.status !== "pending") delete message.metadata.queue;
  return true;
}

/** Clears only the transient admission marker when the host opens a fresh run. */
export function clearQueuedMessageAdmission(session: SessionRecord, requestId: string | undefined): boolean {
  const message = readQueuedUserMessage(session, requestId);
  if (!message) return false;
  if (message.metadata?.queue) delete message.metadata.queue;
  delete message.queueAdmission;
  return true;
}

/** Keeps a rejected queued submission visible instead of leaving an unlabelled bubble. */
export function rejectQueuedMessage(session: SessionRecord, requestId: string | undefined, message: string): boolean {
  const queued = readQueuedUserMessage(session, requestId);
  if (!queued?.queueAdmission) return false;
  queued.queueAdmission = {
    ...queued.queueAdmission,
    status: "rejected",
    message,
  };
  return true;
}
