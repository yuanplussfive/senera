import { AgentModelUsageSources } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";
import { AgentPiOuterUsageEstimator } from "../../../Source/AgentSystem/PiProxy/AgentPiOuterUsageEstimator.js";
import { describe, expect, test } from "vitest";

describe("Pi outer usage estimation", () => {
  test("measures the Coding Agent wire context independently from internal BAML calls", () => {
    const usage = new AgentPiOuterUsageEstimator("gpt-5.6").estimate(
      {
        model: "gpt-5.6",
        messages: [
          { role: "system", content: "Use deterministic tools." },
          { role: "user", content: "Add 17 and 25." },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "AddNumbersTool",
              description: "Add two numbers.",
              parameters: { type: "object" },
            },
          },
        ],
      },
      {
        kind: "tool_calls",
        content: "",
        toolCalls: [{ id: "call_add", name: "AddNumbersTool", arguments: { left: 17, right: 25 } }],
      },
    );

    expect(usage.source).toBe(AgentModelUsageSources.LocalEstimate);
    expect(usage.inputTokens).toBeGreaterThan(usage.outputTokens ?? 0);
    expect(usage.totalTokens).toBe((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
    expect(usage.estimatedFields).toEqual(["inputTokens", "outputTokens", "totalTokens"]);
  });
});
