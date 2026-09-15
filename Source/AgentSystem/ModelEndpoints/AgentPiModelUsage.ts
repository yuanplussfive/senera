import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createProviderReportedUsage, type AgentModelUsageValue } from "./AgentModelUsage.js";

export function projectAgentPiAssistantUsage(message: AssistantMessage): AgentModelUsageValue | undefined {
  const usage = message.usage;
  if (
    usage.input === 0 &&
    usage.output === 0 &&
    usage.totalTokens === 0 &&
    usage.cacheRead === 0 &&
    usage.cacheWrite === 0 &&
    usage.reasoning === undefined
  ) {
    return undefined;
  }
  return createProviderReportedUsage({
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    reasoningTokens: usage.reasoning,
  });
}
