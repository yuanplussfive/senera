import type { AgentModelUsageCall, AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";

export interface AgentResidentSpeechUsageContext {
  readonly usageLedger: { record(call: AgentModelUsageCall): void };
}

export function createAgentResidentSpeechUsageSink(context: AgentResidentSpeechUsageContext): AgentModelUsageSink {
  return (call) => context.usageLedger.record(call);
}
