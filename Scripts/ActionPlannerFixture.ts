import type { ActionPlanInput } from "../Source/AgentSystem/BamlClient/baml_client/types.js";
import { AgentDefaults } from "../Source/AgentSystem/AgentDefaults.js";
import type {
  ResolvedAgentActionPlannerClientConfig,
  ResolvedAgentActionPlannerConfig,
} from "../Source/AgentSystem/Types.js";

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
      calls: [],
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
    evidenceState: [],
    plannerJournal: [],
    compactToolCatalog: [],
    toolCatalog: [],
    activeSkills: [],
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

export function createActionPlannerConfigFixture(options: {
  client: ResolvedAgentActionPlannerClientConfig;
  maxRepairAttempts?: number;
}): ResolvedAgentActionPlannerConfig {
  return {
    Enabled: true,
    MaxRepairAttempts: options.maxRepairAttempts ?? 0,
    Evidence: AgentDefaults.ActionPlanner.Evidence,
    Client: options.client,
    TaskFrameClient: options.client,
    EvidenceClient: options.client,
  };
}
