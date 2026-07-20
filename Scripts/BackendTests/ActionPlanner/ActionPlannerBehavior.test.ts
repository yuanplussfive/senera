import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  InteractionRunMode,
  PiControllerActionKind,
  TurnContextMode,
  type InteractionPreparation,
  type InteractionRoute,
} from "../../../Source/AgentSystem/BamlClient/baml_client/types.js";
import {
  AgentInteractionRunModes,
  AgentInteractionRouter,
  projectInteractionRoute,
  projectPreparedInteractionRoute,
} from "../../../Source/AgentSystem/ActionPlanner/AgentInteractionRouter.js";
import {
  collectPlannerFailureToolNames,
  issueMessages,
  isRepairablePlanningFailure,
  normalizePlanningFailure,
  stringifyIssueValue,
  summarizePlannerFailure,
} from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerFailure.js";
import {
  AgentActionPlannerValidationError,
  parseInteractionPreparation,
} from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerSchema.js";
import { AgentBamlStructuredOutputError } from "../../../Source/AgentSystem/BamlClient/AgentBamlStructuredOutputRunner.js";

describe("ActionPlanner behavior", () => {
  test("projects BAML interaction routes into runtime routing decisions without sharing arrays", () => {
    const route = createRoute({
      preferredTools: ["WorkspaceReadFile"],
      discoveryQueries: ["workspace read"],
    });
    const projected = projectInteractionRoute(route);

    expect(projected).toMatchObject({
      mode: AgentInteractionRunModes.ToolAgentLoop,
      objective: "inspect workspace",
      preferredTools: ["WorkspaceReadFile"],
      discoveryQueries: ["workspace read"],
    });

    route.preferredTools.push("WeatherTool");
    route.discoveryQueries.push("weather");
    expect(projected.preferredTools).toEqual(["WorkspaceReadFile"]);
    expect(projected.discoveryQueries).toEqual(["workspace read"]);
  });

  test("router checks abort signals before and after route execution", async () => {
    const controller = new AbortController();
    const router = new AgentInteractionRouter(async () => {
      controller.abort();
      return createRoute();
    });

    await expect(router.route(createActionPlanInput(), { signal: controller.signal })).rejects.toMatchObject({
      name: "AgentCancellationError",
    });
  });

  test("derives runtime routing from the validated initial action without a second model field", () => {
    expect(
      projectPreparedInteractionRoute({
        turnUnderstanding: createPreparation().turnUnderstanding,
        initialAction: {
          kind: "CallTools",
          preface: "Inspecting.",
          calls: [{ toolName: "WorkspaceInspectTool", purpose: "Inspect.", required: true }],
        },
      }),
    ).toMatchObject({
      mode: "tool_agent_loop",
      objective: "check project",
      preferredTools: ["WorkspaceInspectTool"],
      discoveryQueries: [],
    });
    expect(
      projectPreparedInteractionRoute({
        turnUnderstanding: createPreparation().turnUnderstanding,
        initialAction: { kind: "FinalAnswer", answerPlan: ["Answer."] },
      }).mode,
    ).toBe("direct_response");
  });

  test("classifies validation failures as repairable and preserves invalid output for repair", () => {
    const validation = new AgentActionPlannerValidationError(["calls.0.toolName: required"], { calls: [{}] });
    const zodError = z.object({ answer: z.string() }).safeParse({ answer: 1 }).error;

    expect(isRepairablePlanningFailure(validation)).toBe(true);
    expect(isRepairablePlanningFailure(zodError)).toBe(true);
    expect(normalizePlanningFailure(validation).invalidOutput).toEqual({ calls: [{}] });
    expect(issueMessages(zodError)[0]).toContain("answer");
    expect(stringifyIssueValue(validation)).toContain("calls");
    expect(summarizePlannerFailure(validation)).toContain("action_planner_invalid_decision");
  });

  test("recovers tool names from the structured planner failure cause chain", () => {
    const validation = new AgentActionPlannerValidationError(["tool is not active"], {
      initialAction: {
        kind: "CallTools",
        calls: [{ toolName: "ShellCommandTool" }],
      },
    });
    const structured = new AgentBamlStructuredOutputError({
      functionName: "PrepareInteraction",
      attempts: [],
      issues: validation.issues,
      error: validation,
    });
    const routed = new Error("Interaction Router failed.", { cause: structured });

    expect(collectPlannerFailureToolNames(routed)).toEqual(["ShellCommandTool"]);
  });

  test("validates initial actions against candidate tools", () => {
    const input = createActionPlanInput();
    const preparation = createPreparation({
      initialAction: {
        kind: PiControllerActionKind.CallTools,
        preface: "Inspecting the workspace.",
        calls: [
          {
            toolName: "WorkspaceInspectTool",
            purpose: "Inspect the workspace.",
            required: true,
          },
        ],
      },
    });

    expect(parseInteractionPreparation(preparation, input, ["WorkspaceInspectTool"]).initialAction).toMatchObject({
      kind: "CallTools",
      calls: [{ toolName: "WorkspaceInspectTool" }],
    });
    expect(() => parseInteractionPreparation(preparation, input, [])).toThrow(/WorkspaceInspectTool/);
  });
});

function createPreparation(overrides: Partial<InteractionPreparation> = {}): InteractionPreparation {
  return {
    turnUnderstanding: {
      rawUserTurn: "check project",
      standaloneRequest: "check project",
      contextMode: TurnContextMode.None,
      contextBasis: "",
      missingContext: "",
    },
    initialAction: {
      kind: PiControllerActionKind.FinalAnswer,
      answerPlan: ["Answer the request."],
    },
    ...overrides,
  };
}

function createRoute(overrides: Partial<InteractionRoute> = {}): InteractionRoute {
  return {
    mode: InteractionRunMode.ToolAgentLoop,
    objective: "inspect workspace",
    preferredTools: [],
    discoveryQueries: [],
    ...overrides,
  };
}

function createActionPlanInput(): Parameters<AgentInteractionRouter["route"]>[0] {
  return {
    currentUserTurn: {
      content: "check project",
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
  };
}
