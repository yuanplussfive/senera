import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ActionPlanInput,
  InteractionRoute,
  TurnUnderstanding,
} from "../../../Source/AgentSystem/BamlClient/baml_client/types.js";
import { InteractionRunMode, TurnContextMode } from "../../../Source/AgentSystem/BamlClient/baml_client/types.js";
import type { AgentActionPlannerCoreClient } from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerModelClient.js";
import type { ParsedInteractionPreparation } from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerSchema.js";
import type {
  ResolvedAgentActionPlannerConfig,
  ResolvedAgentModelProviderConfig,
} from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

export function createTemporaryDirectory(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

export function removeDirectory(directory: string): void {
  fs.rmSync(directory, { recursive: true, force: true });
}

export function createActionPlanInput(overrides: Partial<ActionPlanInput> = {}): ActionPlanInput {
  return {
    currentUserTurn: {
      content: "Inspect the workspace",
    },
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
    timeline: [],
    evidenceMemory: [],
    evidenceState: [],
    plannerJournal: [],
    toolTagCatalog: [],
    compactToolCatalog: [],
    toolCatalog: [],
    activeSkills: [],
    ...overrides,
  };
}

export function createTurnUnderstanding(
  rawUserTurn = "Inspect the workspace",
  overrides: Partial<TurnUnderstanding> = {},
): TurnUnderstanding {
  return {
    rawUserTurn,
    standaloneRequest: rawUserTurn,
    contextMode: TurnContextMode.None,
    contextBasis: "",
    missingContext: "",
    ...overrides,
  };
}

export function createInteractionRoute(overrides: Partial<InteractionRoute> = {}): InteractionRoute {
  return {
    mode: InteractionRunMode.ToolAgentLoop,
    objective: "Inspect the workspace",
    preferredTools: ["WorkspaceReadFile"],
    discoveryQueries: ["workspace"],
    ...overrides,
  };
}

export function createInteractionPreparation(
  overrides: Partial<ParsedInteractionPreparation> = {},
): ParsedInteractionPreparation {
  return {
    turnUnderstanding: createTurnUnderstanding(),
    initialAction: {
      kind: "CallTools",
      preface: "Inspecting the workspace.",
      calls: [
        {
          toolName: "WorkspaceReadFile",
          purpose: "Read the requested workspace file.",
          required: true,
        },
      ],
    },
    ...overrides,
  };
}

export function createPlannerConfig(
  overrides: Partial<ResolvedAgentActionPlannerConfig> = {},
): ResolvedAgentActionPlannerConfig {
  const client = {
    ModelProviderId: undefined,
    ModelProvider: createModelProvider(),
    BaseUrl: "https://model.example/v1",
    ApiKey: "test-key",
    Model: "test-model",
    Temperature: 0,
    MaxTokens: -1,
  };
  return {
    Enabled: true,
    MaxRepairAttempts: 1,
    Evidence: {
      StalledStepLag: 2,
    },
    Client: { ...client },
    PlanningClient: { ...client },
    ...overrides,
    FinalAnswerClient: { ...(overrides.FinalAnswerClient ?? client) },
  };
}

export function createModelProvider(
  overrides: Partial<ResolvedAgentModelProviderConfig> = {},
): ResolvedAgentModelProviderConfig {
  return {
    Id: "test-provider",
    ProviderId: "test-endpoint",
    Kind: "OpenAICompatible",
    Endpoint: "ChatCompletions",
    BaseUrl: "https://model.example/v1",
    ApiKey: "test-key",
    ApiVersion: "",
    Model: "test-model",
    Temperature: 0,
    MaxOutputTokens: -1,
    Stream: true,
    TimeoutMs: 10_000,
    FirstTokenTimeoutMs: 10_000,
    MaxRequestMs: 10_000,
    MaxNetworkRetries: 0,
    Headers: {},
    ...overrides,
  };
}

export class FakePlannerClient implements AgentActionPlannerCoreClient {
  readonly preparationInputs: ActionPlanInput[] = [];
  readonly preparationCandidateTools: Array<
    readonly import("../../../Source/AgentSystem/PiProxy/AgentPiAssistantMessageTypes.js").AgentPiToolCard[]
  > = [];

  constructor(private readonly preparation: ParsedInteractionPreparation | Error = createInteractionPreparation()) {}

  async prepareInteraction(
    input: ActionPlanInput,
    options?: {
      candidateTools?: readonly import("../../../Source/AgentSystem/PiProxy/AgentPiAssistantMessageTypes.js").AgentPiToolCard[];
      signal?: AbortSignal;
    },
  ): Promise<ParsedInteractionPreparation> {
    this.preparationInputs.push(input);
    this.preparationCandidateTools.push(options?.candidateTools ?? []);
    return resolveFixture(this.preparation);
  }
}

function resolveFixture<T>(value: T | Error): T {
  if (value instanceof Error) {
    throw value;
  }
  return value;
}
