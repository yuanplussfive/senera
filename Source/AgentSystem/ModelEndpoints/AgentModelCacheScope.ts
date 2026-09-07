import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentLanguageModelCacheOptions, AgentModelCacheRetention } from "./AgentLanguageModel.js";

/** Shared provider-cache policy for persistent Senera conversations and ledgers. */
export const AgentLongLivedCacheRetention = "long" as const;

/** Builds a provider-safe, content-addressed routing scope for one stable model-call family. */
export function createAgentModelCacheOptions(input: {
  readonly namespace: string;
  readonly identity: unknown;
  readonly retention: AgentModelCacheRetention;
}): AgentLanguageModelCacheOptions {
  const namespace = requireCacheScopePart(input.namespace, "namespace");
  return {
    scope: sha256HexOfCanonicalJson({ namespace, identity: input.identity }),
    retention: input.retention,
  };
}

/** Separates functions with different immutable contracts while retaining their parent routing identity. */
export function deriveAgentModelCacheOptions(
  parent: AgentLanguageModelCacheOptions | undefined,
  discriminator: string,
): AgentLanguageModelCacheOptions | undefined {
  if (!parent) return undefined;
  return createAgentModelCacheOptions({
    namespace: "senera.model-call",
    identity: {
      parentScope: parent.scope,
      discriminator: requireCacheScopePart(discriminator, "discriminator"),
    },
    retention: parent.retention,
  });
}

function requireCacheScopePart(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Model cache scope ${name} must not be empty.`);
  return normalized;
}
