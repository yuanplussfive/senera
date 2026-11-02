import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentLanguageModelCacheOptions, AgentModelCacheRetention } from "./AgentLanguageModel.js";
import { projectAgentStablePrefixBytes, projectAgentStablePrefixRevision } from "./AgentPromptWireSnapshot.js";

/** Shared provider-cache policy for persistent Senera conversations and ledgers. */
export const AgentLongLivedCacheRetention = "long" as const;

export interface AgentModelCacheStablePrefix {
  readonly systemPrompt: string;
  readonly tools?: readonly unknown[];
}

/**
 * Binds an existing cache affinity to the immutable wire prefix of a call.
 *
 * A caller may only know the broad workflow identity when it creates its
 * cache options. Required-tool clients learn the final system prompt and
 * schema at the invocation boundary, so they use this helper to prevent a
 * contract change from reusing a provider cache entry with a stale prefix.
 */
export function ensureAgentModelCacheStablePrefix(
  cache: AgentLanguageModelCacheOptions | undefined,
  input: {
    readonly discriminator: string;
    readonly stablePrefix: AgentModelCacheStablePrefix;
  },
): AgentLanguageModelCacheOptions | undefined {
  if (!cache) return undefined;
  const stablePrefix = {
    systemPrompt: input.stablePrefix.systemPrompt,
    tools: input.stablePrefix.tools ?? [],
  };
  const stablePrefixRevision = projectAgentStablePrefixRevision(stablePrefix);
  const stablePrefixBytes = projectAgentStablePrefixBytes(stablePrefix);
  if (cache.stablePrefixRevision === stablePrefixRevision && cache.stablePrefixBytes === stablePrefixBytes) {
    return cache;
  }
  return createAgentModelCacheOptions({
    namespace: "senera.model-call",
    identity: {
      parentScope: cache.scope,
      discriminator: requireCacheScopePart(input.discriminator, "discriminator"),
    },
    retention: cache.retention,
    sessionId: cache.sessionId,
    logicalCacheScope: cache.logicalCacheScope,
    stablePrefix,
  });
}

/** Builds a provider-safe, content-addressed routing scope for one stable model-call family. */
export function createAgentModelCacheOptions(input: {
  readonly namespace: string;
  readonly identity: unknown;
  readonly retention: AgentModelCacheRetention;
  readonly sessionId?: string;
  readonly logicalCacheScope?: string;
  readonly stablePrefix?: AgentModelCacheStablePrefix;
}): AgentLanguageModelCacheOptions {
  const namespace = requireCacheScopePart(input.namespace, "namespace");
  const sessionId = input.sessionId?.trim();
  const logicalCacheScope = input.logicalCacheScope?.trim();
  const stablePrefix = input.stablePrefix
    ? {
        systemPrompt: input.stablePrefix.systemPrompt,
        tools: input.stablePrefix.tools ?? [],
      }
    : undefined;
  const stablePrefixRevision = stablePrefix ? projectAgentStablePrefixRevision(stablePrefix) : undefined;
  return {
    scope: sha256HexOfCanonicalJson({
      namespace,
      identity: {
        ...asIdentityRecord(input.identity),
        ...(stablePrefixRevision ? { stablePrefixRevision } : {}),
      },
    }),
    retention: input.retention,
    ...(sessionId ? { sessionId } : {}),
    ...(logicalCacheScope ? { logicalCacheScope } : {}),
    ...(stablePrefix
      ? {
          stablePrefixRevision,
          stablePrefixBytes: projectAgentStablePrefixBytes(stablePrefix),
        }
      : {}),
  };
}

/** Separates functions with different immutable contracts while retaining their parent routing identity. */
export function deriveAgentModelCacheOptions(
  parent: AgentLanguageModelCacheOptions | undefined,
  discriminator: string,
  stablePrefix?: AgentModelCacheStablePrefix,
): AgentLanguageModelCacheOptions | undefined {
  if (!parent) return undefined;
  return createAgentModelCacheOptions({
    namespace: "senera.model-call",
    identity: {
      parentScope: parent.scope,
      discriminator: requireCacheScopePart(discriminator, "discriminator"),
    },
    sessionId: parent.sessionId,
    logicalCacheScope: parent.logicalCacheScope,
    retention: parent.retention,
    stablePrefix,
  });
}

function asIdentityRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { value };
  }
  return value as Record<string, unknown>;
}

function requireCacheScopePart(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Model cache scope ${name} must not be empty.`);
  return normalized;
}
