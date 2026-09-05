import { renderAgentIdentityTemplate, type AgentIdentityTemplateValues } from "../Prompt/AgentIdentityTemplate.js";
import type { AgentTemporalMemoryDigest, AgentTemporalMemoryOverview } from "./AgentTemporalMemoryTypes.js";

/** Projects stored digest prose into the current participant vocabulary at read time. */
export function renderAgentTemporalMemoryDigest(
  digest: AgentTemporalMemoryDigest,
  values: AgentIdentityTemplateValues,
): AgentTemporalMemoryDigest {
  return {
    ...digest,
    summary: renderAgentIdentityTemplate(digest.summary, values),
    topics: digest.topics.map((topic) => renderAgentIdentityTemplate(topic, values)),
    openLoops: digest.openLoops.map((loop) => renderAgentIdentityTemplate(loop, values)),
  };
}

export function renderAgentTemporalMemoryOverview(
  overview: AgentTemporalMemoryOverview,
  values: AgentIdentityTemplateValues,
): AgentTemporalMemoryOverview {
  return {
    ...overview,
    latestSealed: overview.latestSealed.map((digest) => renderAgentTemporalMemoryDigest(digest, values)),
  };
}
