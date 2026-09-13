import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { AgentLongLivedCacheRetention, createAgentModelCacheOptions } from "../ModelEndpoints/AgentModelCacheScope.js";
import { AgentNativeToolApiByEndpoint, type AgentNativeToolApi } from "../ModelEndpoints/AgentModelEndpointContract.js";
import type { AgentLanguageModelCacheOptions } from "../ModelEndpoints/AgentLanguageModel.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";

/** Keep the logical conversation warm across the provider's long retention window. */
export const AgentPiInteractiveCacheRetention = AgentLongLivedCacheRetention;

export type AgentPiPromptCachePhase =
  | "native-conversation"
  | "native-channel-rewrite"
  | "baml-channel-rewrite"
  | "baml-planning"
  | "baml-compaction"
  | "tool-learning"
  | "goal-decision"
  | "resident-speech-action-preface"
  | "resident-speech-final-response";

export interface AgentPiPromptCacheModelIdentity {
  readonly provider: string;
  readonly api: AgentNativeToolApi | string;
  readonly model: string;
}

export interface AgentPiPromptCacheToolIdentity {
  readonly name: string;
  readonly description: string;
  readonly parameters: unknown;
}

export interface AgentPiPromptCacheStablePrefix {
  readonly systemPrompt?: string;
  readonly tools?: readonly AgentPiPromptCacheToolIdentity[];
}

/**
 * A logical cache scope survives physical session rotation (for example a
 * Pi history compression) while remaining isolated between conversations.
 * The provider receives the opaque digest, so channel identifiers and other
 * routing metadata never become part of the prompt-cache key verbatim.
 */
export function createAgentPiLogicalCacheScope(input: {
  /** Physical session identity. Kept for console and legacy callers. */
  readonly sessionId?: string;
  /** Stable host-owned identity of a conversation space. */
  readonly identity?: string;
  readonly family?: string;
}): string {
  const identity = resolveLogicalCacheIdentity(input);
  return sha256HexOfCanonicalJson({
    namespace: "senera.pi.logical-cache",
    family: input.family?.trim() || "conversation",
    identity,
  });
}

/**
 * Keeps unrelated Pi call families out of the same provider routing bucket.
 *
 * The scope is a logical conversation affinity, not a content fingerprint.
 * Pi providers already compare the actual serialized prompt and tool schemas
 * when deciding how much of the prefix can be reused. Including volatile
 * system/context text or the active tool set here would rotate the
 * provider session on every world update or ToolSearch result. Static prompt
 * and tool schema content is fingerprinted separately, so a genuine protocol
 * change gets a new cache bucket without making ordinary turn state part of it.
 */
export function createAgentPiPromptCacheOptions(input: {
  readonly phase: AgentPiPromptCachePhase;
  readonly sessionId?: string;
  readonly logicalCacheScope?: string;
  readonly model: AgentPiPromptCacheModelIdentity;
  readonly stablePrefix?: AgentPiPromptCacheStablePrefix;
}): AgentLanguageModelCacheOptions {
  const logicalCacheScope = requireAgentPiPromptCacheScope(
    input.logicalCacheScope ??
      (input.sessionId
        ? createAgentPiLogicalCacheScope({ sessionId: input.sessionId, family: "conversation" })
        : undefined),
  );
  const stablePrefix = input.stablePrefix
    ? {
        systemPrompt: input.stablePrefix.systemPrompt ?? "",
        tools: input.stablePrefix.tools ?? [],
      }
    : undefined;
  const cache = createAgentModelCacheOptions({
    namespace: "senera.pi",
    identity: {
      phase: input.phase,
      logicalCacheScope,
      model: {
        provider: requireText(input.model.provider, "provider"),
        api: requireText(input.model.api, "API"),
        model: requireText(input.model.model, "model"),
      },
    },
    sessionId: input.sessionId,
    logicalCacheScope,
    retention: AgentPiInteractiveCacheRetention,
    stablePrefix,
  });
  return cache;
}

export function projectAgentPiPromptCacheModel(
  input: Pick<ResolvedAgentModelProviderConfig, "ProviderId" | "Endpoint" | "Model">,
): AgentPiPromptCacheModelIdentity {
  return {
    provider: input.ProviderId,
    api: AgentNativeToolApiByEndpoint[input.Endpoint],
    model: input.Model,
  };
}

export function requireAgentPiPromptCacheSessionId(sessionId: string | undefined): string {
  return requireText(sessionId ?? "", "session ID");
}

export function requireAgentPiPromptCacheScope(scope: string | undefined): string {
  return requireText(scope ?? "", "logical cache scope");
}

function requireText(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Pi prompt cache ${name} must not be empty.`);
  return normalized;
}

function resolveLogicalCacheIdentity(input: { readonly sessionId?: string; readonly identity?: string }): string {
  const identity = input.identity?.trim();
  if (identity) return identity;
  return requireAgentPiPromptCacheSessionId(input.sessionId);
}
