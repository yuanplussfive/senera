import type {
  ActionPlanInput,
  TaskFrame,
  TaskTargetRef,
} from "../BamlClient/baml_client/types.js";
import { TaskEvidenceScope } from "../BamlClient/baml_client/types.js";
import {
  AgentEvidenceCapabilityIndex,
  type AgentEvidenceCandidateProfile,
} from "../Evidence/AgentEvidenceCapabilityIndex.js";
import { completionRequirementBlockers } from "./AgentCompletionProgress.js";
import type {
  AgentCompletionEvidenceVerification,
  AgentCompletionEvidenceVerificationRequirement,
  AgentCompletionProgressAssessment,
  AgentCompletionRequirement,
  AgentCompletionRequirementState,
  AgentCompletionRequirementStatus,
} from "./AgentCompletionGateTypes.js";
import { uniqueStrings } from "./AgentCompletionUtils.js";

export function collectCompletionRequirements(taskFrame: TaskFrame): AgentCompletionRequirement[] {
  return dedupeRequirements([
    ...taskFrame.requiredEvidence.map((need) => ({
      id: need.id,
      need: need.need,
      minimum: need.minimum,
      reason: need.reason,
      targets: taskFrame.targetRefs,
      verifiable: need.scope === TaskEvidenceScope.CurrentRun,
    })),
    ...taskFrame.requiredEffects.map((effect) => ({
      id: effect.id,
      need: effect.target
        ? `${effect.effect}: ${effect.target}`
        : effect.effect,
      minimum: 1,
      reason: uniqueStrings([effect.reason, effect.proof]).join("\n"),
      targets: taskFrame.targetRefs,
      verifiable: true,
    })),
  ]);
}

export function evaluateCompletionRequirement(options: {
  requirement: AgentCompletionRequirement;
  evidence: readonly AgentEvidenceCandidateProfile[];
  progress: AgentCompletionProgressAssessment;
  capabilityIndex: AgentEvidenceCapabilityIndex;
  verification?: AgentCompletionEvidenceVerification;
}): AgentCompletionRequirementState {
  if (!options.requirement.verifiable) {
    return {
      id: options.requirement.id,
      need: options.requirement.need,
      status: "satisfied",
      reason: options.requirement.reason,
      observed: options.requirement.minimum,
      required: options.requirement.minimum,
      evidence: [],
      missingFacts: [],
      unsupportedClaims: [],
      blockers: [],
    };
  }

  const verification = findVerificationRequirement(options.verification, options.requirement);
  const citation = verification
    ? collectVerifiedEvidence(options.evidence, verification)
    : {
        evidence: [],
        invalidEvidenceUris: [],
        invalidArtifactUris: [],
      };
  const matches = citation.evidence.flatMap((candidate) =>
    options.capabilityIndex.describeEvidence(candidate, options.requirement));
  const observed = new Set(citation.evidence.map((entry) => entry.evidenceUri)).size;
  const blockers = uniqueStrings([
    ...(verification?.status === "blocked" ? [verification.reason] : []),
    ...citation.invalidEvidenceUris.map((uri) => `verifier cited unknown evidence URI: ${uri}`),
    ...citation.invalidArtifactUris.map((uri) => `verifier cited unknown artifact uri: ${uri}`),
    ...completionRequirementBlockers(options.progress),
  ]);
  const verifierStatus = normalizeVerifiedStatus({
    required: options.requirement.minimum,
    observed,
    status: verification?.status,
    progress: options.progress,
  });

  return {
    id: options.requirement.id,
    need: options.requirement.need,
    status: verifierStatus,
    reason: verification?.reason || options.requirement.reason,
    observed,
    required: options.requirement.minimum,
    evidence: matches,
    missingFacts: verification?.missingFacts ?? [],
    unsupportedClaims: verification?.unsupportedClaims ?? [],
    blockers,
  };
}

export function projectVerifiableTaskFrame(taskFrame: TaskFrame): TaskFrame {
  return {
    ...taskFrame,
    requiredEvidence: taskFrame.requiredEvidence.filter((need) =>
      need.scope === TaskEvidenceScope.CurrentRun),
  };
}

export function collectCompletionEvidence(input: ActionPlanInput): AgentEvidenceCandidateProfile[] {
  return input.evidenceState.map((entry) => ({
    evidenceUri: entry.evidenceUri,
    kind: entry.kind,
    toolName: entry.toolName,
    artifactUri: entry.artifactUri,
    locator: entry.locator,
    display: entry.display,
    label: entry.label,
    source: entry.source,
    confidence: entry.confidence,
    facts: entry.facts,
    artifactRefs: entry.artifactRefs,
  }));
}

function normalizeVerifiedStatus(options: {
  required: number;
  observed: number;
  status?: AgentCompletionRequirementStatus;
  progress: AgentCompletionProgressAssessment;
}): AgentCompletionRequirementStatus {
  if (options.status === "satisfied" && options.observed >= options.required) {
    return "satisfied";
  }
  if (options.status === "partial" || options.observed > 0) {
    return "partial";
  }
  if (options.status === "blocked") {
    return "blocked";
  }
  if (options.progress.stalled) {
    return "stalled";
  }
  return options.status === "stalled" ? "stalled" : "missing";
}

function dedupeRequirements(
  requirements: readonly AgentCompletionRequirement[],
): AgentCompletionRequirement[] {
  const byId = new Map<string, AgentCompletionRequirement>();
  for (const requirement of requirements) {
    const current = byId.get(requirement.id);
    byId.set(requirement.id, current
      ? {
          id: requirement.id,
          need: current.need,
          minimum: Math.max(current.minimum, requirement.minimum),
          reason: uniqueStrings([current.reason, requirement.reason]).join("\n"),
          targets: dedupeTargets([...current.targets, ...requirement.targets]),
          verifiable: current.verifiable || requirement.verifiable,
        }
      : {
          ...requirement,
          targets: dedupeTargets(requirement.targets),
        });
  }
  return [...byId.values()];
}

function findVerificationRequirement(
  verification: AgentCompletionEvidenceVerification | undefined,
  requirement: AgentCompletionRequirement,
): AgentCompletionEvidenceVerificationRequirement | undefined {
  return verification?.requirements.find((entry) => entry.requirementId === requirement.id);
}

function collectVerifiedEvidence(
  evidence: readonly AgentEvidenceCandidateProfile[],
  verification: AgentCompletionEvidenceVerificationRequirement,
): {
  evidence: AgentEvidenceCandidateProfile[];
  invalidEvidenceUris: string[];
  invalidArtifactUris: string[];
} {
  const byEvidenceUri = new Map(evidence.map((entry) => [entry.evidenceUri, entry]));
  const byArtifactUri = new Set(evidence.map((entry) => entry.artifactUri));
  const invalidEvidenceUris: string[] = [];
  const invalidArtifactUris = uniqueStrings(verification.artifactUris)
    .filter((uri) => !byArtifactUri.has(uri));
  const citedEvidence = uniqueStrings(verification.evidenceUris).flatMap((evidenceUri) => {
    const entry = byEvidenceUri.get(evidenceUri);
    if (!entry) {
      invalidEvidenceUris.push(evidenceUri);
      return [];
    }
    return [entry];
  });

  return {
    evidence: citedEvidence,
    invalidEvidenceUris,
    invalidArtifactUris,
  };
}

function dedupeTargets(targets: readonly TaskTargetRef[]): TaskTargetRef[] {
  const byKey = new Map<string, TaskTargetRef>();
  for (const target of targets) {
    byKey.set(JSON.stringify([target.kind, target.value, target.status]), target);
  }
  return [...byKey.values()];
}
