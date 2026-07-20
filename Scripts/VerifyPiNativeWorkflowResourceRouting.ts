import assert from "node:assert/strict";
import {
  AgentInteractionRunModes,
  type AgentInteractionRouteResult,
} from "../Source/AgentSystem/ActionPlanner/AgentInteractionRouter.js";
import type { AgentActionPlannerContextBuilder } from "../Source/AgentSystem/ActionPlanner/AgentActionPlannerContext.js";
import { AgentLoopEventFactory } from "../Source/AgentSystem/Loop/AgentLoopEventFactory.js";
import type { AgentLoopCommand } from "../Source/AgentSystem/Loop/AgentLoopStateTypes.js";
import { AgentPlanningCommandHandler } from "../Source/AgentSystem/ActionPlanner/AgentPlanningCommandHandler.js";
import type { AgentRootCommand } from "../Source/AgentSystem/AgentRootCommand.js";
import {
  InteractionRunMode,
  TurnContextMode,
  type TurnUnderstanding,
} from "../Source/AgentSystem/BamlClient/baml_client/types.js";
import type { AgentActivatedSkill } from "../Source/AgentSystem/Skills/AgentSkillActivation.js";
import type { AgentSystemRuntime } from "../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import type { LoadedToolsState } from "../Source/AgentSystem/ToolSearch/AgentToolSearchRuntime.js";
import type { ResolvedAgentLoopConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const route = routeFixture();
const turnUnderstanding: TurnUnderstanding = {
  rawUserTurn: "继续全面优化拓展",
  standaloneRequest: "继续全面优化拓展代码质量，不要硬编码，运行测试验证直到完成",
  contextMode: TurnContextMode.None,
  contextBasis: "",
  missingContext: "",
};
const workflowSkill = workflowSkillFixture();
type ToolResolutionCall = {
  preferredTools?: readonly string[];
  currentLoadedTools?: LoadedToolsState;
};

const observed = {
  plannerActiveSkills: [] as AgentActivatedSkill[],
  resolveCalls: [] as ToolResolutionCall[],
  rememberedLoadedTools: undefined as LoadedToolsState | undefined,
  rootPreferredTools: [] as string[],
};

const handler = new AgentPlanningCommandHandler({
  runtime: fakeRuntime(),
  eventFactory: new AgentLoopEventFactory(),
  actionPlannerContextBuilder: {
    buildInput: (input: { activeSkills?: AgentActivatedSkill[] }) => {
      observed.plannerActiveSkills = input.activeSkills ?? [];
      return input;
    },
  } as unknown as AgentActionPlannerContextBuilder,
  agentLoopConfig: {
    LoadedTools: "dynamic",
  } as ResolvedAgentLoopConfig,
});

const result = await handler.prepareInteraction(routeCommand());

assert.equal(result.kind, "succeeded");
assert.equal(result.output.kind, "interaction_prepared");
assert.deepEqual(
  observed.plannerActiveSkills.map((skill) => skill.name),
  ["ExecutionWorkflowSkill"],
);
assert.deepEqual(
  observed.resolveCalls.map(({ preferredTools }) => preferredTools),
  [
    ["WorkspaceApplyPatch", "ShellCommandTool"],
    ["WorkspaceGrep"],
    ["WorkspaceGrep", "WorkspaceApplyPatch", "ShellCommandTool"],
  ],
);
assertToolSet(observed.resolveCalls[0]?.currentLoadedTools, ["SystemTool"]);
assertToolSet(observed.resolveCalls[1]?.currentLoadedTools, ["SystemTool", "WorkspaceApplyPatch", "ShellCommandTool"]);
assertToolSet(observed.resolveCalls[2]?.currentLoadedTools, [
  "SystemTool",
  "WorkspaceApplyPatch",
  "ShellCommandTool",
  "WorkspaceGrep",
]);
assert.deepEqual(observed.rootPreferredTools, ["WorkspaceGrep", "WorkspaceApplyPatch", "ShellCommandTool"]);
assert.deepEqual(
  result.output.activeSkills.map((skill) => skill.name),
  ["ExecutionWorkflowSkill"],
);
assertToolSet(result.output.loadedToolNames, [
  "SystemTool",
  "WorkspaceGrep",
  "WorkspaceApplyPatch",
  "ShellCommandTool",
]);
assert.deepEqual(observed.rememberedLoadedTools, result.output.loadedToolNames);
assert.equal(result.output.rootCommand?.action, "use_tools");
assert.deepEqual(result.output.rootCommand?.preferredTools, [
  "WorkspaceGrep",
  "WorkspaceApplyPatch",
  "ShellCommandTool",
]);

console.log("Pi-native workflow resource routing verified.");

function fakeRuntime(): AgentSystemRuntime {
  return {
    services: {
      planning: {
        prepareInteraction: async (input: { input: unknown }) => ({
          route,
          initialAction: {
            kind: "CallTools" as const,
            calls: [
              {
                toolName: "WorkspaceGrep",
                purpose: "Inspect the workspace before editing",
                required: true,
                argumentHints: {},
              },
            ],
          },
          input: {
            ...(input.input as Record<string, unknown>),
            turnUnderstanding,
          },
        }),
      },
      pi: {
        planningToolCards: ({ visibleToolNames }: { visibleToolNames?: "all" | readonly string[] } = {}) =>
          (visibleToolNames === "all" ? [] : (visibleToolNames ?? [])).map((name) => ({
            name,
            description: `${name} verification tool`,
            parameters: { type: "object", properties: {} },
          })),
      },
      promptContext: {
        activateSkills: () => [workflowSkill],
        recommendedSkillTools: () => ["WorkspaceApplyPatch", "ShellCommandTool"],
        plannerRoleplayPreset: async () => undefined,
        toolCatalog: () => [],
        buildRootCommand: ({
          decision,
          loadedToolNames,
        }: {
          decision: { action: string; useTools?: { preferredTools?: string[]; instruction?: string } };
          loadedToolNames: LoadedToolsState;
        }) => {
          observed.rootPreferredTools = decision.useTools?.preferredTools ?? [];
          return rootCommandFixture(loadedToolNames, observed.rootPreferredTools);
        },
      },
      retrieval: {
        resolvePlannedLoadedTools: (options: ToolResolutionCall) => {
          observed.resolveCalls.push(options);
          if (options.currentLoadedTools === "all") return "all";
          return uniqueTools(["SystemTool", ...(options.currentLoadedTools ?? []), ...(options.preferredTools ?? [])]);
        },
        rememberAutoSearch: (_requestId: string, _query: string, loadedTools: LoadedToolsState) => {
          observed.rememberedLoadedTools = loadedTools;
        },
      },
    },
  } as unknown as AgentSystemRuntime;
}

function routeCommand(): Extract<AgentLoopCommand, { kind: "prepare_interaction" }> {
  return {
    kind: "prepare_interaction",
    requestId: "verify-pi-native-workflow-resource-routing",
    step: 1,
    input: "继续全面优化拓展",
    messages: [
      {
        role: "user",
        content: "继续全面优化拓展",
      },
    ],
    conversationEntries: [],
    loadedToolNames: ["SystemTool"],
    plannerLedger: {
      calls: [],
      evidence: [],
      warnings: [],
      deltas: [],
      lastNewEvidenceStep: 0,
    },
  };
}

function routeFixture(): AgentInteractionRouteResult {
  return {
    mode: AgentInteractionRunModes.ToolAgentLoop,
    objective: "继续全面优化拓展代码质量",
    preferredTools: ["WorkspaceGrep"],
    discoveryQueries: ["Pi workflow resources"],
    raw: {
      mode: InteractionRunMode.ToolAgentLoop,
      objective: "继续全面优化拓展代码质量",
      preferredTools: ["WorkspaceGrep"],
      discoveryQueries: ["Pi workflow resources"],
    },
  };
}

function workflowSkillFixture(): AgentActivatedSkill {
  return {
    name: "ExecutionWorkflowSkill",
    title: "执行工作流",
    summary: "Pi-native workflow resource activation.",
    useCases: ["todo", "workflow", "until done"],
    avoid: [],
    recommendedTools: ["WorkspaceApplyPatch", "ShellCommandTool"],
    evidenceRequirements: [],
    descriptionFile: "System/Plugins/AgentCapabilitySkillsPlugin/docs/ExecutionWorkflow.md",
    matchedTerms: ["workflow"],
    matchedFields: [
      {
        term: "workflow",
        fields: ["summary"],
      },
    ],
    score: 1,
  };
}

function rootCommandFixture(loadedToolNames: LoadedToolsState, preferredTools: readonly string[]): AgentRootCommand {
  const toolNames = loadedToolNames === "all" ? [] : loadedToolNames;
  return {
    authority: "senera_runtime_root",
    action: "use_tools",
    outputMode: "open",
    toolAccess: "restricted",
    objective: "继续全面优化拓展代码质量",
    instruction: "Implementation work should run through Pi tool loop.",
    allowedTools: toolNames,
    forbiddenOutputs: ["unregistered_tools"],
    insufficiencyPolicy: "缺少工具能力时说明阻塞。",
    preferredTools: [...preferredTools],
    toolSearchQueries: [],
    needs: [],
    includeToolCatalog: false,
    visibleOutput: {
      audience: "runtime",
      start: "pi_tool_turn",
      format: "openai_tool_calls_or_final_text",
      rules: [],
      repair: {
        instruction: "按 Pi 工具调用协议重试。",
        rules: [],
      },
    },
  };
}

function uniqueTools(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function assertToolSet(actual: LoadedToolsState | undefined, expected: readonly string[]): void {
  assert.notEqual(actual, undefined);
  assert.notEqual(actual, "all");
  assert.deepEqual(new Set(actual), new Set(expected));
}
