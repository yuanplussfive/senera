import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
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
import { buildAgentPiCompactionPromptJson } from "../../../Source/AgentSystem/PiShared/AgentPiCompactionPrompt.js";
import { AgentPiCompactionSummaryBridgeCustomType } from "../../../Source/AgentSystem/Pi/AgentPiCompactionSummaryBridge.js";
import { AgentPiNativeToolBridgeName } from "../../../Source/AgentSystem/Pi/AgentPiNativeToolBridge.js";
import { decodeAgentPromptInputWire } from "../../../Source/AgentSystem/Prompt/AgentPromptContextWireRenderer.js";
import { AgentContinuityLedgerCustomType } from "../../../Source/AgentSystem/Continuity/AgentContinuityLedger.js";
import { createAgentPiContinuityLedger } from "../../../Source/AgentSystem/Pi/AgentPiContinuityLedger.js";

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

  test("indexes a native dynamic bridge call under the real tool identity", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-weather",
            name: AgentPiNativeToolBridgeName,
            arguments: {
              tool: "WeatherTool",
              arguments: { city: "上海" },
            },
          },
        ],
      } as unknown as AgentMessage,
      piToolResultMessage(
        compilePiToolObservation({
          callId: "call-weather",
          toolName: "WeatherTool",
          summary: "上海天气已查询",
          result: {},
        }),
        { toolCallId: "call-weather", toolName: AgentPiNativeToolBridgeName },
      ),
    ];

    const index = createAgentPiCompactionToolCallIndex(messages);

    expect(index.calls).toEqual([
      expect.objectContaining({
        callId: "call-weather",
        toolName: "WeatherTool",
        argumentsPreview: expect.stringContaining("上海"),
      }),
    ]);
  });

  test("uses canonical argument ordering in compaction previews", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-order",
            name: "WorkspaceRead",
            arguments: { z: 2, a: 1 },
          },
        ],
      } as unknown as AgentMessage,
      piToolResultMessage(
        compilePiToolObservation({
          callId: "call-order",
          toolName: "WorkspaceRead",
          summary: "读取完成",
          result: {},
        }),
        { toolCallId: "call-order", toolName: "WorkspaceRead" },
      ),
    ];

    expect(createAgentPiCompactionToolCallIndex(messages).calls[0]?.argumentsPreview).toContain('{"a":1,"z":2}');
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

  test("projects supported Pi compaction message roles without inspecting arbitrary custom payloads", () => {
    const prompt = decodeAgentPromptInputWire(
      buildAgentPiCompactionPromptJson(
        {
          mode: "compact",
          messages: [
            {
              role: "compactionSummary",
              summary: "Earlier durable state.",
              tokensBefore: 2_000,
              timestamp: 1,
            },
            {
              role: "branchSummary",
              summary: "Returned branch state.",
              fromId: "entry-1",
              timestamp: 2,
            },
            {
              role: "custom",
              customType: AgentPiCompactionSummaryBridgeCustomType,
              content: "Senera summary state.",
              display: false,
              timestamp: 3,
            },
            {
              role: "custom",
              customType: "third-party.payload",
              content: "must not be inferred",
              display: false,
              timestamp: 4,
            },
          ],
          artifactIndex: { artifacts: [] },
          toolCallIndex: {
            type: AgentPiCompactionToolIndexProtocol.type,
            calls: [],
            totalCalls: 0,
            successCount: 0,
            failureCount: 0,
            emptyCount: 0,
            evidenceUris: [],
            artifactUris: [],
          },
        },
        { stage: "summarizePiConversation" },
      ),
    ) as { context: { messages: Array<Record<string, unknown>> }; directive: unknown };

    expect(prompt.directive).toEqual({ stage: "summarizePiConversation" });
    expect(prompt.context.messages).toEqual([
      { role: "compactionSummary", summary: "Earlier durable state.", tokensBefore: 2_000 },
      { role: "branchSummary", summary: "Returned branch state.", fromId: "entry-1" },
      { role: "seneraCompactionSummary", content: "Senera summary state." },
    ]);
  });

  test("does not replay an incomplete Artifact-backed payload into the summary request", () => {
    const observation = compilePiToolObservation({
      result: { text: "full result is stored in the artifact" },
    });
    const oversizedObservation = {
      ...observation,
      observation_view: {
        ...observation.observation_view,
        complete: false,
        artifact_uri: "senera://artifact/large-result",
      },
      detail: {
        ...observation.detail,
        result: { text: "payload-".repeat(20_000) },
        arguments: { content: "argument-".repeat(10_000) },
        process: { stdout: "stdout-".repeat(10_000) },
      },
    };
    const prompt = decodeAgentPromptInputWire(
      buildAgentPiCompactionPromptJson(
        {
          mode: "compact",
          messages: [piToolResultMessage(oversizedObservation)],
          artifactIndex: { artifacts: [] },
          toolCallIndex: {
            type: AgentPiCompactionToolIndexProtocol.type,
            calls: [],
            totalCalls: 0,
            successCount: 0,
            failureCount: 0,
            emptyCount: 0,
            evidenceUris: [],
            artifactUris: [],
          },
        },
        { stage: "summarizePiConversation" },
      ),
    ) as { context: { messages: Array<{ observation: { detail: Record<string, unknown> } }> }; directive: unknown };

    const projected = prompt.context.messages[0]?.observation;
    expect(projected.detail.result).toBeUndefined();
    expect(projected.detail.arguments).toBeUndefined();
    expect(projected.detail.process).toBeUndefined();
    expect(JSON.stringify(projected)).not.toContain("payload-payload-");
  });

  test("keeps the current compaction evidence when a previous ledger filled the reference budget", () => {
    const first = createAgentPiContinuityLedger({
      scope: "session-1",
      entries: [],
      messages: Array.from({ length: 300 }, (_, index) => ({
        role: "user",
        content: `historical-${index}`,
      })) as unknown as AgentMessage[],
      artifactIndex: { artifacts: [] },
      toolCallIndex: createAgentPiCompactionToolCallIndex([]),
    });
    const second = createAgentPiContinuityLedger({
      scope: "session-1",
      entries: [
        {
          id: "ledger-1",
          type: "custom",
          customType: AgentContinuityLedgerCustomType,
          data: first,
        } as unknown as SessionEntry,
      ],
      messages: [{ role: "user", content: "current-compaction-evidence" }] as unknown as AgentMessage[],
      artifactIndex: { artifacts: [] },
      toolCallIndex: createAgentPiCompactionToolCallIndex([]),
    });

    expect(second.references.length).toBeLessThanOrEqual(256);
    expect(second.references.some((reference) => reference.summary === "current-compaction-evidence")).toBe(true);
    expect(
      second.checkpoints
        .at(-1)
        ?.referenceIds.every((referenceId) => second.references.some((reference) => reference.id === referenceId)),
    ).toBe(true);
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
      { toolCallId: `call-${position}`, toolName: "WorkspaceReadFile" },
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
