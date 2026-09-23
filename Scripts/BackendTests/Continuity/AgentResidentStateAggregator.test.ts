import { describe, expect, test } from "vitest";
import {
  addAgentResidentSignal,
  aggregateResidentStateSignals,
  composeAgentResidentStanceSignals,
  EmptyAgentResidentSignalCounts,
} from "../../../Source/AgentSystem/Continuity/AgentResidentSignalAggregator.js";
import {
  AgentToolSuccessOutcome,
  createAgentToolFailureOutcome,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import { AgentExecutionErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";
import type { ExecutedToolCallResult } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import { initialResidentState, nextResidentState } from "../../../Source/AgentSystem/Continuity/AgentResidentState.js";

function executedTool(name: string, args: Record<string, unknown>): ExecutedToolCallResult {
  return {
    callId: `call-${name}`,
    name,
    arguments: args,
    process: { exitCode: null, signal: null, stdout: "", stderr: "" },
    result: null,
    outcome: AgentToolSuccessOutcome,
  };
}

function failedTool(name: string, args: Record<string, unknown>): ExecutedToolCallResult {
  return {
    callId: `call-${name}`,
    name,
    arguments: args,
    process: { exitCode: 1, signal: null, stdout: "", stderr: "boom" },
    result: null,
    outcome: createAgentToolFailureOutcome(
      { code: AgentExecutionErrorCodes.ToolExecutionError, message: "boom" },
      "host",
      "none",
    ),
  };
}

describe("AgentResidentSignalAggregator", () => {
  test("counts tool successes and failures from executed outcomes", () => {
    const signals = aggregateResidentStateSignals({
      bearing: "wry",
      executedTools: [executedTool("weather", {}), failedTool("weather.severe", {})],
    });
    expect(signals.toolSuccessCount).toBe(1);
    expect(signals.toolFailureCount).toBe(1);
    expect(signals.bearing).toBe("wry");
  });

  test("latches the focus object from the first successful tool's arguments", () => {
    const signals = aggregateResidentStateSignals({
      bearing: "direct",
      executedTools: [executedTool("browse", { city: "苏州" }), executedTool("search", { query: "民宿" })],
    });
    expect(signals.focusedObject).toBe("苏州");
  });

  test("leaves focus absent when argc carries no localizable subject", () => {
    const signals = aggregateResidentStateSignals({
      bearing: "direct",
      executedTools: [executedTool("ls", {})],
    });
    expect(signals.focusedObject).toBeUndefined();
  });

  test("defaults to absent sentiment and no task flags when nothing was observed", () => {
    const signals = aggregateResidentStateSignals({ bearing: "gentle", executedTools: [] });
    expect(signals).toMatchObject({
      bearing: "gentle",
      userSentiment: "absent",
      newTaskRequested: false,
      taskConcluded: false,
      toolSuccessCount: 0,
      toolFailureCount: 0,
    });
  });

  test("carries explicit sentiment and task direction through unchanged", () => {
    const signals = aggregateResidentStateSignals({
      bearing: "calm",
      executedTools: [failedTool("write", { path: "note.md" }), failedTool("write", { path: "note.md" })],
      userSentiment: "negative",
      newTaskRequested: false,
      taskConcluded: true,
    });
    expect(signals).toMatchObject({
      userSentiment: "negative",
      taskConcluded: true,
      toolFailureCount: 2,
      toolSuccessCount: 0,
    });
  });

  test("failed outcomes never supply a focus object", () => {
    const signals = aggregateResidentStateSignals({
      bearing: "direct",
      executedTools: [failedTool("browse", { city: "上海" })],
    });
    expect(signals.focusedObject).toBeUndefined();
  });

  test("live accumulation advances the resident mood turn over turn", () => {
    // Mirrors AgentPiTurnState.currentResidentStance: fold outcomes into counts,
    // compose signals, then advance the seed with the pure transition.
    let counts = EmptyAgentResidentSignalCounts;
    counts = addAgentResidentSignal(counts, executedTool("browse", { city: "苏州" }));
    counts = addAgentResidentSignal(counts, executedTool("search", { query: "民宿" }));

    const signals = composeAgentResidentStanceSignals({ bearing: "direct", counts });
    const staged = nextResidentState(initialResidentState(), signals);

    expect(signals).toMatchObject({ toolSuccessCount: 2, toolFailureCount: 0, focusedObject: "苏州" });
    expect(staged.target).toBe("苏州");
    expect(staged.bearing).toBe("direct");
  });

  test("accumulator is order-independent across live updates", () => {
    const interleaved = [
      executedTool("a", { city: "甲" }),
      failedTool("b", {}),
      executedTool("c", { query: "乙" }),
    ].reduce(addAgentResidentSignal, EmptyAgentResidentSignalCounts);
    expect(interleaved).toMatchObject({ toolSuccessCount: 2, toolFailureCount: 1, focusedObject: "甲" });
  });
});
