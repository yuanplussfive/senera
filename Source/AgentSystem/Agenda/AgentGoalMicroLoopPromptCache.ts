import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { AgentLongLivedCacheRetention, createAgentModelCacheOptions } from "../ModelEndpoints/AgentModelCacheScope.js";
import type { AgentLanguageModelCacheOptions } from "../ModelEndpoints/AgentLanguageModel.js";

/**
 * Provider-neutral cache identity for the Goal decision call family.
 * Volatile goal state is deliberately absent from this identity.
 */
export function createAgentGoalMicroLoopCacheOptions(input: {
  readonly worldId: string;
  readonly provider: string;
  readonly api: string;
  readonly model: string;
  readonly stableSystemPrompt?: string;
}): AgentLanguageModelCacheOptions {
  const worldId = requireText(input.worldId, "Goal micro-loop world id");
  const provider = requireText(input.provider, "Goal micro-loop provider");
  const api = requireText(input.api, "Goal micro-loop API");
  const model = requireText(input.model, "Goal micro-loop model");
  return createAgentModelCacheOptions({
    namespace: "senera.goal-micro-loop",
    identity: {
      phase: "goal-decision",
      worldId,
      provider,
      api,
      model,
      ...(input.stableSystemPrompt ? { stablePrefixRevision: sha256HexOfCanonicalJson(input.stableSystemPrompt) } : {}),
    },
    retention: AgentLongLivedCacheRetention,
  });
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}
