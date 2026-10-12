import { isEmptyFeedback, readAgentToolEvidenceCandidates } from "../ToolRuntime/AgentToolFeedbackAdapter.js";
import {
  attachAgentToolEvidenceAssets,
  createAgentToolEvidenceCandidates,
} from "../ToolRuntime/AgentToolFeedbackAdapter.js";
import type {
  AgentToolArtifactAssetReference,
  AgentToolEvidenceCandidate,
  ExecutedToolCallResult,
} from "../Types/ToolRuntimeTypes.js";
import { redactArtifactSecrets } from "./AgentArtifactRedaction.js";

/**
 * Builds the model-facing evidence candidates from one durable result. Both
 * fresh publication and immutable-retry recovery use this exact policy so an
 * Artifact cannot gain or lose evidence merely because it was retried.
 */
export function projectAgentToolArtifactEvidenceCandidates(input: {
  readonly result: ExecutedToolCallResult;
  readonly redactedResult: unknown;
  readonly policy: ExecutedToolCallResult["artifactPolicy"];
  readonly assets: readonly AgentToolArtifactAssetReference[] | undefined;
}): AgentToolEvidenceCandidate[] {
  const declared = readAgentToolEvidenceCandidates(
    redactArtifactSecrets(input.result.artifactPayload?.evidence ?? [], input.policy),
  );
  const automatic = isEmptyFeedback(input.redactedResult)
    ? []
    : createAgentToolEvidenceCandidates(input.redactedResult, {
        source: `${input.result.name} result`,
      });
  return attachAgentToolEvidenceAssets([...declared, ...automatic], input.assets);
}
