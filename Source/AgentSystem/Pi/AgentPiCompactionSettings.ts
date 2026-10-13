import { DEFAULT_COMPACTION_SETTINGS } from "@earendil-works/pi-coding-agent";
import type { ResolvedAgentPiCompactionConfig } from "../Types/AgentConfigTypes.js";
import type { AgentPiProviderProjection } from "./AgentPiTypes.js";

export interface AgentPiCompactionWindowPolicy {
  readonly contextWindowTokens: number;
  readonly inputCapacityTokens: number;
  readonly reserveTokens: number;
  readonly keepRecentTokens: number;
}

export interface AgentPiResolvedCompactionSettings extends AgentPiCompactionWindowPolicy {
  readonly enabled: boolean;
}

/**
 * Derives a context-sized compaction reserve from Pi's recent-history target.
 * The reserve is deliberately not tied to a fixed token constant: small
 * windows split their capacity, while larger windows use Pi's bounded recent
 * history target as the summary/output reserve.
 */
export function resolveAgentPiCompactionReserveTokens(contextWindowTokens: number): number {
  return resolveAgentPiCompactionWindow(contextWindowTokens).reserveTokens;
}

export function resolveAgentPiRecentWindowTokens(contextWindowTokens: number): number {
  return resolveAgentPiCompactionWindow(contextWindowTokens).keepRecentTokens;
}

/**
 * Resolves the one context policy shared by Pi compaction and Senera's
 * observation budget. Pi still owns when compaction runs; this only supplies
 * the settings and matching input capacity for the current model window.
 */
export function resolveAgentPiCompactionWindow(contextWindowTokens: number): AgentPiCompactionWindowPolicy {
  const contextWindow = Math.max(1, Math.floor(contextWindowTokens));
  const keepRecentTokens = Math.max(
    1,
    Math.min(DEFAULT_COMPACTION_SETTINGS.keepRecentTokens, Math.floor(contextWindow / 2)),
  );
  const reserveTokens = Math.max(1, Math.min(keepRecentTokens, Math.max(1, contextWindow - keepRecentTokens)));
  return {
    contextWindowTokens: contextWindow,
    inputCapacityTokens: Math.max(0, contextWindow - reserveTokens),
    reserveTokens,
    keepRecentTokens,
  };
}

export function resolveAgentPiCompactionSettings(
  config: ResolvedAgentPiCompactionConfig,
  model: AgentPiProviderProjection["model"],
): AgentPiResolvedCompactionSettings {
  // The compaction reserve belongs to Pi's context policy, not to a provider's
  // output cap. Provider max-output metadata may be absent, overly generous,
  // or unrelated to the amount of history Pi can retain.
  const window = resolveAgentPiCompactionWindow(model.contextWindow);
  return {
    enabled: config.Enabled,
    contextWindowTokens: window.contextWindowTokens,
    inputCapacityTokens: window.inputCapacityTokens,
    reserveTokens: window.reserveTokens,
    keepRecentTokens: Math.min(window.keepRecentTokens, Math.max(1, window.inputCapacityTokens)),
  };
}

/**
 * Exposes the same reserve used by Pi's formal compaction boundary to other
 * runtime budgets. Callers must not derive a second reserve from provider
 * output metadata.
 */
export function resolveAgentPiTokenBudgetHeadroom(
  config: ResolvedAgentPiCompactionConfig,
  model: AgentPiProviderProjection["model"],
): number {
  return resolveAgentPiCompactionSettings(config, model).reserveTokens;
}
