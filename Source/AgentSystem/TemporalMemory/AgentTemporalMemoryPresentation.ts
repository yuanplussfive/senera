import {
  projectLegacyIdentityText,
  renderAgentTextParts,
  type AgentIdentityDisplayValues,
  type AgentTextParts,
} from "../Text/AgentTextParts.js";
import type { AgentTemporalMemoryDigest, AgentTemporalMemoryOverview } from "./AgentTemporalMemoryTypes.js";

/** Projects stored digest prose into the current participant vocabulary at read time. */
export function renderAgentTemporalMemoryDigest(
  digest: AgentTemporalMemoryDigest,
  values: AgentIdentityDisplayValues,
): AgentTemporalMemoryDigest {
  const summaryParts = resolveParts(digest.summaryParts, digest.summary);
  const topicParts = resolvePartArray(digest.topicParts, digest.topics);
  const openLoopParts = resolvePartArray(digest.openLoopParts, digest.openLoops);
  return {
    ...digest,
    summary: renderAgentTextParts(summaryParts, values),
    topics: topicParts.map((parts) => renderAgentTextParts(parts, values)),
    openLoops: openLoopParts.map((parts) => renderAgentTextParts(parts, values)),
    summaryParts,
    topicParts,
    openLoopParts,
  };
}

function resolveParts(parts: AgentTextParts | undefined, legacy: string): AgentTextParts {
  return parts?.length ? parts : projectLegacyIdentityText(legacy);
}

function resolvePartArray(parts: readonly AgentTextParts[] | undefined, legacy: readonly string[]): AgentTextParts[] {
  return parts?.length ? [...parts] : legacy.map((value) => projectLegacyIdentityText(value));
}

export function renderAgentTemporalMemoryOverview(
  overview: AgentTemporalMemoryOverview,
  values: AgentIdentityDisplayValues,
): AgentTemporalMemoryOverview {
  return {
    ...overview,
    latestSealed: overview.latestSealed.map((digest) => renderAgentTemporalMemoryDigest(digest, values)),
  };
}
