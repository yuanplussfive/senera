import { describe, expect, test } from "vitest";
import { z } from "zod";
import { InteractionRunMode, type InteractionRoute } from "../../../Source/AgentSystem/BamlClient/baml_client/types.js";
import {
  AgentInteractionRunModes,
  AgentInteractionRouter,
  projectInteractionRoute,
} from "../../../Source/AgentSystem/ActionPlanner/AgentInteractionRouter.js";
import {
  issueMessages,
  isRepairablePlanningFailure,
  normalizePlanningFailure,
  stringifyIssueValue,
  summarizePlannerFailure,
} from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerFailure.js";
import { AgentActionPlannerValidationError } from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerSchema.js";

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
      needsFreshEvidence: true,
      needsWorkspaceRead: true,
      needsSideEffect: false,
      risk: "low",
      preferredTools: ["WorkspaceReadFile"],
      discoveryQueries: ["workspace read"],
      reason: "needs current project evidence",
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
});

function createRoute(overrides: Partial<InteractionRoute> = {}): InteractionRoute {
  return {
    mode: InteractionRunMode.ToolAgentLoop,
    objective: "inspect workspace",
    needsFreshEvidence: true,
    needsWorkspaceRead: true,
    needsSideEffect: false,
    risk: "low",
    preferredTools: [],
    discoveryQueries: [],
    reason: "needs current project evidence",
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
