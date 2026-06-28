import type { AgentModelUsage } from "../ModelEndpoints/AgentModelMetadata.js";

export interface AgentDecisionXmlTokenEstimator {
  estimate(text: string): {
    tokenCount: number;
  };
}

export class AgentDecisionXmlUsageEstimator {
  constructor(private readonly tokenEstimator: AgentDecisionXmlTokenEstimator) {}

  estimate(text: string): AgentModelUsage {
    return {
      source: "local_estimate",
      outputTokens: this.tokenEstimator.estimate(text).tokenCount,
    };
  }
}
