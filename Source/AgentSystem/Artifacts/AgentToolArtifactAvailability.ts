import { projectAgentToolResultPresentation } from "../ToolRuntime/AgentToolResultPresentation.js";
import {
  AgentToolArtifactAvailabilityStatuses,
  AgentToolArtifactUnavailableReasons,
  type ExecutedToolCallResult,
} from "../Types/ToolRuntimeTypes.js";

/**
 * Drops material that was intended only for Artifact storage while retaining
 * the tool's actual result and outcome for the active turn.
 */
export function markAgentToolArtifactUnavailable(result: ExecutedToolCallResult): ExecutedToolCallResult {
  const { artifact: _artifact, artifactPayload: _artifactPayload, ...withoutArtifactPayload } = result;
  const unavailable = {
    ...withoutArtifactPayload,
    artifactAvailability: {
      status: AgentToolArtifactAvailabilityStatuses.Unavailable,
      reason: AgentToolArtifactUnavailableReasons.RecordingFailed,
    },
  } satisfies ExecutedToolCallResult;
  return {
    ...unavailable,
    presentation: projectAgentToolResultPresentation(unavailable),
  };
}
