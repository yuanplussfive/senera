import { DEFAULT_COMPACTION_SETTINGS } from "@earendil-works/pi-coding-agent";
import type { ResolvedAgentPiCompactionConfig } from "../Types/AgentConfigTypes.js";
import type { AgentPiProviderProjection } from "./AgentPiTypes.js";

export interface AgentPiResolvedCompactionSettings {
  readonly enabled: boolean;
  readonly reserveTokens: number;
  readonly keepRecentTokens: number;
}

export function resolveAgentPiCompactionSettings(
  config: ResolvedAgentPiCompactionConfig,
  model: AgentPiProviderProjection["model"],
): AgentPiResolvedCompactionSettings {
  const reserveTokens = Math.min(model.maxTokens, model.contextWindow);
  const remainingContextTokens = Math.max(0, model.contextWindow - reserveTokens);
  return {
    enabled: config.Enabled,
    reserveTokens,
    keepRecentTokens: Math.min(DEFAULT_COMPACTION_SETTINGS.keepRecentTokens, remainingContextTokens),
  };
}
