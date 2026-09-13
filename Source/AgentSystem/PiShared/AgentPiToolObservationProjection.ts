import type { AgentPiToolObservation } from "./AgentPiToolObservationProtocol.js";

/**
 * Returns the provider-sized view of an Artifact-backed observation. The
 * complete payload remains in the durable Artifact; this projection keeps the
 * continuity fields that let the model retrieve it later.
 */
export function projectAgentPiToolObservationForContext(observation: AgentPiToolObservation): AgentPiToolObservation {
  if (observation.observation_view.complete || !observation.observation_view.artifact_uri) return observation;

  const detail = { ...observation.detail };
  delete detail.result;
  delete detail.arguments;
  delete detail.process;
  return { ...observation, detail };
}
