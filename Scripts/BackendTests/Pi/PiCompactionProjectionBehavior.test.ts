import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, test } from "vitest";
import {
  AgentPiCompactionToolIndexProtocol,
  createAgentPiCompactionToolCallIndex,
  type AgentPiCompactionToolCallEntry,
} from "../../../Source/AgentSystem/Pi/AgentPiCompactionToolIndex.js";
import {
  AgentPiCompactionSummaryFormatter,
  DefaultAgentPiCompactionSummaryFormatterOptions,
} from "../../../Source/AgentSystem/Pi/AgentPiCompactionSummaryFormatter.js";
import { compilePiToolObservation, piToolResultMessage } from "../Support/PiToolObservationFixtures.js";

describe("Pi compaction projection policy", () => {
  test("bounds indexed calls and argument previews independently", () => {
    const messages = toolCallMessages(3, "x".repeat(2_000));
    const index = createAgentPiCompactionToolCallIndex(messages, {
      maxIndexedCalls: 2,
      argumentsPreviewTokenBudget: 4,
    });

    expect(index.totalCalls).toBe(3);
    expect(index.calls.map((call) => call.callId)).toEqual(["call-2", "call-3"]);
    expect(index.calls.every((call) => call.argumentsPreview.length < 2_000)).toBe(true);
  });

  test("limits displayed calls without changing indexed statistics", () => {
    const calls = [toolCallEntry(1), toolCallEntry(2), toolCallEntry(3)];
    const formatter = new AgentPiCompactionSummaryFormatter({
      ...DefaultAgentPiCompactionSummaryFormatterOptions,
      maxDisplayedCalls: 2,
    });
    const formatted = formatter.format({
      summaryText: "Retain the current objective.",
      toolCallIndex: {
        type: AgentPiCompactionToolIndexProtocol.type,
        calls,
        totalCalls: 3,
        successCount: 3,
        failureCount: 0,
        emptyCount: 0,
        evidenceUris: [],
        artifactUris: [],
      },
    });

    expect(formatted.displayedCalls).toBe(2);
    expect(formatted.text).toContain("Total: 3");
    expect(formatted.text).toContain("call-2");
    expect(formatted.text).toContain("call-3");
    expect(formatted.text).not.toContain("call-1");
  });

  test("rejects invalid projection limits", () => {
    expect(() =>
      createAgentPiCompactionToolCallIndex([], {
        maxIndexedCalls: 0,
        argumentsPreviewTokenBudget: 10,
      }),
    ).toThrow("maxIndexedCalls must be a positive integer");
    expect(
      () =>
        new AgentPiCompactionSummaryFormatter({
          ...DefaultAgentPiCompactionSummaryFormatterOptions,
          maxDisplayedCalls: Number.NaN,
        }),
    ).toThrow("maxDisplayedCalls must be a positive integer");
  });
});

function toolCallMessages(count: number, argument: string): AgentMessage[] {
  return Array.from({ length: count }, (_, index) => index + 1).flatMap((position) => [
    {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: `call-${position}`,
          name: "WorkspaceReadFile",
          arguments: { path: argument },
        },
      ],
    } as unknown as AgentMessage,
    piToolResultMessage(
      compilePiToolObservation({
        callId: `call-${position}`,
        toolName: "WorkspaceReadFile",
        summary: `completed ${position}`,
        result: {},
      }),
    ),
  ]);
}

function toolCallEntry(position: number): AgentPiCompactionToolCallEntry {
  return {
    callId: `call-${position}`,
    toolName: "WorkspaceReadFile",
    status: "success",
    argumentsPreview: `path-${position}`,
    summary: `completed ${position}`,
    evidenceUris: [],
  };
}
