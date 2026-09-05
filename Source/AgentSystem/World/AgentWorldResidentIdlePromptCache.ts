import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { AgentLongLivedCacheRetention, createAgentModelCacheOptions } from "../ModelEndpoints/AgentModelCacheScope.js";
import type { AgentLanguageModelCacheOptions } from "../ModelEndpoints/AgentLanguageModel.js";

export function createAgentResidentIdleCacheOptions(input: {
  readonly worldId: string;
  readonly provider: string;
  readonly api: string;
  readonly model: string;
  readonly stableSystemPrompt?: string;
}): AgentLanguageModelCacheOptions {
  const requireText = (value: string, label: string) => {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${label} must not be empty.`);
    return normalized;
  };
  return createAgentModelCacheOptions({
    namespace: "senera.resident-idle",
    identity: {
      phase: "resident-idle-decision",
      worldId: requireText(input.worldId, "Resident idle world id"),
      provider: requireText(input.provider, "Resident idle provider"),
      api: requireText(input.api, "Resident idle API"),
      model: requireText(input.model, "Resident idle model"),
      ...(input.stableSystemPrompt ? { stablePrefixRevision: sha256HexOfCanonicalJson(input.stableSystemPrompt) } : {}),
    },
    retention: AgentLongLivedCacheRetention,
  });
}
