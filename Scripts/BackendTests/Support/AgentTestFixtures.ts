import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ResolvedAgentActionPlannerConfig,
  ResolvedAgentModelProviderConfig,
} from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import {
  createAgentToolAccessGrant,
  type AgentToolAccessGrant,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import type { AgentRootCommand } from "../../../Source/AgentSystem/AgentRootCommand.js";
import type {
  AgentPiPlanningCompilerFactory,
  AgentPiPlanningCompilerPort,
} from "../../../Source/AgentSystem/Pi/AgentPiPlanningCompiler.js";

export function toolAccessGrant(
  exposedToolNames: readonly string[] = [],
  preferredToolNames: readonly string[] = [],
): AgentToolAccessGrant {
  return createAgentToolAccessGrant({
    authorizedToolNames: exposedToolNames,
    exposedToolNames,
    preferredToolNames,
  });
}

export function toolExposure(grant: AgentToolAccessGrant = toolAccessGrant()): AgentToolExposureState {
  return new AgentToolExposureState(grant);
}

export function toolRootCommand(
  exposedToolNames: readonly string[] = [],
  preferredToolNames: readonly string[] = [],
): AgentRootCommand {
  return {
    authority: "senera_runtime_root",
    action: "use_tools",
    outputMode: "open",
    toolAccess: "restricted",
    objective: "Complete the current request.",
    instruction: null,
    toolAccessGrant: toolAccessGrant(exposedToolNames, preferredToolNames),
    forbiddenOutputs: ["unregistered_tools"],
    insufficiencyPolicy: "Report missing capabilities.",
    toolSearchQueries: [],
    needs: [],
    includeToolCatalog: false,
    visibleOutput: {
      audience: "runtime",
      start: "answer_body",
      format: "final_text",
      rules: [],
      repair: { instruction: "Return only the user-facing answer.", rules: [] },
    },
  };
}

export function createTemporaryDirectory(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

export function removeDirectory(directory: string): void {
  fs.rmSync(directory, { force: true, maxRetries: 8, recursive: true, retryDelay: 100 });
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
    ToolPlanningMode: "baml",
    ContextWindowTokens: 128_000,
    Temperature: 0,
    MaxOutputTokens: -1,
    Stream: true,
    TimeoutMs: 10_000,
    FirstTokenTimeoutMs: 10_000,
    MaxRequestMs: 10_000,
    MaxNetworkRetries: 0,
    RetryBaseDelayMs: 250,
    RetryMaxDelayMs: 10_000,
    RetryAfterMaxDelayMs: 60_000,
    Headers: {},
    ...overrides,
  };
}

export function createPiPlanningCompilerFactory(
  overrides: Partial<AgentPiPlanningCompilerPort> = {},
): AgentPiPlanningCompilerFactory {
  return {
    create: () => ({
      compile: async () => ({ kind: "final_text", content: "test response", toolCalls: [] }),
      summarize: async () => "test conversation summary",
      ...overrides,
    }),
  };
}
