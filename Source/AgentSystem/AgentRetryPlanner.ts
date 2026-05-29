import type { AgentLanguageModelMessage } from "./AgentLanguageModel.js";
import type { AgentExceededTextBudgetSnapshot } from "./AgentTextBudget.js";
import { AgentDecisionErrorFactory } from "./AgentDecisionErrorFactory.js";

export class AgentRetryPlanner {
  private readonly errors: AgentDecisionErrorFactory;

  constructor(errorFactory?: AgentDecisionErrorFactory) {
    this.errors = errorFactory ?? new AgentDecisionErrorFactory();
  }

  buildRepairConversation(
    messages: AgentLanguageModelMessage[],
    modelResponseText: string,
    error: import("./AgentRetryableError.js").AgentRetryableError,
  ): AgentLanguageModelMessage[] {
    return [
      ...messages,
      ...(modelResponseText.trim().length > 0
        ? [{
            role: "assistant" as const,
            content: modelResponseText,
          }]
        : []),
      {
        role: "user",
        content: error.instruction.repairPrompt ?? error.message,
      },
    ];
  }

  buildDecisionXmlTokenLimitError(
    budget: AgentExceededTextBudgetSnapshot,
  ) {
    return this.errors.decisionXmlTokenLimitExceeded(budget);
  }
}
