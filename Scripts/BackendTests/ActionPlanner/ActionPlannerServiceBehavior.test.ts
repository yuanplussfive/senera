import { describe, expect, test } from "vitest";
import { AgentActionPlanner } from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlanner.js";
import {
  createActionPlanInput,
  createInteractionPreparation,
  createModelProvider,
  createPlannerConfig,
  createTurnUnderstanding,
  FakePlannerClient,
} from "../Support/AgentTestFixtures.js";

describe("ActionPlanner service behavior", () => {
  test("prepares understanding and route in one model call", async () => {
    const understanding = createTurnUnderstanding();
    const preparation = createInteractionPreparation({
      turnUnderstanding: understanding,
    });
    const client = new FakePlannerClient(preparation);
    const planner = createPlanner(client);
    const stages: unknown[] = [];

    const result = await planner.prepareInteraction({
      input: createActionPlanInput(),
      candidateTools: [
        {
          name: "WorkspaceReadFile",
          description: "Read one workspace file.",
          parameters: { type: "object", required: ["path"] },
        },
      ],
      onStage: (stage) => {
        stages.push(stage);
      },
    });

    expect(result.input.turnUnderstanding).toEqual(understanding);
    expect(result.route).toMatchObject({
      mode: "tool_agent_loop",
      preferredTools: ["WorkspaceReadFile"],
    });
    expect(client.preparationInputs).toHaveLength(1);
    expect(client.preparationCandidateTools).toEqual([
      [
        {
          name: "WorkspaceReadFile",
          description: "Read one workspace file.",
          parameters: { type: "object", required: ["path"] },
        },
      ],
    ]);
    expect(result.initialAction).toEqual(preparation.initialAction);
    expect(stages).toEqual([
      { status: "started", stage: "prepareInteraction" },
      { status: "completed", stage: "prepareInteraction", durationMs: expect.any(Number), preparation },
    ]);
  });

  test("preserves cancellation and wraps ordinary planner failures", async () => {
    const cancelled = new AbortController();
    cancelled.abort("stop now");
    const planner = createPlanner(new FakePlannerClient());

    await expect(
      planner.prepareInteraction({ input: createActionPlanInput(), signal: cancelled.signal }),
    ).rejects.toMatchObject({
      name: "AgentCancellationError",
    });

    const failing = createPlanner(new FakePlannerClient(new Error("upstream unavailable")));
    const stages: unknown[] = [];
    await expect(
      failing.prepareInteraction({
        input: createActionPlanInput(),
        onStage: (stage) => {
          stages.push(stage);
        },
      }),
    ).rejects.toThrow(/upstream unavailable/);
    expect(stages).toEqual([
      { status: "started", stage: "prepareInteraction" },
      {
        status: "failed",
        stage: "prepareInteraction",
        durationMs: expect.any(Number),
        message: expect.stringContaining("upstream unavailable"),
      },
    ]);
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
