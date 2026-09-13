import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import { projectAgentPiToolObservationContextMessage } from "./AgentPiToolObservationContextProjection.js";
import { resolveAgentPiCompactionHeadroom } from "./AgentPiCompactionSettings.js";

export interface AgentPiContextPressureProjectionOptions {
  readonly model: string;
  readonly contextWindowTokens: number;
  readonly outputReserveTokens: number;
  readonly keepRecentTokens: number;
  /** Last complete provider input measurement, including system/tools. */
  readonly observedProviderTokens?: number;
}

export interface AgentPiContextPressureProjectionResult {
  readonly messages: AgentMessage[];
  readonly projectedMessages: number;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly reclaimedTokens: number;
  readonly triggerTokens: number;
  readonly observedProviderTokens: number;
}

/**
 * Keeps the active turn intact and shrinks only old Artifact-backed tool
 * results when the provider input reaches the compaction pressure band.
 */
export function projectAgentPiContextForPressure(
  messages: readonly AgentMessage[],
  options: AgentPiContextPressureProjectionOptions,
): AgentPiContextPressureProjectionResult {
  const tokenProjector = new AgentTokenProjector(options.model);
  const messageTokensBefore = tokenProjector.countJson(messages);
  const observedProviderTokens = normalizeNonNegativeInteger(options.observedProviderTokens);
  const stablePrefixTokens = Math.max(0, observedProviderTokens - messageTokensBefore);
  const tokensBefore = Math.max(messageTokensBefore, observedProviderTokens);
  const inputCapacityTokens = Math.max(
    0,
    Math.floor(options.contextWindowTokens) - Math.max(0, Math.floor(options.outputReserveTokens)),
  );
  const proactiveHeadroomTokens = resolveAgentPiCompactionHeadroom(
    inputCapacityTokens,
    options.outputReserveTokens,
    options.keepRecentTokens,
  );
  const triggerTokens = Math.max(0, inputCapacityTokens - proactiveHeadroomTokens);
  const boundary = findCurrentUserBoundary(messages);
  if (Math.max(tokensBefore, observedProviderTokens) <= triggerTokens || boundary < 0) {
    return {
      messages: [...messages],
      projectedMessages: 0,
      tokensBefore,
      tokensAfter: tokensBefore,
      reclaimedTokens: 0,
      triggerTokens,
      observedProviderTokens,
    };
  }

  const projected = [...messages];
  let projectedMessages = 0;
  let projectedMessageTokens = messageTokensBefore;
  let tokensAfter = projectedMessageTokens + stablePrefixTokens;
  // Count each candidate once and apply only its delta. Recounting the whole
  // message array after every projection turns a long tool transcript into an
  // avoidable O(n^2) tokenization pass.
  for (let index = 0; index < boundary && tokensAfter > triggerTokens; index += 1) {
    const candidate = projectAgentPiToolObservationContextMessage(projected[index]);
    if (!candidate) continue;
    const previousMessageTokens = tokenProjector.countJson(projected[index]);
    const candidateMessageTokens = tokenProjector.countJson(candidate);
    if (candidateMessageTokens >= previousMessageTokens) continue;
    projected[index] = candidate;
    projectedMessages += 1;
    projectedMessageTokens += candidateMessageTokens - previousMessageTokens;
    tokensAfter = projectedMessageTokens + stablePrefixTokens;
  }

  return {
    messages: projected,
    projectedMessages,
    tokensBefore,
    tokensAfter,
    reclaimedTokens: Math.max(0, tokensBefore - tokensAfter),
    triggerTokens,
    observedProviderTokens,
  };
}

function findCurrentUserBoundary(messages: readonly AgentMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function normalizeNonNegativeInteger(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, Math.floor(value));
}
