import { describe, expect, test } from "vitest";
import {
  AgentPlanningCommandHandler,
  type AgentPlanningCommandRuntime,
} from "../../../Source/AgentSystem/ActionPlanner/AgentPlanningCommandHandler.js";
import { EmptyActionPlannerLedger } from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerContext.js";
import { projectInteractionRoute } from "../../../Source/AgentSystem/ActionPlanner/AgentInteractionRouter.js";
import { AgentLoopEventFactory } from "../../../Source/AgentSystem/Loop/AgentLoopEventFactory.js";
import type { AgentRootCommand } from "../../../Source/AgentSystem/AgentRootCommand.js";
import type { AgentActivatedSkill } from "../../../Source/AgentSystem/Skills/AgentSkillActivation.js";
import { InteractionRunMode } from "../../../Source/AgentSystem/BamlClient/baml_client/types.js";
import type { AgentPromptRootCommandOptions } from "../../../Source/AgentSystem/Prompt/AgentPromptContextTypes.js";
import type { LoadedToolsState } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchRuntimeTypes.js";
import type { AgentToolSearchCurrentSetPolicy } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchRuntimeTypes.js";
import type { AgentLanguageModelMessage } from "../../../Source/AgentSystem/ModelEndpoints/AgentLanguageModel.js";
import type { ParsedPiControllerAction } from "../../../Source/AgentSystem/PiProxy/AgentPiAssistantMessageSchema.js";
import {
  createActionPlanInput,
  createInteractionRoute,
  createTurnUnderstanding,
} from "../Support/AgentTestFixtures.js";
import { AgentActionPlannerValidationError } from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerSchema.js";

describe("Planning command handler behavior", () => {
  test("routes tool interactions through on-demand discovery, skill recommendations, and Pi root projection", async () => {
    const fixture = createRuntimeFixture();
    const handler = new AgentPlanningCommandHandler({
      runtime: fixture.runtime,
      eventFactory: new AgentLoopEventFactory(),
      actionPlannerContextBuilder: fixture.contextBuilder,
    });

    const result = await handler.prepareInteraction({
      kind: "prepare_interaction",
      requestId: "request-1",
      step: 2,
      input: "Inspect the release workflow",
      messages: [{ role: "user", content: "fallback message" }],
      conversationEntries: [],
      loadedToolNames: ["WeatherTool"],
      plannerLedger: EmptyActionPlannerLedger,
    });

    expect(result).toMatchObject({
      kind: "succeeded",
      output: {
        kind: "interaction_prepared",
        loadedToolNames: ["WeatherTool", "ArtifactMemoryReadTool", "WorkspaceReadFile"],
      },
    });
    const output = result.output;
    if (output.kind !== "interaction_prepared") {
      throw new Error("Expected interaction_prepared output.");
    }
    expect(output.activeSkills.map((skill) => [skill.name, skill.score])).toEqual([
      ["ReleaseSkill", 0.9],
      ["EvidenceSkill", 0.7],
    ]);
    expect(output.rootCommand?.authority).toBe("senera_runtime_root");
    expect(output.rootCommand?.action).toBe("use_tools");
    expect(output.initialAction).toMatchObject({
      kind: "CallTools",
      calls: [{ toolName: "WorkspaceReadFile" }],
    });
    expect(fixture.candidateToolSets).toEqual([
      [
        {
          name: "WeatherTool",
          description: "WeatherTool description",
          parameterContract: {
            format: "json_schema",
            schema: { type: "object", properties: {} },
          },
        },
        {
          name: "ArtifactMemoryReadTool",
          description: "ArtifactMemoryReadTool description",
          parameterContract: {
            format: "json_schema",
            schema: { type: "object", properties: {} },
          },
        },
      ],
    ]);
    expect(fixture.resolveRequests.map((request) => request.preferredTools)).toEqual([
      ["ArtifactMemoryReadTool"],
      ["WorkspaceReadFile"],
      ["WorkspaceReadFile", "ArtifactMemoryReadTool"],
    ]);
    expect(fixture.resolveRequests.map((request) => request.currentSetPolicy)).toEqual(["retain", "retain", "retain"]);
    expect(fixture.autoSearches).toEqual([
      {
        requestId: "request-1",
        input: "Inspect the release workflow",
        loadedToolNames: ["WeatherTool", "ArtifactMemoryReadTool", "WorkspaceReadFile"],
      },
    ]);
  });

  test("uses materialized conversation history and keeps direct responses free of tool discovery", async () => {
    const fixture = createRuntimeFixture({
      route: createInteractionRoute({
        mode: InteractionRunMode.DirectResponse,
        preferredTools: [],
        discoveryQueries: [],
      }),
      skills: [],
    });
    const handler = new AgentPlanningCommandHandler({
      runtime: fixture.runtime,
      eventFactory: new AgentLoopEventFactory(),
      actionPlannerContextBuilder: fixture.contextBuilder,
    });

    const result = await handler.prepareInteraction({
      kind: "prepare_interaction",
      requestId: "request-2",
      step: 1,
      input: "Explain the current state",
      messages: [{ role: "user", content: "fallback message" }],
      conversationEntries: [
        {
          id: "request-1:user",
          requestId: "request-1",
          timestamp: "2026-01-01T00:00:00.000Z",
          kind: "user.message",
          content: "Previous question",
        },
      ],
      loadedToolNames: [],
      plannerLedger: EmptyActionPlannerLedger,
    });

    expect(result).toMatchObject({
      output: {
        kind: "interaction_prepared",
        loadedToolNames: [],
      },
    });
    expect(fixture.contextMessages[0]).toEqual([{ role: "user", content: "materialized history" }]);
    expect(fixture.resolveRequests).toEqual([]);
    expect(fixture.autoSearches).toEqual([]);
    expect(fixture.candidateToolSets).toEqual([[]]);
  });

  test("promotes a registered dynamic tool once when preparation selected it before activation", async () => {
    const fixture = createRuntimeFixture({
      skills: [],
      registeredToolNames: ["ToolSearchTool", "ShellCommandTool"],
      promoteToolName: "ShellCommandTool",
      initialAction: {
        kind: "CallTools",
        preface: "Calling the external API.",
        calls: [
          {
            toolName: "ShellCommandTool",
            purpose: "Call the user-selected API endpoint.",
            required: true,
          },
        ],
      },
    });
    const handler = new AgentPlanningCommandHandler({
      runtime: fixture.runtime,
      eventFactory: new AgentLoopEventFactory(),
      actionPlannerContextBuilder: fixture.contextBuilder,
    });

    const result = await handler.prepareInteraction({
      kind: "prepare_interaction",
      requestId: "request-promote-shell",
      step: 1,
      input: "Call an external model API with PowerShell",
      messages: [],
      conversationEntries: [],
      loadedToolNames: ["ToolSearchTool"],
      plannerLedger: EmptyActionPlannerLedger,
    });

    expect(fixture.candidateToolSets.map((tools) => tools.map((tool) => readToolName(tool)))).toEqual([
      ["ToolSearchTool"],
      ["ToolSearchTool", "ShellCommandTool"],
    ]);
    expect(result).toMatchObject({
      output: {
        kind: "interaction_prepared",
        loadedToolNames: ["ToolSearchTool", "ShellCommandTool"],
        initialAction: {
          calls: [{ toolName: "ShellCommandTool" }],
        },
      },
    });
  });
});

function createRuntimeFixture(
  options: {
    route?: ReturnType<typeof createInteractionRoute>;
    skills?: AgentActivatedSkill[];
    registeredToolNames?: string[];
    promoteToolName?: string;
    initialAction?: ParsedPiControllerAction;
  } = {},
) {
  const contextMessages: AgentLanguageModelMessage[][] = [];
  const candidateToolSets: unknown[][] = [];
  const resolveRequests: Array<{
    preferredTools: readonly string[];
    currentSetPolicy?: AgentToolSearchCurrentSetPolicy;
  }> = [];
  const autoSearches: Array<{ requestId: string; input: string; loadedToolNames: string[] }> = [];
  const route = options.route ?? createInteractionRoute();
  const initialAction: ParsedPiControllerAction =
    options.initialAction ??
    (route.mode === InteractionRunMode.DirectResponse
      ? { kind: "FinalAnswer", answerPlan: ["Answer the latest request."] }
      : {
          kind: "CallTools",
          preface: "Inspecting the workspace.",
          calls: [
            {
              toolName: "WorkspaceReadFile",
              purpose: "Read the workspace file.",
              required: true,
            },
          ],
        });
  const initialSkill = skill("ReleaseSkill", 0.5, ["ArtifactMemoryReadTool"]);
  const enrichedSkill = skill("ReleaseSkill", 0.9, ["ArtifactMemoryReadTool"]);
  const evidenceSkill = skill("EvidenceSkill", 0.7, ["ArtifactMemoryReadTool"]);
  let activationCount = 0;
  let preparationCount = 0;
  const registeredToolNames = options.registeredToolNames ?? [
    "WeatherTool",
    "WorkspaceReadFile",
    "ArtifactMemoryReadTool",
  ];

  const runtime = {
    services: {
      planning: {
        prepareInteraction: async ({
          input,
          candidateTools = [],
        }: {
          input: ReturnType<typeof createActionPlanInput>;
          candidateTools?: readonly unknown[];
        }) => {
          preparationCount += 1;
          candidateToolSets.push(candidateTools.map((tool) => structuredClone(tool)));
          if (options.promoteToolName && preparationCount === 1) {
            throw new Error("Preparation selected an inactive registered tool.", {
              cause: new AgentActionPlannerValidationError(
                [`calls.0.toolName: ${options.promoteToolName} is not active`],
                {
                  initialAction: {
                    kind: "CallTools",
                    calls: [{ toolName: options.promoteToolName }],
                  },
                },
              ),
            });
          }
          return {
            input: {
              ...input,
              turnUnderstanding: input.turnUnderstanding ?? createTurnUnderstanding(input.currentUserTurn.content),
            },
            route: projectInteractionRoute(route),
            initialAction,
          };
        },
      },
      pi: {
        planningToolCards: ({ visibleToolNames }: { visibleToolNames?: readonly string[] } = {}) =>
          (visibleToolNames ?? registeredToolNames).map((name) => ({
            name,
            description: `${name} description`,
            parameterContract: {
              format: "json_schema" as const,
              schema: { type: "object", properties: {} },
            },
          })),
      },
      retrieval: {
        resolvePlannedLoadedTools: (request: {
          input: string;
          currentLoadedTools?: LoadedToolsState;
          currentSetPolicy?: AgentToolSearchCurrentSetPolicy;
          preferredTools?: readonly string[];
          queries?: readonly string[];
        }) => {
          resolveRequests.push({
            preferredTools: request.preferredTools ?? [],
            currentSetPolicy: request.currentSetPolicy,
          });
          const current = request.currentSetPolicy === "retain" ? (request.currentLoadedTools ?? []) : [];
          return [...new Set([...current, ...(request.preferredTools ?? [])])].filter((name) =>
            registeredToolNames.includes(name),
          );
        },
        rememberAutoSearch: (requestId: string, input: string, loadedToolNames: string[]) => {
          autoSearches.push({ requestId, input, loadedToolNames });
        },
      },
      promptContext: {
        plannerRoleplayPreset: async () => ({ enabled: false, activePresetName: null, documents: [] }),
        activateSkills: () => {
          if (options.skills) return options.skills;
          activationCount += 1;
          return activationCount === 1 ? [initialSkill] : [enrichedSkill, evidenceSkill];
        },
        recommendedSkillTools: (skills: readonly AgentActivatedSkill[]) =>
          skills.flatMap((entry) => entry.recommendedTools),
        toolCatalog: () => [],
        buildRootCommand: ({ decision, loadedToolNames }: AgentPromptRootCommandOptions) =>
          rootCommand(decision.action, loadedToolNames),
      },
    },
    conversationPolicy: {
      materialize: () => [{ role: "user" as const, content: "materialized history" }],
    },
  } satisfies AgentPlanningCommandRuntime;

  const contextBuilder = {
    buildInput: (options: {
      userMessage: string;
      messages: readonly { role: "system" | "developer" | "user" | "assistant"; content: string }[];
      turnUnderstanding?: ReturnType<typeof createTurnUnderstanding>;
    }) => {
      const input = createActionPlanInput({
        currentUserTurn: { content: options.userMessage },
        timeline: [],
        turnUnderstanding: options.turnUnderstanding,
      });
      contextMessages.push([...options.messages]);
      return input;
    },
  };

  return {
    runtime,
    contextBuilder,
    contextMessages,
    resolveRequests,
    autoSearches,
    candidateToolSets,
  };
}

function readToolName(value: unknown): string {
  return value && typeof value === "object" && "name" in value ? String(value.name) : "";
}

function skill(name: string, score: number, recommendedTools: string[]): AgentActivatedSkill {
  return {
    name,
    title: name,
    summary: `${name} summary`,
    useCases: [],
    avoid: [],
    recommendedTools,
    evidenceRequirements: [],
    descriptionFile: "",
    matchedTerms: [],
    matchedFields: [],
    score,
  };
}

function rootCommand(
  action: AgentPromptRootCommandOptions["decision"]["action"],
  loadedToolNames: readonly string[],
): AgentRootCommand {
  return {
    authority: "senera_runtime_root",
    action,
    outputMode: "final_text",
    toolAccess: "restricted",
    objective: "Test objective",
    instruction: null,
    allowedTools: [...loadedToolNames],
    forbiddenOutputs: [],
    insufficiencyPolicy: "ask",
    preferredTools: [],
    toolSearchQueries: [],
    needs: [],
    includeToolCatalog: false,
    visibleOutput: {
      audience: "user",
      start: "",
      format: "text",
      rules: [],
      repair: { instruction: "", rules: [] },
    },
  };
}
