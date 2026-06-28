import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentExceededTextBudgetSnapshot } from "../Text/AgentTextBudget.js";
import { AgentDecisionErrorFactory } from "../Decision/AgentDecisionErrorFactory.js";
import type { AgentRetryableError } from "./AgentRetryableError.js";

export class AgentRetryPlanner {
  private readonly errors: AgentDecisionErrorFactory;

  constructor(errorFactory?: AgentDecisionErrorFactory) {
    this.errors = errorFactory ?? new AgentDecisionErrorFactory();
  }

  buildRepairConversation(
    messages: AgentLanguageModelMessage[],
    modelResponseText: string,
    error: AgentRetryableError,
  ): AgentLanguageModelMessage[] {
    return [
      ...messages,
      ...this.buildAssistantRepairEcho(modelResponseText, error),
      {
        role: "user",
        content: error.instruction.repairPrompt ?? error.message,
      },
    ];
  }

  private buildAssistantRepairEcho(
    modelResponseText: string,
    error: AgentRetryableError,
  ): AgentLanguageModelMessage[] {
    if (modelResponseText.trim().length === 0) {
      return [];
    }

    const details = error.instruction.details;
    if (isRecord(details) && details.suppressAssistantRepairEcho === true) {
      const shape = typeof details.previousOutputShape === "string"
        ? details.previousOutputShape
        : "不符合本轮 Action 的输出";
      return [{
        role: "assistant",
        content: `上一条输出已丢弃：${shape}。不要模仿上一条输出，只按下一条修复指令重新输出。`,
      }];
    }

    return [{
      role: "assistant",
      content: modelResponseText,
    }];
  }

  buildDecisionXmlTokenLimitError(
    budget: AgentExceededTextBudgetSnapshot,
  ) {
    return this.errors.decisionXmlTokenLimitExceeded(budget);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
