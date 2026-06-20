import type {
  ActionPlanInput,
  TaskFrame,
  TaskTargetRef,
} from "./BamlClient/baml_client/types.js";
import type { AgentActionDecision } from "./AgentActionPlannerTypes.js";
import {
  AgentEvidenceCapabilityIndex,
  uniqueCapabilityNeeds,
  type AgentEvidenceCandidateProfile,
  type AgentEvidenceCapabilityMatch,
} from "./AgentEvidenceCapabilityIndex.js";

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
  evidenceRefs: string[];
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
  evidenceRefs: string[];
  argumentsPreview: string;
  error: string;
}

export type AgentCompletionEvidenceMatch = AgentEvidenceCapabilityMatch;

interface CompletionRequirement {
  id: string;
  need: string;
  minimum: number;
  reason: string;
  targets: TaskTargetRef[];
}

interface CandidateToolRecommendation {
  toolName: string;
  loaded: boolean;
  needs: ReturnType<AgentEvidenceCapabilityIndex["projectCapabilityNeed"]>[];
}

export class AgentCompletionGate {
  constructor(
    private readonly verifier?: AgentCompletionEvidenceVerifier,
  ) {}

  async decide(options: {
    input: ActionPlanInput;
    taskFrame: TaskFrame;
    signal?: AbortSignal;
  }): Promise<AgentCompletionGateDecision> {
    const progress = assessProgress(options.input);
    const userInputNeed = options.taskFrame.userInputNeeds[0];
    if (userInputNeed) {
      return {
        ready: false,
        action: {
          action: "ask_user",
          askUser: {
            question: userInputNeed.question,
            reason: userInputNeed.reason,
          },
        },
        missingNeeds: [],
        satisfiedNeeds: [],
        requirementStates: [],
        progress,
        recommendedTools: [],
        searchQueries: [],
      };
    }

    const requirements = collectRequirements(options.taskFrame);
    if (requirements.length === 0) {
      return {
        ready: true,
        action: { action: "answer" },
        missingNeeds: [],
        satisfiedNeeds: [],
        requirementStates: [],
        progress,
        recommendedTools: [],
        searchQueries: [],
      };
    }

    const evidence = collectEvidence(options.input);
    const capabilityIndex = new AgentEvidenceCapabilityIndex(options.input.toolCatalog);
    const verification = this.verifier && evidence.length > 0
      ? await this.verifier.verify({
          input: options.input,
          taskFrame: options.taskFrame,
          signal: options.signal,
        })
      : undefined;
    const states = requirements.map((requirement) =>
      evaluateRequirement({
        requirement,
        evidence,
        progress,
        capabilityIndex,
        verification,
      }));

    const satisfied = states
      .filter((state) => state.status === "satisfied")
      .map((state) => ({
        need: state.need,
        id: state.id,
        evidence: state.evidence,
      }));
    const missing = states
      .filter((state): state is AgentCompletionRequirementState & {
        status: Exclude<AgentCompletionRequirementStatus, "satisfied">;
      } => state.status !== "satisfied")
      .map((state) => ({
        need: state.need,
        id: state.id,
        reason: state.reason,
        status: state.status,
        observed: state.observed,
        required: state.required,
        missingFacts: state.missingFacts,
        unsupportedClaims: state.unsupportedClaims,
        blockers: state.blockers,
      }));

    if (missing.length === 0) {
      return {
        ready: true,
        action: { action: "answer" },
        missingNeeds: [],
        satisfiedNeeds: satisfied,
        requirementStates: states,
        progress,
        recommendedTools: [],
        searchQueries: [],
        verification,
      };
    }

    const recommendations = projectCandidateToolRecommendations(
      options.input,
      options.taskFrame,
      capabilityIndex,
    );
    const recommendedTools = uniqueStrings(recommendations.map((entry) => entry.toolName));
    const loadedRecommendedTools = recommendations
      .filter((entry) => entry.loaded)
      .map((entry) => entry.toolName);
    const searchQueries = options.taskFrame.discoveryQueries;
    const capabilityNeeds = uniqueCapabilityNeeds(recommendations.flatMap((entry) => entry.needs));

    return loadedRecommendedTools.length > 0
      ? {
          ready: false,
          action: {
            action: "use_tools",
            useTools: {
              preferredTools: loadedRecommendedTools,
              instruction: buildToolInstruction(options.taskFrame, missing, progress),
              needs: capabilityNeeds,
            },
          },
          missingNeeds: missing,
          satisfiedNeeds: satisfied,
          requirementStates: states,
          progress,
          recommendedTools,
          searchQueries: [],
          verification,
        }
      : {
          ready: false,
          action: {
            action: "discover_tools",
            discoverTools: {
              queries: searchQueries,
              needs: capabilityNeeds,
            },
          },
          missingNeeds: missing,
          satisfiedNeeds: satisfied,
          requirementStates: states,
          progress,
          recommendedTools,
          searchQueries,
          verification,
        };
  }
}

function collectRequirements(taskFrame: TaskFrame): CompletionRequirement[] {
  return dedupeRequirements([
    ...taskFrame.requiredEvidence.map((need) => ({
      id: need.id,
      need: need.need,
      minimum: need.minimum,
      reason: need.reason,
      targets: taskFrame.targetRefs,
    })),
    ...taskFrame.requiredEffects.map((effect) => ({
      id: effect.id,
      need: effect.target
        ? `${effect.effect}: ${effect.target}`
        : effect.effect,
      minimum: 1,
      reason: uniqueStrings([effect.reason, effect.proof]).join("\n"),
      targets: taskFrame.targetRefs,
    })),
  ]);
}

function evaluateRequirement(options: {
  requirement: CompletionRequirement;
  evidence: readonly AgentEvidenceCandidateProfile[];
  progress: AgentCompletionProgressAssessment;
  capabilityIndex: AgentEvidenceCapabilityIndex;
  verification?: AgentCompletionEvidenceVerification;
}): AgentCompletionRequirementState {
  const verification = findVerificationRequirement(options.verification, options.requirement);
  const citation = verification
    ? collectVerifiedEvidence(options.evidence, verification)
    : {
        evidence: [],
        invalidEvidenceRefs: [],
        invalidArtifactUris: [],
      };
  const matches = citation.evidence.flatMap((candidate) =>
    options.capabilityIndex.describeEvidence(candidate, options.requirement));
  const observed = new Set(citation.evidence.map((entry) => entry.ref)).size;
  const blockers = uniqueStrings([
    ...(verification?.status === "blocked" ? [verification.reason] : []),
    ...citation.invalidEvidenceRefs.map((ref) => `verifier cited unknown evidence ref: ${ref}`),
    ...citation.invalidArtifactUris.map((uri) => `verifier cited unknown artifact uri: ${uri}`),
    ...requirementBlockers(options.progress),
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

function dedupeRequirements(requirements: readonly CompletionRequirement[]): CompletionRequirement[] {
  const byId = new Map<string, CompletionRequirement>();
  for (const requirement of requirements) {
    const current = byId.get(requirement.id);
    byId.set(requirement.id, current
      ? {
          id: requirement.id,
          need: current.need,
          minimum: Math.max(current.minimum, requirement.minimum),
          reason: uniqueStrings([current.reason, requirement.reason]).join("\n"),
          targets: dedupeTargets([...current.targets, ...requirement.targets]),
        }
      : {
          ...requirement,
          targets: dedupeTargets(requirement.targets),
        });
  }
  return [...byId.values()];
}

function collectEvidence(input: ActionPlanInput): AgentEvidenceCandidateProfile[] {
  return input.evidenceState.map((entry) => ({
    ref: entry.evidenceRef,
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

function projectCandidateToolRecommendations(
  input: ActionPlanInput,
  taskFrame: TaskFrame,
  capabilityIndex: AgentEvidenceCapabilityIndex,
): CandidateToolRecommendation[] {
  const byName = new Map(input.toolCatalog.map((tool) => [tool.name, tool]));
  const byTool = new Map<string, CandidateToolRecommendation>();
  for (const candidate of taskFrame.candidateTools) {
    const tool = byName.get(candidate.name);
    if (!tool) {
      continue;
    }

    const capabilityNeeds = uniqueCapabilityNeeds(
      tool.capabilities.map((capability) => capabilityIndex.projectCapabilityNeed(capability.facets)),
    );
    const current = byTool.get(tool.name);
    byTool.set(tool.name, current
      ? {
          ...current,
          loaded: current.loaded || tool.loaded,
          needs: uniqueCapabilityNeeds([...current.needs, ...capabilityNeeds]),
        }
      : {
          toolName: tool.name,
          loaded: tool.loaded,
          needs: capabilityNeeds,
        });
  }
  return [...byTool.values()];
}

function buildToolInstruction(
  taskFrame: TaskFrame,
  missing: readonly AgentCompletionMissingNeed[],
  progress: AgentCompletionProgressAssessment,
): string {
  return [
    taskFrame.nextStepPurpose || taskFrame.answerGoal,
    ...missing.map((need) =>
      `Need ${need.observed}/${need.required} verified evidence for ${need.need}: ${need.reason}`),
    ...missing.flatMap((need) => need.missingFacts.map((fact) => `Missing fact: ${fact}`)),
    ...missing.flatMap((need) => need.unsupportedClaims.map((claim) => `Unsupported claim: ${claim}`)),
    ...taskFrame.completionCriteria.map((criterion) => `Completion check: ${criterion}`),
    ...progress.nonEvidenceCalls.map((call) =>
      `Previous ${call.toolName} call produced no verified evidence: status=${call.status}; kind=${call.resultKind}; args=${call.argumentsPreview}`),
    ...progress.failedCalls.map((call) =>
      `Previous ${call.toolName} call failed: ${call.error || call.status}`),
  ].filter(Boolean).join("\n");
}

function assessProgress(input: ActionPlanInput): AgentCompletionProgressAssessment {
  const calls = input.runState.calls.map((call) => ({
    step: call.step,
    toolName: call.toolName,
    status: call.status,
    resultKind: call.resultKind,
    artifactUri: call.artifactUri,
    evidenceRefs: call.evidenceRefs,
    argumentsPreview: call.argumentsPreview,
    error: call.error,
  }));
  return {
    stalled: input.runState.progress.stalled,
    repeatedCalls: input.runState.warnings,
    nonEvidenceCalls: calls.filter((call) => call.evidenceRefs.length === 0),
    failedCalls: calls.filter((call) => call.status === "Failure"),
  };
}

function requirementBlockers(progress: AgentCompletionProgressAssessment): string[] {
  return uniqueStrings([
    ...(progress.stalled ? ["no new verified evidence after recent tool calls"] : []),
    ...progress.repeatedCalls.map((warning) =>
      `${warning.toolName} repeated ${warning.count} times`),
    ...progress.failedCalls.map((call) =>
      `${call.toolName} failed${call.error ? `: ${call.error}` : ""}`),
    ...progress.nonEvidenceCalls.map((call) =>
      `${call.toolName} produced no verified evidence${call.resultKind ? ` (${call.resultKind})` : ""}`),
  ]);
}

function findVerificationRequirement(
  verification: AgentCompletionEvidenceVerification | undefined,
  requirement: CompletionRequirement,
): AgentCompletionEvidenceVerificationRequirement | undefined {
  return verification?.requirements.find((entry) => entry.requirementId === requirement.id);
}

function collectVerifiedEvidence(
  evidence: readonly AgentEvidenceCandidateProfile[],
  verification: AgentCompletionEvidenceVerificationRequirement,
): {
  evidence: AgentEvidenceCandidateProfile[];
  invalidEvidenceRefs: string[];
  invalidArtifactUris: string[];
} {
  const byRef = new Map(evidence.map((entry) => [entry.ref, entry]));
  const byArtifactUri = new Set(evidence.map((entry) => entry.artifactUri));
  const invalidEvidenceRefs: string[] = [];
  const invalidArtifactUris = uniqueStrings(verification.artifactUris)
    .filter((uri) => !byArtifactUri.has(uri));
  const citedEvidence = uniqueStrings(verification.evidenceRefs).flatMap((ref) => {
    const entry = byRef.get(ref);
    if (!entry) {
      invalidEvidenceRefs.push(ref);
      return [];
    }
    return [entry];
  });

  return {
    evidence: citedEvidence,
    invalidEvidenceRefs,
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

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
