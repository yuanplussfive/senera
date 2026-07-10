import { describe, expect, test } from "vitest";
import { AgentActionPlanner } from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlanner.js";
import { AgentActionPlannerValidationError } from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerSchema.js";
import {
  createActionPlanInput,
  createInteractionRoute,
  createModelProvider,
  createPlannerConfig,
  createTurnUnderstanding,
  FakePlannerClient,
} from "../Support/AgentTestFixtures.js";

describe("ActionPlanner service behavior", () => {
  test("understands once, emits lifecycle stages, and routes with the understood input", async () => {
    const understanding = createTurnUnderstanding();
    const client = new FakePlannerClient(understanding, createInteractionRoute());
    const planner = createPlanner(client);
    const stages: unknown[] = [];

    const result = await planner.routeWithInput({
      input: createActionPlanInput(),
      onStage: (stage) => {
        stages.push(stage);
      },
    });

    expect(result.input.turnUnderstanding).toEqual(understanding);
    expect(result.route).toMatchObject({
      mode: "tool_agent_loop",
      preferredTools: ["WorkspaceReadFile"],
    });
    expect(client.understandInputs).toHaveLength(1);
    expect(client.routeInputs[0]?.turnUnderstanding).toEqual(understanding);
    expect(stages).toEqual([
      { status: "started", stage: "understandUserTurn" },
      { status: "completed", stage: "understandUserTurn", turnUnderstanding: understanding },
    ]);
  });

  test("repairs invalid turn understanding before routing", async () => {
    const invalid = new AgentActionPlannerValidationError(
      ["rawUserTurn: must match input"],
      { rawUserTurn: "wrong" },
    );
    const repaired = createTurnUnderstanding();
    const client = new FakePlannerClient(invalid, createInteractionRoute(), repaired);
    const planner = createPlanner(client);

    const result = await planner.route({ input: createActionPlanInput() });

    expect(result.mode).toBe("tool_agent_loop");
    expect(client.repairs).toHaveLength(1);
    expect(client.repairs[0]?.invalidUnderstanding).toContain("wrong");
    expect(client.routeInputs[0]?.turnUnderstanding).toEqual(repaired);
  });

  test("preserves cancellation and wraps ordinary planner failures", async () => {
    const cancelled = new AbortController();
    cancelled.abort("stop now");
    const planner = createPlanner(new FakePlannerClient(createTurnUnderstanding()));

    await expect(planner.route({ input: createActionPlanInput(), signal: cancelled.signal }))
      .rejects.toMatchObject({ name: "AgentCancellationError" });

    const failing = createPlanner(new FakePlannerClient(new Error("upstream unavailable")));
    await expect(failing.understandTurn({ input: createActionPlanInput() }))
      .rejects.toThrow(/upstream unavailable/);
  });
});

function createPlanner(client: FakePlannerClient): AgentActionPlanner {
  return new AgentActionPlanner(
    createPlannerConfig(),
    createModelProvider(),
    {},
    {
      createClient: () => client,
    },
  );
}
