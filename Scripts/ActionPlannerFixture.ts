import type { ActionPlanInput } from "../Source/AgentSystem/BamlClient/baml_client/types.js";

export function createActionPlanInputFixture(
  userMessage = "inspect project",
): ActionPlanInput {
  return {
    task: {
      userMessage,
    },
    runtime: {
      currentStep: 1,
      dynamicTools: true,
      loadedTools: [],
    },
    history: [],
    executionState: {
      calls: [],
      evidence: [],
      warnings: [],
      progress: {
        totalToolCalls: 0,
        totalEvidence: 0,
        lastNewEvidenceStep: 0,
        repeatedCallCount: 0,
        stalled: false,
      },
    },
    recentDeltas: [],
    toolCatalog: [],
  };
}

export function createActionDecisionFixture(): string {
  return JSON.stringify({
    action: "Answer",
    intent: "test",
    progressAssessment: "No tool evidence is required.",
    nextStepGoal: "Produce the final answer.",
    requiredCapabilities: [],
    tags: [],
    toolSearchQueries: [],
    preferredTools: [],
    confidence: 0.9,
    instructionToMainModel: "answer directly",
  });
}
