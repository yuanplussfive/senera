import { DEFAULT_COMPACTION_SETTINGS } from "@earendil-works/pi-coding-agent";
import type { ResolvedAgentPiCompactionConfig } from "../Types/AgentConfigTypes.js";
import type { AgentPiProviderProjection } from "./AgentPiTypes.js";

export interface AgentPiResolvedCompactionSettings {
  readonly enabled: boolean;
  readonly reserveTokens: number;
  readonly keepRecentTokens: number;
}

/**
 * Computes the proactive pressure band used by the mid-run coordinator.
 *
 * The recent-history window is kept as a bounded Pi-compatible window. The
 * pressure headroom is an independent early warning for the current tool
 * batch; it must not turn into a request-sized keepRecentTokens value on
 * large-context models.
 */
export function resolveAgentPiCompactionHeadroom(
  inputCapacityTokens: number,
  outputReserveTokens: number,
  desiredRecentTokens: number,
): number {
  const capacity = Math.max(0, Math.floor(inputCapacityTokens));
  const reserve = Math.max(0, Math.floor(outputReserveTokens));
  const recent = Math.max(0, Math.floor(desiredRecentTokens));
  const maximumProactiveHeadroom = Math.floor(capacity / 2);
  return Math.min(capacity, reserve, recent, maximumProactiveHeadroom);
}

export function resolveAgentPiCompactionSettings(
  config: ResolvedAgentPiCompactionConfig,
  model: AgentPiProviderProjection["model"],
): AgentPiResolvedCompactionSettings {
  const reserveTokens = Math.min(model.maxTokens, model.contextWindow);
  const inputCapacityTokens = Math.max(0, model.contextWindow - reserveTokens);
  const proactiveHeadroomTokens = resolveAgentPiCompactionHeadroom(
    inputCapacityTokens,
    reserveTokens,
    DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
  );
  return {
    enabled: config.Enabled,
    reserveTokens,
    keepRecentTokens: Math.min(
      DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
      Math.max(1, inputCapacityTokens - proactiveHeadroomTokens),
    ),
  };
}
