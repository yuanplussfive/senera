import type { Tool } from "@earendil-works/pi-ai";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { AgentLongLivedCacheRetention, createAgentModelCacheOptions } from "../ModelEndpoints/AgentModelCacheScope.js";
import type { AgentLanguageModelCacheOptions } from "../ModelEndpoints/AgentLanguageModel.js";

export type AgentTemporalMemoryModelPhase = "conversation-boundary" | "digest-summary";

/**
 * Isolates temporal-memory calls by identity and immutable prompt contract.
 * Volatile episode or digest content deliberately stays out of the routing key.
 */
export function createAgentTemporalMemoryPromptCache(input: {
  readonly scopeKey: string;
  readonly phase: AgentTemporalMemoryModelPhase;
  readonly model: string;
  readonly systemPrompt: string;
  readonly contract: Tool | string;
}): AgentLanguageModelCacheOptions {
  return createAgentModelCacheOptions({
    namespace: "senera.temporal-memory",
    identity: {
      scopeKey: requireText(input.scopeKey, "scope key"),
      phase: input.phase,
      model: requireText(input.model, "model"),
      staticContractRevision: sha256HexOfCanonicalJson({
        systemPrompt: input.systemPrompt,
        contract: input.contract,
      }),
    },
    retention: AgentLongLivedCacheRetention,
  });
}

function requireText(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Temporal memory prompt cache ${name} must not be empty.`);
  return normalized;
}
