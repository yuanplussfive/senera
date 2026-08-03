import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import { AgentConversationEntryKinds, type AgentConversationEntry } from "../Conversation/AgentConversation.js";
import { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import { authoritativeConversationSequence } from "../Conversation/AgentConversationSequence.js";
import type { AgentPiModelProjection } from "./AgentPiTypes.js";

export interface AgentPiConversationProjection {
  history: AgentMessage[];
  input: string;
}

const EmptyUsage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

export class AgentPiConversationProjector {
  constructor(private readonly conversationPolicy = new AgentConversationPolicy()) {}

  project(input: {
    requestId: string;
    userInput: string;
    conversationEntries: readonly AgentConversationEntry[];
    model: AgentPiModelProjection;
  }): AgentPiConversationProjection {
    const sequence = authoritativeConversationSequence(input.conversationEntries);
    const currentUser = sequence.find(
      (entry): entry is Extract<AgentConversationEntry, { kind: "user.message" }> =>
        entry.kind === AgentConversationEntryKinds.UserMessage && entry.requestId === input.requestId,
    );
    return {
      history: sequence
        .filter((entry) => entry.requestId !== input.requestId)
        .map((entry) => this.projectHistoricalEntry(entry, input.model)),
      input: currentUser ? this.conversationPolicy.renderCurrentUserMessage(currentUser) : input.userInput,
    };
  }

  private projectHistoricalEntry(entry: AgentConversationEntry, model: AgentPiModelProjection): AgentMessage {
    return entry.kind === AgentConversationEntryKinds.UserMessage
      ? {
          role: "user",
          content: [{ type: "text", text: this.conversationPolicy.renderHistoricalUserMessage(entry) }],
          timestamp: parseTimestamp(entry.timestamp),
        }
      : projectAssistantMessage(entry, model);
  }
}

function projectAssistantMessage(
  entry: Extract<AgentConversationEntry, { kind: "assistant.decision" }>,
  model: AgentPiModelProjection,
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: entry.xml }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { ...EmptyUsage, cost: { ...EmptyUsage.cost } },
    stopReason: "stop",
    timestamp: parseTimestamp(entry.timestamp),
  };
}

function parseTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}
