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
  const worldId = requireText(input.worldId, "Resident idle world id");
  const provider = requireText(input.provider, "Resident idle provider");
  const api = requireText(input.api, "Resident idle API");
  const model = requireText(input.model, "Resident idle model");
  return createAgentModelCacheOptions({
    namespace: "senera.resident-idle",
    identity: {
      phase: "resident-idle-decision",
      worldId,
      provider,
      api,
      model,
      ...(input.stableSystemPrompt ? { stablePrefixRevision: sha256HexOfCanonicalJson(input.stableSystemPrompt) } : {}),
    },
    logicalCacheScope: sha256HexOfCanonicalJson({
      namespace: "senera.resident-idle.logical",
      worldId,
    }),
    retention: AgentLongLivedCacheRetention,
    ...(input.stableSystemPrompt
      ? {
          stablePrefix: {
            systemPrompt: input.stableSystemPrompt,
            tools: [],
          },
        }
      : {}),
  });
}
