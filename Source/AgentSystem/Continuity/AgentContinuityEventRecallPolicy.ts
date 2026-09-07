import type { AgentContinuityObservation } from "./AgentContinuityDomain.js";

/**
 * Automatic text recall admits source-backed history from completed episodes.
 * The live session is excluded by AgentContinuityEpisodeRecall, while runtime
 * signals stay in the evaluated state channel instead of becoming text events.
 */
export function isAgentContinuityEventRecallable(observation: AgentContinuityObservation): boolean {
  if (
    observation.kind !== "conversation.user_message" &&
    observation.kind !== "conversation.assistant_final" &&
    observation.kind !== "tool.result"
  )
    return false;
  if (observation.sourceRefs.length === 0) return false;
  if (
    (observation.kind === "conversation.user_message" || observation.kind === "conversation.assistant_final") &&
    observation.payload.kind !== "physical_source"
  )
    return false;
  return Boolean(observation.summary.trim() || observation.searchText?.trim());
}
