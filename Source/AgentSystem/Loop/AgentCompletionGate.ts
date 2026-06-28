import type {
  ActionPlanInput,
  TaskFrame,
} from "../BamlClient/baml_client/types.js";
import {
  AgentEvidenceCapabilityIndex,
  uniqueCapabilityNeeds,
} from "../AgentEvidenceCapabilityIndex.js";
import {
  assessCompletionProgress,
} from "./AgentCompletionProgress.js";
import {
  collectCompletionEvidence,
  collectCompletionRequirements,
  evaluateCompletionRequirement,
  projectVerifiableTaskFrame,
} from "./AgentCompletionEvidence.js";
import {
  buildToolInstruction,
  projectCandidateToolRecommendations,
} from "./AgentCompletionToolRecommendation.js";
import { uniqueStrings } from "./AgentCompletionUtils.js";
import type {
  AgentCompletionEvidenceVerifier,
  AgentCompletionGateDecision,
  AgentCompletionMissingNeed,
  AgentCompletionRequirementState,
  AgentCompletionRequirementStatus,
} from "./AgentCompletionGateTypes.js";

export type {
  AgentCompletionCandidateToolRecommendation,
  AgentCompletionEvidenceMatch,
  AgentCompletionEvidenceVerification,
  AgentCompletionEvidenceVerificationRequirement,
  AgentCompletionEvidenceVerifier,
  AgentCompletionGateDecision,
  AgentCompletionMissingNeed,
  AgentCompletionProgressAssessment,
  AgentCompletionProgressCall,
  AgentCompletionRequirement,
  AgentCompletionRequirementState,
  AgentCompletionRequirementStatus,
  AgentCompletionSatisfiedNeed,
} from "./AgentCompletionGateTypes.js";

export class AgentCompletionGate {
  constructor(
    private readonly verifier?: AgentCompletionEvidenceVerifier,
  ) {}

  async decide(options: {
    input: ActionPlanInput;
    taskFrame: TaskFrame;
    signal?: AbortSignal;
  }): Promise<AgentCompletionGateDecision> {
    const progress = assessCompletionProgress(options.input);
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

    const requirements = collectCompletionRequirements(options.taskFrame);
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

    const evidence = collectCompletionEvidence(options.input);
    const capabilityIndex = new AgentEvidenceCapabilityIndex(options.input.toolCatalog);
    const verifiableTaskFrame = projectVerifiableTaskFrame(options.taskFrame);
    const verification = this.verifier
      && evidence.length > 0
      && (verifiableTaskFrame.requiredEvidence.length > 0 || verifiableTaskFrame.requiredEffects.length > 0)
      ? await this.verifier.verify({
          input: options.input,
          taskFrame: verifiableTaskFrame,
          signal: options.signal,
        })
      : undefined;
    const states = requirements.map((requirement) =>
      evaluateCompletionRequirement({
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
    const missing = projectMissingNeeds(states);

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

function projectMissingNeeds(states: readonly AgentCompletionRequirementState[]): AgentCompletionMissingNeed[] {
  return states
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
}
