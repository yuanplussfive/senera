import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { AgentLongLivedCacheRetention, createAgentModelCacheOptions } from "../ModelEndpoints/AgentModelCacheScope.js";
import type { AgentLanguageModelCacheOptions } from "../ModelEndpoints/AgentLanguageModel.js";
import type { Tool } from "@earendil-works/pi-ai";

export function createAgentMemOSSemanticPromptCache(input: {
  readonly scopeKey: string;
  readonly phase: "fragment" | "daily" | "monthly";
  readonly provider: string;
  readonly api: string;
  readonly model: string;
  readonly systemPrompt: string;
  readonly contract: Tool | string;
}): AgentLanguageModelCacheOptions {
  const scopeKey = requireText(input.scopeKey, "scope key");
  const provider = requireText(input.provider, "provider");
  const api = requireText(input.api, "API");
  const model = requireText(input.model, "model");
  return createAgentModelCacheOptions({
    namespace: "senera.memos.semantic",
    identity: {
      scopeKey,
      phase: input.phase,
      provider,
      api,
      model,
      staticContractRevision: sha256HexOfCanonicalJson({
        systemPrompt: input.systemPrompt,
        contract: input.contract,
      }),
    },
    logicalCacheScope: sha256HexOfCanonicalJson({
      namespace: "senera.memos.semantic.logical",
      scopeKey,
      phase: input.phase,
    }),
    retention: AgentLongLivedCacheRetention,
    stablePrefix: {
      systemPrompt: input.systemPrompt,
      tools: typeof input.contract === "string" ? [] : [input.contract],
    },
  });
}

function requireText(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`MemOS semantic prompt cache ${name} must not be empty.`);
  return normalized;
}
