import {
  EvidenceVerificationStatus,
  type EvidenceVerification,
} from "../BamlClient/baml_client/types.js";
import type {
  AgentCompletionEvidenceVerification,
  AgentCompletionRequirementStatus,
} from "../Loop/AgentCompletionGate.js";

const EvidenceVerificationStatusProjection = {
  [EvidenceVerificationStatus.Satisfied]: "satisfied",
  [EvidenceVerificationStatus.Partial]: "partial",
  [EvidenceVerificationStatus.Blocked]: "blocked",
  [EvidenceVerificationStatus.Missing]: "missing",
} as const satisfies Record<EvidenceVerificationStatus, AgentCompletionRequirementStatus>;

export function projectEvidenceVerification(
  verification: EvidenceVerification,
): AgentCompletionEvidenceVerification {
  return {
    ready: verification.ready,
    summary: verification.summary,
    requirements: verification.requirements.map((requirement) => ({
      requirementId: requirement.requirementId,
      need: requirement.need,
      status: EvidenceVerificationStatusProjection[requirement.status],
      evidenceUris: requirement.evidenceUris,
      artifactUris: requirement.artifactUris,
      reason: requirement.reason,
      missingFacts: requirement.missingFacts,
      unsupportedClaims: requirement.unsupportedClaims,
    })),
  };
}
