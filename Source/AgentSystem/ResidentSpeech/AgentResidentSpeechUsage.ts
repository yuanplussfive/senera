import type { AgentModelUsageCall, AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";

export interface AgentResidentSpeechUsageContext {
  readonly usageLedger: { record(call: AgentModelUsageCall): void };
  readonly tokenBudget: { recordProviderInputTokens(tokens: number): void };
}

export function createAgentResidentSpeechUsageSink(context: AgentResidentSpeechUsageContext): AgentModelUsageSink {
  return (call) => {
    context.usageLedger.record(call);
    context.tokenBudget.recordProviderInputTokens(
      (call.usage.inputTokens ?? 0) + (call.usage.cacheReadTokens ?? 0) + (call.usage.cacheWriteTokens ?? 0),
    );
  };
}
