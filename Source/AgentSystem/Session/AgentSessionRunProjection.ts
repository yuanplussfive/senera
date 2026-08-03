import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import { type AgentConversationEntryKinds, type AgentConversationEntry } from "../Conversation/AgentConversation.js";
import { type AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import type { AgentSession } from "./AgentSession.js";
import type { AgentSessionMessageQueueMode } from "./AgentSessionMessageQueueMode.js";

export function cloneAgentSessionState(session: AgentSession): AgentSession {
  return structuredClone(session);
}

export function replaceAgentSessionState(target: AgentSession, source: AgentSession): void {
  if (target.id !== source.id) {
    throw new Error(`Cannot replace session ${target.id} with state from ${source.id}.`);
  }

  const targetRecord = target as unknown as Record<string, unknown>;
  for (const key of Object.keys(targetRecord)) {
    delete targetRecord[key];
  }
  Object.assign(targetRecord, structuredClone(source));
}

export function projectSessionUserEntry(
  projector: AgentConversationProjector,
  requestId: string,
  request: {
    input: string;
    attachments?: AgentUploadAttachment[];
    queue?: {
      parentRequestId: string;
      mode: AgentSessionMessageQueueMode;
    };
  },
  timestamp: string,
): Extract<AgentConversationEntry, { kind: typeof AgentConversationEntryKinds.UserMessage }> {
  return projector.projectUserInput(
    requestId,
    request.input,
    timestamp,
    request.queue ? { queue: request.queue } : undefined,
    request.attachments,
  );
}

export function stampSessionStepTraces(
  traces: ReadonlyArray<StepTrace>,
  startedAt: string,
  endedAt: string,
): StepTrace[] {
  return traces.map((trace) => ({
    ...trace,
    startedAt: trace.startedAt ?? startedAt,
    endedAt: trace.endedAt ?? (trace.kind === "answer" ? endedAt : startedAt),
  }));
}

export function collectFreshConversationEntries(
  previousEntries: readonly AgentConversationEntry[],
  candidateEntries: readonly AgentConversationEntry[],
): AgentConversationEntry[] {
  const previousIds = new Set(previousEntries.map((entry) => entry.id));
  const fresh: AgentConversationEntry[] = [];
  for (const entry of candidateEntries) {
    if (previousIds.has(entry.id)) {
      continue;
    }

    fresh.push(entry);
    previousIds.add(entry.id);
  }

  return fresh;
}

export function mergeSessionConversationEntries(
  conversation: AgentSession["conversation"],
): AgentSession["conversation"] {
  const seen = new Set<string>();
  return [...conversation]
    .reverse()
    .filter((entry) => {
      if (seen.has(entry.id)) {
        return false;
      }

      seen.add(entry.id);
      return true;
    })
    .reverse();
}
