import { describe, expect, test, vi } from "vitest";
import { AgentModelUsageLedger } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";
import type { AgentPiToolCallPreflightInput } from "../../../Source/AgentSystem/Pi/AgentPiToolCallPreflight.js";
import { AgentPiTurnState } from "../../../Source/AgentSystem/Pi/AgentPiTurnState.js";
import { AgentPiToolPlanCoordinator } from "../../../Source/AgentSystem/PiShared/AgentPiToolPlanCoordinator.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";

describe("Pi tool-call batch preflight", () => {
  test("starts one bounded preflight set and reuses each call result", async () => {
    const turnState = createTurnState();
    const calls = [toolCall("call-a"), toolCall("call-b"), toolCall("call-c")];
    turnState.registerToolBatch("batch-a", calls);
    const releases = new Map<string, () => void>();
    const started: string[] = [];
    const preflight = vi.fn(async (call: AgentPiToolCallPreflightInput) => {
      started.push(call.toolCallId);
      await new Promise<void>((resolve) => releases.set(call.toolCallId, resolve));
      return { block: false };
    });

    const first = turnState.preflightToolCall(calls[0]!, 2, preflight);
    expect(started).toEqual(["call-a", "call-b"]);

    releases.get("call-a")?.();
    await first;
    await vi.waitFor(() => expect(started).toEqual(["call-a", "call-b", "call-c"]));

    const second = turnState.preflightToolCall(calls[1]!, 2, preflight);
    releases.get("call-b")?.();
    await expect(second).resolves.toEqual({ block: false });
    releases.get("call-c")?.();
    expect(preflight).toHaveBeenCalledTimes(3);
    expect(turnState.toolBatchId("call-b")).toBe("batch-a");
    expect(turnState.toolBatchIndex("call-c")).toBe(2);
  });

  test("rejects duplicate call ids across provider batches", () => {
    const turnState = createTurnState();
    turnState.registerToolBatch("batch-a", [toolCall("call-a")]);

    expect(() => turnState.registerToolBatch("batch-b", [toolCall("call-a")])).toThrow(
      "already registered for preflight",
    );
  });
});

function createTurnState(): AgentPiTurnState {
  const grant = createAgentToolAccessGrant({
    authorizedToolNames: ["TestTool"],
    exposedToolNames: ["TestTool"],
  });
  return new AgentPiTurnState({
    approvalMode: "agent",
    requestId: "request-preflight",
    step: 1,
    toolAccessGrant: grant,
    toolExposure: new AgentToolExposureState(grant),
    activeSkills: [],
    usageLedger: new AgentModelUsageLedger(),
    toolPlan: new AgentPiToolPlanCoordinator(),
    tokenBudget: new AgentTurnTokenBudget({
      model: "test-model",
      contextWindowTokens: 16_384,
      outputReserveTokens: 1_024,
    }),
  });
}

function toolCall(toolCallId: string): AgentPiToolCallPreflightInput {
  return { toolCallId, toolName: "TestTool", input: { value: toolCallId } };
}
