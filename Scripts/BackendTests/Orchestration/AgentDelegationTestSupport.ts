import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AgentChildRunModelSelectionSources,
  AgentChildWorkspaceAccessModes,
} from "../../../Source/AgentSystem/Orchestration/AgentChildRunTypes.js";
import type {
  AgentChildRunModelSelectionSource,
  AgentChildWorkspaceAccessMode,
} from "../../../Source/AgentSystem/Orchestration/AgentChildRunTypes.js";
import { AgentOrchestrationDatabase } from "../../../Source/AgentSystem/Orchestration/AgentOrchestrationDatabase.js";
import { AgentRunContextModes } from "../../../Source/AgentSystem/Orchestration/AgentRunDispatchPort.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

const temporaryRoots: string[] = [];

export function cleanupDelegationTestRoots(): void {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
}

export function openDelegationTestDatabase(): AgentOrchestrationDatabase {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-delegation-"));
  temporaryRoots.push(root);
  return new AgentOrchestrationDatabase(path.join(root, "orchestration.sqlite"));
}

export function modelConfig(
  maxDepth?: number | null,
  concurrency?: { readonly maxRuns?: number | null; readonly maxWorkspaceWriters?: number | null },
): AgentSystemConfig {
  const config: AgentSystemConfig = {
    DefaultModelProviderId: "main",
    ModelProviderEndpoints: [
      {
        Id: "openai",
        Enabled: true,
        Kind: "OpenAICompatible" as const,
        BaseUrl: "https://models.example.test/v1",
        ApiKey: "test-api-key",
      },
    ],
    ModelProviders: [
      {
        Id: "main",
        ProviderId: "openai",
        Endpoint: "Responses" as const,
        Model: "gpt-5",
        Capabilities: { Reasoning: true },
      },
    ],
  };
  return maxDepth === undefined && concurrency === undefined
    ? config
    : {
        ...config,
        Extensions: {
          "agent-delegation": {
            Configuration: {
              ...(maxDepth !== undefined ? { execution: { maxDepth } } : {}),
              ...(concurrency ? { concurrency } : {}),
            },
          },
        },
      };
}

export function delegatedModelConfig(): AgentSystemConfig {
  const base = modelConfig();
  return {
    DefaultModelProviderId: "main",
    ModelProviderEndpoints: base.ModelProviderEndpoints,
    ModelProviders: [
      ...base.ModelProviders,
      {
        Id: "child-model",
        ProviderId: "openai",
        Endpoint: "Responses",
        Model: "gpt-5-mini",
        Capabilities: { Chat: true },
      },
    ],
    Extensions: {
      "agent-delegation": {
        Configuration: {
          modelPool: {
            inheritParent: false,
            modelProviderIds: ["child-model"],
          },
          defaults: {
            skills: ["workspace-investigation"],
            thinkingLevel: "medium",
          },
        },
      },
    },
  };
}

export function registeredTool(
  name: string,
  capabilityId: string,
  workspace: "ReadOnly" | "ReadWrite",
  childGrant: "inherit" | "internal" | "delegation" = "inherit",
) {
  return {
    name,
    execution: { Workspace: workspace },
    childGrant,
    search: { Capabilities: [{ Id: capabilityId }] },
  } as never;
}

export function delegationPlan(
  modelProviderId = "main",
  pinnedSkills: Array<{ name: string; revision: string }> = [],
  selectionSource: AgentChildRunModelSelectionSource = AgentChildRunModelSelectionSources.Parent,
  workspaceAccess: AgentChildWorkspaceAccessMode = AgentChildWorkspaceAccessModes.ReadWrite,
) {
  const capabilityCeiling = {
    version: 2 as const,
    allowedTools: ["ShellCommandTool"],
    allowedAgents: ["reviewer"],
    denyExtensions: true,
    sources: ["senera.test"],
  };
  return {
    launchContract: {
      version: 2 as const,
      runId: "childrun",
      role: {
        id: "reviewer",
        description: "Review code.",
        source: "builtin" as const,
        filePath: "reviewer.md",
        revision: "definition",
        canDelegate: false,
      },
      context: AgentRunContextModes.Fork,
      model: modelProviderId,
      modelCandidates: [modelProviderId],
      systemPromptMode: "replace" as const,
      inheritProjectContext: true,
      inheritSkills: false,
      skills: { requested: [] },
      tools: {
        effectiveToolNames: ["ShellCommandTool"],
        capabilityCeiling,
      },
      diagnostics: [],
      launchContractDigest: "launch",
    },
    promptLayer: { mode: "replace" as const, content: "Reviewer role prompt" },
    model: {
      selectedModelProviderId: modelProviderId,
      candidateModelProviderIds: [modelProviderId],
      selectionSource,
    },
    pinnedSkills,
    allowedToolNames: ["ShellCommandTool"],
    workspaceAccess,
    inheritProjectContext: true,
    capabilityCeiling,
    diagnostics: [],
  };
}

export class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolve = resolve;
    });
  }
}

export function testDeadlinePolicy() {
  return {
    softTimeoutMs: 10_000,
    wrapUpTimeoutMs: 1_000,
    snapshotIntervalMs: 100,
    activityExtension: {
      recentActivityWindowMs: 1_000,
      stepMs: 1_000,
      maximumMs: 2_000,
    },
  } as const;
}
