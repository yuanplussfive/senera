import {
  TurnContextMode,
  type ActionPlanInput,
  type TurnUnderstanding,
} from "../Source/AgentSystem/BamlClient/baml_client/types.js";
import { AgentDefaults } from "../Source/AgentSystem/AgentDefaults.js";
import type {
  ResolvedAgentActionPlannerClientConfig,
  ResolvedAgentActionPlannerConfig,
} from "../Source/AgentSystem/Types/AgentConfigTypes.js";

export function createActionPlanInputFixture(userMessage = "inspect project"): ActionPlanInput {
  return {
    currentUserTurn: {
      content: userMessage,
    },
    roleplayPreset: {
      enabled: false,
      activePresetName: null,
      documents: [],
    },
    turnUnderstanding: {
      rawUserTurn: userMessage,
      standaloneRequest: userMessage,
      contextMode: TurnContextMode.None,
      contextBasis: "",
      missingContext: "",
    },
    runState: {
      currentStep: 1,
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
    timeline: [
      {
        index: 0,
        role: "user",
        kind: "user_message",
        content: userMessage,
        evidenceUris: [],
        artifactUris: [],
      },
    ],
    evidenceMemory: [],
    evidenceState: [],
    plannerJournal: [],
    toolTagCatalog: [],
    compactToolCatalog: [],
    toolCatalog: [],
    activeSkills: [],
  };
}

export function createTurnUnderstandingFixture(
  rawUserTurn: string,
  standaloneRequest = rawUserTurn,
): TurnUnderstanding {
  return {
    rawUserTurn,
    standaloneRequest,
    contextMode: TurnContextMode.None,
    contextBasis: "",
    missingContext: "",
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
    PlanningClient: options.client,
    FinalAnswerClient: options.client,
  };
}
