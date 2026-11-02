import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "vitest";
import {
  projectAgentPiWorkspaceToolContext,
  projectAgentPiWorkspaceTurnContext,
  readAgentPiWorkspaceTurnContext,
} from "../../../Source/AgentSystem/Pi/AgentPiWorkspaceContext.js";
import type { AgentPiWorkspaceToolContext } from "../../../Source/AgentSystem/Pi/AgentPiWorkspaceContextTypes.js";
import { AgentPiSessionCustomEntryTypes } from "../../../Source/AgentSystem/Pi/AgentPiSessionEntries.js";
import { renderAgentWorkspaceTurnContextWire } from "../../../Source/AgentSystem/Prompt/AgentWorkspaceTurnContextWire.js";
import { decodeAgentPromptWire } from "../../../Source/AgentSystem/Prompt/AgentPromptWireCodec.js";
import {
  AgentToolResultPresentationProtocol,
  type ExecutedToolCallResult,
  type ToolWorkspaceCaptureResult,
} from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import {
  AgentToolFailureSources,
  AgentToolSuccessOutcome,
  createAgentToolFailureOutcome,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";

function transition(beforeHash: string, afterHash: string, path = "src/example.ts") {
  return {
    path,
    status: "modified" as const,
    beforeKind: "file" as const,
    afterKind: "file" as const,
    beforeHash,
    afterHash,
    beforeSize: 10,
    afterSize: 20,
    addedLines: 2,
    removedLines: 1,
  };
}

function record(
  id: string,
  changes: NonNullable<AgentPiWorkspaceToolContext["capture"]>["changes"],
): AgentPiWorkspaceToolContext {
  return { version: 1, capture: { id, coverage: "exact", changes }, outputs: [] };
}

function startTurn(manager: SessionManager, requestId = "turn") {
  return manager.appendCustomEntry(AgentPiSessionCustomEntryTypes.TurnBoundary, { requestId });
}

function appendResult(manager: SessionManager, workspaceContext: AgentPiWorkspaceToolContext, callId = "call") {
  return manager.appendMessage({
    role: "toolResult",
    toolCallId: callId,
    toolName: "EditFile",
    content: [{ type: "text", text: "bounded observation" }],
    details: {
      senera: {
        toolName: "EditFile",
        callId,
        status: "success",
        executionStatus: "completed",
        outputAvailability: "complete",
        artifactUri: `senera://artifact/${callId}`,
        workspaceContext,
      },
    },
    isError: false,
    timestamp: 0,
  });
}

describe("previous-turn workspace context", () => {
  test("merges verified transitions without inventing net line counts and removes reverted edits", () => {
    const manager = SessionManager.inMemory();
    startTurn(manager);
    appendResult(manager, record("first", [transition("a", "b")]));
    appendResult(manager, record("second", [transition("b", "c")]), "second");
    const merged = projectAgentPiWorkspaceTurnContext(manager.getBranch());
    expect(merged?.changes).toHaveLength(1);
    expect(merged?.changes[0]).toMatchObject({ beforeHash: "a", afterHash: "c", captures: ["first", "second"] });
    expect(merged?.changes[0]).not.toHaveProperty("addedLines");
    appendResult(manager, record("revert", [transition("c", "a")]), "revert");
    expect(projectAgentPiWorkspaceTurnContext(manager.getBranch())?.changes).toEqual([]);
  });

  test("cancels an added file that was deleted in the same turn", () => {
    const manager = SessionManager.inMemory();
    startTurn(manager);
    appendResult(manager, record("add", [{ ...transition("", "a"), beforeKind: "missing", status: "added" }]));
    appendResult(manager, record("remove", [{ ...transition("a", ""), afterKind: "missing", status: "deleted" }]));
    expect(projectAgentPiWorkspaceTurnContext(manager.getBranch())?.changes).toEqual([]);
  });

  test("retains discontinuous versions instead of guessing a net change", () => {
    const manager = SessionManager.inMemory();
    startTurn(manager);
    appendResult(manager, record("first", [transition("a", "b")]));
    appendResult(manager, record("unknown", [transition("", "a")]), "unknown");
    const context = projectAgentPiWorkspaceTurnContext(manager.getBranch());
    expect(context?.changes).toHaveLength(2);
    expect(context?.changes[1]?.continuity).toBe("unverified");
  });

  test("deduplicates observed batch captures and keeps their provenance and partial quality", () => {
    const manager = SessionManager.inMemory();
    startTurn(manager);
    const context = record("batch", [transition("a", "b")]);
    context.capture = {
      ...context.capture!,
      coverage: "observed",
      quality: "bounded",
      scope: { kind: "tool_batch", id: "batch" },
    };
    appendResult(manager, context, "first");
    appendResult(manager, context, "second");
    const snapshot = projectAgentPiWorkspaceTurnContext(manager.getBranch());
    expect(snapshot?.changes).toHaveLength(1);
    expect(snapshot?.captures).toEqual([
      {
        id: "batch",
        coverage: "observed",
        quality: "bounded",
        scope: { kind: "tool_batch", id: "batch" },
        details: ["senera://artifact/first", "senera://artifact/second"],
      },
    ]);
  });

  test("survives compaction and follows the active branch without leaking into an empty next turn", () => {
    const manager = SessionManager.inMemory();
    const olderBoundary = startTurn(manager, "older");
    appendResult(manager, record("older", [transition("a", "b", "older.ts")]));
    startTurn(manager, "latest");
    const leaf = appendResult(manager, record("latest", [transition("a", "b", "latest.ts")]));
    manager.appendCompaction("compressed", null, 1000);
    const readIds: string[] = [];
    const snapshot = readAgentPiWorkspaceTurnContext({
      getLeafId: () => manager.getLeafId(),
      getEntry: (id) => {
        readIds.push(id);
        return manager.getEntry(id);
      },
    });
    expect(snapshot?.changes.map((change) => change.path)).toEqual(["latest.ts"]);
    expect(readIds).not.toContain(olderBoundary);
    expect(projectAgentPiWorkspaceTurnContext(manager.getBranch())?.changes.map((change) => change.path)).toEqual([
      "latest.ts",
    ]);
    startTurn(manager, "empty");
    expect(projectAgentPiWorkspaceTurnContext(manager.getBranch())).toBeUndefined();
    manager.branch(leaf);
    expect(projectAgentPiWorkspaceTurnContext(manager.getBranch())?.changes.map((change) => change.path)).toEqual([
      "latest.ts",
    ]);
  });

  test("marks missing historical metadata as unavailable rather than assuming zero changes", () => {
    const manager = SessionManager.inMemory();
    startTurn(manager);
    manager.appendMessage({
      role: "toolResult",
      toolCallId: "legacy",
      toolName: "EditFile",
      content: [],
      isError: true,
      timestamp: 0,
    });
    expect(projectAgentPiWorkspaceTurnContext(manager.getBranch())?.unavailableResults).toBe(1);
  });

  test("budgets whole rows and keeps omitted counts with usable detail references", () => {
    const manager = SessionManager.inMemory();
    startTurn(manager);
    appendResult(
      manager,
      record(
        "capture",
        Array.from({ length: 20 }, (_, index) => transition("a", "b", `src/file-${index}.ts`)),
      ),
    );
    const context = projectAgentPiWorkspaceTurnContext(manager.getBranch());
    const full = renderAgentWorkspaceTurnContextWire(context, {
      maxTokens: Infinity,
      estimateTokens: (text) => text.length,
    }).text;
    const limit = Math.floor(full.length / 2);
    const bounded = renderAgentWorkspaceTurnContextWire(context, {
      maxTokens: limit,
      estimateTokens: (text) => text.length,
    }).text;
    expect(bounded.length).toBeLessThanOrEqual(limit);
    const payload = decodeAgentPromptWire(bounded).blocks[0]?.value as { omittedFiles: number; files: unknown[] };
    expect(payload.omittedFiles).toBeGreaterThan(0);
    expect(payload.files.length + payload.omittedFiles).toBe(20);
    expect(bounded).toContain("senera://artifact/call");
  });

  test("persists failed-execution captures without file contents, host paths or invented binary line counts", () => {
    const capture: ToolWorkspaceCaptureResult = {
      before: { capturedAt: "before", files: [] },
      after: { capturedAt: "after", files: [] },
      coverage: "exact",
      changes: [
        {
          ...transition("a", "b", "output.png"),
          absolutePath: "E:/workspace/output.png",
          addedLines: undefined,
          removedLines: undefined,
          patch: { status: "skipped" },
        },
      ],
    };
    const result: ExecutedToolCallResult = {
      callId: "failed",
      name: "RenderImage",
      arguments: {},
      process: { exitCode: 1, signal: null, stdout: "", stderr: "failed after writing" },
      result: {},
      outcome: createAgentToolFailureOutcome(
        { message: "failed after writing", code: "ToolExecutionError" },
        AgentToolFailureSources.Host,
        "partial",
      ),
      workspaceCapture: capture,
      presentation: {
        type: AgentToolResultPresentationProtocol.type,
        version: AgentToolResultPresentationProtocol.version,
        status: "failure",
        headline: "failed",
        facts: [],
        evidence: [],
        changes: [],
        resources: [{ uri: "senera://resource/image", name: "output.png", mime: "image/png", origin: "artifact" }],
      },
    };
    const context = projectAgentPiWorkspaceToolContext(result);
    expect(context.capture?.changes[0]).not.toHaveProperty("absolutePath");
    expect(context.capture?.changes[0]?.addedLines).toBeUndefined();
    expect(JSON.stringify(context)).not.toContain("E:/workspace");
    expect(context.outputs[0]?.mime).toBe("image/png");
    const repeated = projectAgentPiWorkspaceToolContext({
      ...result,
      outcome: AgentToolSuccessOutcome,
      workspaceCapture: {
        ...capture,
        changes: capture.changes.map((change) => ({
          ...change,
          patch: { status: "generated", path: "another artifact" },
        })),
      },
    });
    expect(repeated.capture?.id).toBe(context.capture?.id);
  });
});
