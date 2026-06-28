import type { ActionPlanInput, TaskFrame, TaskTargetRef } from "../BamlClient/baml_client/types.js";
import type { AgentActionDecision } from "../ActionPlanner/AgentActionPlannerTypes.js";
import type {
  AgentEvidenceCapabilityIndex,
  AgentEvidenceCapabilityMatch,
} from "../AgentEvidenceCapabilityIndex.js";

export interface AgentCompletionEvidenceVerifier {
  verify(options: {
    input: ActionPlanInput;
    taskFrame: TaskFrame;
    signal?: AbortSignal;
  }): Promise<AgentCompletionEvidenceVerification>;
}

export interface AgentCompletionEvidenceVerification {
  ready: boolean;
  requirements: AgentCompletionEvidenceVerificationRequirement[];
  summary: string;
}

export interface AgentCompletionEvidenceVerificationRequirement {
  requirementId: string;
  need: string;
  status: AgentCompletionRequirementStatus;
  evidenceUris: string[];
  artifactUris: string[];
  reason: string;
  missingFacts: string[];
  unsupportedClaims: string[];
}

export interface AgentCompletionGateDecision {
  ready: boolean;
  action: AgentActionDecision;
  missingNeeds: AgentCompletionMissingNeed[];
  satisfiedNeeds: AgentCompletionSatisfiedNeed[];
  requirementStates: AgentCompletionRequirementState[];
  progress: AgentCompletionProgressAssessment;
  recommendedTools: string[];
  searchQueries: string[];
  verification?: AgentCompletionEvidenceVerification;
}

export type AgentCompletionRequirementStatus =
  | "satisfied"
  | "partial"
  | "missing"
  | "stalled"
  | "blocked";

export interface AgentCompletionMissingNeed {
  id: string;
  need: string;
  reason: string;
  status: Exclude<AgentCompletionRequirementStatus, "satisfied">;
  observed: number;
  required: number;
  missingFacts: string[];
  unsupportedClaims: string[];
  blockers: string[];
}

export interface AgentCompletionSatisfiedNeed {
  id: string;
  need: string;
  evidence: AgentCompletionEvidenceMatch[];
}

export interface AgentCompletionRequirementState {
  id: string;
  need: string;
  status: AgentCompletionRequirementStatus;
  reason: string;
  observed: number;
  required: number;
  evidence: AgentCompletionEvidenceMatch[];
  missingFacts: string[];
  unsupportedClaims: string[];
  blockers: string[];
}

export interface AgentCompletionProgressAssessment {
  stalled: boolean;
  repeatedCalls: ActionPlanInput["runState"]["warnings"];
  nonEvidenceCalls: AgentCompletionProgressCall[];
  failedCalls: AgentCompletionProgressCall[];
}

export interface AgentCompletionProgressCall {
  step: number;
  toolName: string;
  status: string;
  resultKind: string;
  artifactUri: string;
  evidenceUris: string[];
  argumentsPreview: string;
  error: string;
}

export interface AgentCompletionRequirement {
  id: string;
  need: string;
  minimum: number;
  reason: string;
  targets: TaskTargetRef[];
  verifiable: boolean;
}

export interface AgentCompletionCandidateToolRecommendation {
  toolName: string;
  loaded: boolean;
  needs: ReturnType<AgentEvidenceCapabilityIndex["projectCapabilityNeed"]>[];
}

export type AgentCompletionEvidenceMatch = AgentEvidenceCapabilityMatch;
