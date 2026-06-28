import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import {
  AgentConversationEntryKinds,
  type AgentConversationEntry,
} from "../Conversation/AgentConversation.js";
import { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import { AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import type { AgentSession } from "./AgentSession.js";

export function projectSessionUserEntry(
  projector: AgentConversationProjector,
  requestId: string,
  request: {
    input: string;
    attachments?: AgentUploadAttachment[];
  },
  timestamp: string,
): Extract<AgentConversationEntry, { kind: typeof AgentConversationEntryKinds.UserMessage }> {
  return projector.projectUserInput(
    requestId,
    request.input,
    timestamp,
    undefined,
    request.attachments,
  );
}

export function materializeSessionRunMessages(
  policy: AgentConversationPolicy,
  session: AgentSession,
  userEntry: Extract<AgentConversationEntry, { kind: typeof AgentConversationEntryKinds.UserMessage }>,
): AgentLanguageModelMessage[] {
  return [
    ...policy.materialize(session.conversation, {
      toolResultsScope: {
        kind: "none",
      },
      evidenceMemoryScope: {
        kind: "all",
      },
    }),
    {
      role: "user",
      content: policy.renderCurrentUserMessage(userEntry),
    },
  ];
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
  return [...conversation].reverse().filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }

    seen.add(entry.id);
    return true;
  }).reverse();
}
