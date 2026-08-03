import { AgentModelUsageSources, type AgentModelUsageValue } from "../ModelEndpoints/AgentModelUsage.js";
import { AgentModelTokenEstimator } from "../Text/AgentTextBudget.js";
import type { AgentPiAssistantMessage } from "../PiShared/AgentPiPlanningTypes.js";
import type { PiOpenAiChatCompletionRequest } from "./AgentPiOpenAiWireTypes.js";

export class AgentPiOuterUsageEstimator {
  private readonly estimator: AgentModelTokenEstimator;

  constructor(model: string) {
    this.estimator = new AgentModelTokenEstimator({ model });
  }

  estimate(request: PiOpenAiChatCompletionRequest, response: AgentPiAssistantMessage): AgentModelUsageValue {
    const inputTokens = this.estimator.estimate(
      JSON.stringify({
        messages: request.messages,
        tools: request.tools,
        tool_choice: request.tool_choice,
      }),
    ).tokenCount;
    const outputTokens = this.estimator.estimate(
      JSON.stringify({ content: response.content, tool_calls: response.toolCalls }),
    ).tokenCount;
    return {
      source: AgentModelUsageSources.LocalEstimate,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedFields: ["inputTokens", "outputTokens", "totalTokens"],
    };
  }
}
