import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import { createAssistantMessageId } from "../Core/AgentIds.js";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentExecutionResult } from "../ToolRuntime/AgentToolCallExecutionTypes.js";
import type { AgentModelProviderMetadata, AgentModelUsage } from "../ModelEndpoints/AgentModelMetadata.js";
import type { StepTrace } from "./AgentStepTrace.js";
import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";

export type AgentTerminalResult =
  | {
      kind: "FinalAnswer";
      content: string;
    }
  | {
      kind: "AskUser";
      question: string;
      reasonCode?: string;
    };

export interface AgentProjectedTerminalResult {
  event: Extract<AgentDomainEvent, { kind: typeof AgentEventKinds.AssistantMessageCreated }>;
  result: AgentTerminalResult;
}

export interface AgentCompletedRunResult {
  terminal: AgentTerminalResult;
  decisionXml: string;
  modelProvider?: AgentModelProviderMetadata;
  usage?: AgentModelUsage;
  conversationEntries: AgentConversationEntry[];
  stepTraces: StepTrace[];
  turnUnderstanding?: TurnUnderstanding;
  loadedToolNames?: "all" | string[];
}

export class AgentExecutionProjector {
  projectTerminal(
    requestId: string,
    execution: Extract<AgentExecutionResult, { kind: "AskUser" }>,
  ): AgentProjectedTerminalResult {
    const question = this.readStringField(execution.value, "question");
    const reasonCode = this.readOptionalStringField(execution.value, "reason_code");
    return {
      event: {
        kind: AgentEventKinds.AssistantMessageCreated,
        context: {
          requestId,
        },
        data: {
          messageId: createAssistantMessageId(),
          kind: "ask_user",
          content: question,
          terminal: true,
          reasonCode,
        },
      },
      result: {
        kind: "AskUser" as const,
        question,
        reasonCode,
      },
    };
  }

  private readStringField(value: unknown, key: string): string {
    return value && typeof value === "object" && key in value
      ? String((value as Record<string, unknown>)[key] ?? "")
      : "";
  }

  private readOptionalStringField(value: unknown, key: string): string | undefined {
    const valueText = this.readStringField(value, key);
    return valueText.length > 0 ? valueText : undefined;
  }
}
