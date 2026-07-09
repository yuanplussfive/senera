import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Message, Usage } from "@earendil-works/pi-ai";
import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
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
  project(
    messages: readonly AgentLanguageModelMessage[],
    input: string,
    model: AgentPiModelProjection,
  ): AgentPiConversationProjection {
    const historyMessages = stripCurrentUserMessage(messages, input);
    return {
      history: historyMessages.map((message) => this.projectMessage(message, model)),
      input: readCurrentPrompt(messages, input),
    };
  }

  private projectMessage(
    message: AgentLanguageModelMessage,
    model: AgentPiModelProjection,
  ): Message {
    return message.role === "user"
      ? {
          role: "user",
          content: [{ type: "text", text: message.content }],
          timestamp: Date.now(),
        }
      : this.historicalAssistantMessage(message.content, model);
  }

  private historicalAssistantMessage(
    content: string,
    model: AgentPiModelProjection,
  ): AssistantMessage {
    return {
      role: "assistant",
      content: [{ type: "text", text: content }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { ...EmptyUsage, cost: { ...EmptyUsage.cost } },
      stopReason: "stop",
      timestamp: Date.now(),
    };
  }
}

function stripCurrentUserMessage(
  messages: readonly AgentLanguageModelMessage[],
  input: string,
): readonly AgentLanguageModelMessage[] {
  const last = messages.at(-1);
  return last?.role === "user" && last.content === input
    ? messages.slice(0, -1)
    : messages;
}

function readCurrentPrompt(
  messages: readonly AgentLanguageModelMessage[],
  input: string,
): string {
  const last = messages.at(-1);
  return last?.role === "user" ? last.content : input;
}
