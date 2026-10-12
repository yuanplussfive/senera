import { describe, expect, test } from "vitest";
import {
  AgentPiModelResponseBudget,
  AgentModelResponseBudgetError,
} from "../../../Source/AgentSystem/ModelEndpoints/ModelResponseBudget.js";
import { testPiAssistantMessage } from "../Support/AgentPiModelTestStream.js";

describe("Pi response budgets", () => {
  test("checks UTF-8 output increments without serializing shared partial messages", () => {
    const partial = testPiAssistantMessage([{ type: "text", text: "large snapshot" }]);
    Object.defineProperty(partial, "toJSON", {
      value: () => {
        throw new Error("Partial snapshots must not be serialized.");
      },
    });
    const budget = new AgentPiModelResponseBudget({ MaxResponseBytes: 6, MaxSseEventBytes: 100 });
    budget.observe({ type: "text_delta", contentIndex: 0, delta: "中文", partial });
    expect(() => budget.observe({ type: "thinking_delta", contentIndex: 1, delta: "字", partial })).toThrow(
      expect.objectContaining({ limit: "response_bytes", maximum: 6, observed: 9 }),
    );
  });

  test("accepts a terminal message without double counting the same streamed output", () => {
    const message = testPiAssistantMessage([{ type: "text", text: "中文" }]);
    const maximum = Buffer.byteLength(JSON.stringify(message));
    const budget = new AgentPiModelResponseBudget({ MaxResponseBytes: maximum });
    budget.observe({ type: "text_delta", contentIndex: 0, delta: "中文", partial: message });
    expect(() => budget.observe({ type: "done", reason: "stop", message })).not.toThrow();
  });

  test("checks authoritative terminal content when the provider emitted no deltas", () => {
    const message = testPiAssistantMessage([{ type: "text", text: "complete response" }]);
    const budget = new AgentPiModelResponseBudget({ MaxResponseBytes: 10 });
    expect(() => budget.observe({ type: "done", reason: "stop", message })).toThrow(AgentModelResponseBudgetError);
  });
});
