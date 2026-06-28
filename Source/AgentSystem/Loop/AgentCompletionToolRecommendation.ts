import type { ActionPlanInput, TaskFrame } from "../BamlClient/baml_client/types.js";
import {
  AgentEvidenceCapabilityIndex,
  uniqueCapabilityNeeds,
} from "../AgentEvidenceCapabilityIndex.js";
import type {
  AgentCompletionCandidateToolRecommendation,
  AgentCompletionMissingNeed,
  AgentCompletionProgressAssessment,
} from "./AgentCompletionGateTypes.js";

export function projectCandidateToolRecommendations(
  input: ActionPlanInput,
  taskFrame: TaskFrame,
  capabilityIndex: AgentEvidenceCapabilityIndex,
): AgentCompletionCandidateToolRecommendation[] {
  const byName = new Map(input.toolCatalog.map((tool) => [tool.name, tool]));
  const byTool = new Map<string, AgentCompletionCandidateToolRecommendation>();
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

export function buildToolInstruction(
  taskFrame: TaskFrame,
  missing: readonly AgentCompletionMissingNeed[],
  progress: AgentCompletionProgressAssessment,
): string {
  return JSON.stringify({
    purpose: taskFrame.nextStepPurpose || taskFrame.answerGoal,
    missingNeeds: missing.map((need) => ({
      id: need.id,
      need: need.need,
      status: need.status,
      observed: need.observed,
      required: need.required,
      reason: need.reason,
      missingFacts: need.missingFacts,
      unsupportedClaims: need.unsupportedClaims,
      blockers: need.blockers,
    })),
    completionCriteria: taskFrame.completionCriteria,
    progressSignals: {
      stalled: progress.stalled,
      repeatedCalls: progress.repeatedCalls,
      nonEvidenceCalls: progress.nonEvidenceCalls,
      failedCalls: progress.failedCalls,
    },
  });
}
