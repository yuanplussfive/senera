import type { ActionPlanInput } from "../Source/AgentSystem/BamlClient/baml_client/types.js";

export function createActionPlanInputFixture(
  userMessage = "inspect project",
): ActionPlanInput {
  return {
    runState: {
      currentStep: 1,
      dynamicTools: true,
      loadedTools: [],
      progress: {
        totalToolCalls: 0,
        totalEvidence: 0,
        lastNewEvidenceStep: 0,
        repeatedCallCount: 0,
        stalled: false,
      },
      warnings: [],
    },
    timeline: [{
      index: 0,
      role: "user",
      kind: "user_message",
      content: userMessage,
      evidenceRefs: [],
      artifactUris: [],
    }],
    evidenceMemory: [],
    plannerJournal: [],
    toolCatalog: [],
  };
}

export function createActionDecisionFixture(): string {
  return JSON.stringify({
    action: "Answer",
    askUser: null,
    useTools: null,
    discoverTools: null,
  });
}
