import { describe, expect, test, vi } from "vitest";
import { GoalMicroLoopDecisionKind } from "../../../Source/AgentSystem/BamlClient/baml_client/types.js";
import { AgentGoalMicroLoopModelDecisionPort } from "../../../Source/AgentSystem/Agenda/AgentGoalMicroLoopModelDecisionPort.js";
import type { AgentGoalMicroLoopDecisionInput } from "../../../Source/AgentSystem/Agenda/AgentGoalMicroLoopRuntime.js";
import { AgentGoalMicroLoopDecisionKinds } from "../../../Source/AgentSystem/Agenda/AgentGoalMicroLoopRuntime.js";

describe("Goal micro-loop model decision port", () => {
  test("maps the generated BAML decision vocabulary to host transitions", async () => {
    const input = {} as AgentGoalMicroLoopDecisionInput;
    const client = {
      decideGoalMicroLoop: vi.fn().mockResolvedValue([
        {
          goalId: "goal-1",
          triggerKey: "trigger-1",
          kind: GoalMicroLoopDecisionKind.Wait,
          reason: "等待可验证进展",
          nextReviewAt: "2026-09-01T00:00:00Z",
          progress: null,
          blockedReason: null,
        },
      ]),
    };
    const port = new AgentGoalMicroLoopModelDecisionPort({
      client: client as never,
      invocation: { cache: { scope: "goal", retention: "long" } },
    });

    await expect(port.decide(input)).resolves.toEqual([
      {
        goalId: "goal-1",
        triggerKey: "trigger-1",
        kind: AgentGoalMicroLoopDecisionKinds.Wait,
        reason: "等待可验证进展",
        nextReviewAt: "2026-09-01T00:00:00Z",
      },
    ]);
    expect(client.decideGoalMicroLoop).toHaveBeenCalledWith(input, {
      cache: { scope: "goal", retention: "long" },
    });
  });
});
