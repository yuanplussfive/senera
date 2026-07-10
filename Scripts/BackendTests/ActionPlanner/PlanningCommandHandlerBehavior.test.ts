import { describe, expect, test } from "vitest";
import { AgentPlanningCommandHandler, type AgentPlanningCommandRuntime } from "../../../Source/AgentSystem/ActionPlanner/AgentPlanningCommandHandler.js";
import { EmptyActionPlannerLedger } from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerContext.js";
import { projectInteractionRoute } from "../../../Source/AgentSystem/ActionPlanner/AgentInteractionRouter.js";
import { AgentLoopEventFactory } from "../../../Source/AgentSystem/Loop/AgentLoopEventFactory.js";
import type { AgentRootCommand } from "../../../Source/AgentSystem/AgentRootCommand.js";
import type { AgentActivatedSkill } from "../../../Source/AgentSystem/Skills/AgentSkillActivation.js";
import type {
  AgentLoadedToolsConfig,
  ResolvedAgentLoopConfig,
} from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { InteractionRunMode } from "../../../Source/AgentSystem/BamlClient/baml_client/types.js";
import type { AgentPromptRootCommandOptions } from "../../../Source/AgentSystem/Prompt/AgentPromptContextTypes.js";
import type { LoadedToolsState } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchRuntimeTypes.js";
import type { AgentLanguageModelMessage } from "../../../Source/AgentSystem/ModelEndpoints/AgentLanguageModel.js";
import {
  createActionPlanInput,
  createInteractionRoute,
  createTurnUnderstanding,
} from "../Support/AgentTestFixtures.js";

describe("Planning command handler behavior", () => {
  test("routes tool interactions through dynamic discovery, skill recommendations, and Pi root projection", async () => {
    const fixture = createRuntimeFixture();
    const handler = new AgentPlanningCommandHandler({
      runtime: fixture.runtime,
      eventFactory: new AgentLoopEventFactory(),
      actionPlannerContextBuilder: fixture.contextBuilder,
      agentLoopConfig: dynamicLoopConfig,
    });

    const result = await handler.routeInteraction({
      kind: "route_interaction",
      requestId: "request-1",
      step: 2,
      input: "Inspect the release workflow",
      messages: [{ role: "user", content: "fallback message" }],
      conversationEntries: [],
      loadedToolNames: [],
      plannerLedger: EmptyActionPlannerLedger,
      activeSkills: [],
      turnUnderstanding: createTurnUnderstanding("Inspect the release workflow"),
    });

    expect(result).toMatchObject({
      kind: "succeeded",
      output: {
        kind: "interaction_routed",
        loadedToolNames: ["WorkspaceReadFile", "ArtifactMemoryReadTool"],
      },
    });
    const output = result.output;
    if (output.kind !== "interaction_routed") {
      throw new Error("Expected interaction_routed output.");
    }
    expect(output.activeSkills.map((skill) => [skill.name, skill.score])).toEqual([
      ["ReleaseSkill", 0.9],
      ["EvidenceSkill", 0.7],
    ]);
    expect(output.rootCommand?.authority).toBe("senera_runtime_root");
    expect(fixture.resolveRequests.map((request) => request.preferredTools)).toEqual([
      ["WorkspaceReadFile"],
      ["WorkspaceReadFile", "ArtifactMemoryReadTool"],
    ]);
    expect(fixture.autoSearches).toEqual([{
      requestId: "request-1",
      input: "Inspect the release workflow",
      loadedToolNames: ["WorkspaceReadFile", "ArtifactMemoryReadTool"],
    }]);
  });

  test("uses materialized conversation history and keeps direct responses free of tool discovery", async () => {
    const fixture = createRuntimeFixture({
      route: createInteractionRoute({
        mode: InteractionRunMode.DirectResponse,
        preferredTools: [],
        discoveryQueries: [],
      }),
    });
    const handler = new AgentPlanningCommandHandler({
      runtime: fixture.runtime,
      eventFactory: new AgentLoopEventFactory(),
      actionPlannerContextBuilder: fixture.contextBuilder,
      agentLoopConfig: dynamicLoopConfig,
    });

    const result = await handler.routeInteraction({
      kind: "route_interaction",
      requestId: "request-2",
      step: 1,
      input: "Explain the current state",
      messages: [{ role: "user", content: "fallback message" }],
      conversationEntries: [{
        id: "request-1:user",
        requestId: "request-1",
        timestamp: "2026-01-01T00:00:00.000Z",
        kind: "user.message",
        content: "Previous question",
      }],
      loadedToolNames: [],
      plannerLedger: EmptyActionPlannerLedger,
      activeSkills: [],
    });

    expect(result).toMatchObject({
      output: {
        kind: "interaction_routed",
        loadedToolNames: [],
      },
    });
    expect(fixture.contextMessages[0]).toEqual([{ role: "user", content: "materialized history" }]);
    expect(fixture.resolveRequests).toEqual([]);
    expect(fixture.autoSearches).toEqual([]);
  });
});

const dynamicLoopConfig: ResolvedAgentLoopConfig = {
  LoadedTools: "dynamic",
  PiSessionCreateTimeoutSeconds: 20,
  PiSessionCreateTimeoutMs: 20_000,
  PiSessions: { RootDir: ".senera/pi-sessions" },
};

function createRuntimeFixture(options: {
  route?: ReturnType<typeof createInteractionRoute>;
} = {}) {
  const contextMessages: AgentLanguageModelMessage[][] = [];
  const resolveRequests: Array<{ preferredTools: readonly string[] }> = [];
  const autoSearches: Array<{ requestId: string; input: string; loadedToolNames: "all" | string[] }> = [];
  const route = options.route ?? createInteractionRoute();
  const initialSkill = skill("ReleaseSkill", 0.5, ["ArtifactMemoryReadTool"]);
  const enrichedSkill = skill("ReleaseSkill", 0.9, ["ArtifactMemoryReadTool"]);
  const evidenceSkill = skill("EvidenceSkill", 0.7, ["ArtifactMemoryReadTool"]);
  let activationCount = 0;

  const runtime = {
    services: {
      planning: {
        understandTurn: async ({ input }: { input: ReturnType<typeof createActionPlanInput> }) => input,
        routeWithInput: async ({ input }: { input: ReturnType<typeof createActionPlanInput> }) => ({
          input: {
            ...input,
            turnUnderstanding: input.turnUnderstanding ?? createTurnUnderstanding(input.currentUserTurn.content),
          },
          route: projectInteractionRoute(route),
        }),
      },
      retrieval: {
        resolvePlannedLoadedTools: (request: {
          input: string;
          loadedTools: AgentLoadedToolsConfig;
          currentLoadedTools?: LoadedToolsState;
          preferredTools?: readonly string[];
          queries?: readonly string[];
        }) => {
          resolveRequests.push({ preferredTools: request.preferredTools ?? [] });
          return [...new Set(request.preferredTools ?? [])];
        },
        rememberAutoSearch: (requestId: string, input: string, loadedToolNames: "all" | string[]) => {
          autoSearches.push({ requestId, input, loadedToolNames });
        },
      },
      promptContext: {
        plannerRoleplayPreset: async () => ({ enabled: false, activePresetName: null, documents: [] }),
        activateSkills: () => {
          activationCount += 1;
          return activationCount === 1 ? [initialSkill] : [enrichedSkill, evidenceSkill];
        },
        recommendedSkillTools: (skills: readonly AgentActivatedSkill[]) => skills.flatMap((entry) => entry.recommendedTools),
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
  };
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
  loadedToolNames: "all" | readonly string[],
): AgentRootCommand {
  return {
    authority: "senera_runtime_root",
    action,
    outputMode: "final_text",
    toolAccess: "restricted",
    objective: "Test objective",
    instruction: null,
    allowedTools: loadedToolNames === "all" ? [] : [...loadedToolNames],
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
