import { describe, expect, test, vi } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  AgentPiToolExecutionBridge as AgentPiToolExecutionBridgeBase,
  type AgentPiToolExecutionBridgeOptions,
} from "../../../Source/AgentSystem/Pi/AgentPiToolExecutionBridge.js";
import { AgentToolSourceViewInvariantError } from "../../../Source/AgentSystem/Artifacts/AgentToolSourceView.js";
import { AgentPiToolResultStatuses } from "../../../Source/AgentSystem/Pi/AgentPiTypes.js";
import {
  AgentWorkspaceChangeSetProtocol,
  type ExecutedToolCallResult,
  type ToolWorkspaceCaptureResult,
} from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import { AgentExecutionErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";
import { toolAccessGrant } from "../Support/AgentTestFixtures.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import { AgentPiTurnState } from "../../../Source/AgentSystem/Pi/AgentPiTurnState.js";
import { AgentModelUsageLedger } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";
import { AgentPiToolPlanCoordinator } from "../../../Source/AgentSystem/PiShared/AgentPiToolPlanCoordinator.js";
import {
  AgentToolFailureSources,
  AgentToolSuccessOutcome,
  createAgentToolFailureOutcome,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import { readAgentPiMessageTextContent } from "../../../Source/AgentSystem/Pi/AgentPiToolObservation.js";
import type { AgentToolResultObservationCompressor } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultObservationCompressor.js";
import { createTestToolObservationCompressor } from "../Support/PiToolObservationFixtures.js";
import type { AgentWorkspaceChangeObserverPort } from "../../../Source/AgentSystem/Artifacts/AgentWorkspaceChangeObserver.js";

class AgentPiToolExecutionBridge extends AgentPiToolExecutionBridgeBase {
  constructor(
    options: Omit<AgentPiToolExecutionBridgeOptions, "model" | "observationTokenBudget" | "observationCompressor"> & {
      observationCompressor?: AgentToolResultObservationCompressor;
    },
  ) {
    super({
      ...options,
      model: "test-model",
      observationTokenBudget: 2_048,
      observationCompressor: options.observationCompressor ?? createTestToolObservationCompressor(),
    });
  }
}

describe("Pi tool execution bridge behavior", () => {
  test("lets self-managed orchestration tools own child-run scheduling", async () => {
    const executed = toolResult({ callId: "call-spawn", name: "AgentSpawn" });
    const run = vi.fn(async () => {
      throw new Error("The generic resource scheduler must not lease AgentSpawn.");
    });
    const executeToolCall = vi.fn(async () => ({ kind: "ToolResults" as const, value: [executed] }));
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall,
      recordToolArtifacts: async () => [executed],
      executionScheduler: { run } as never,
    });

    await bridge.execute({
      tool: registeredTool("AgentSpawn", "SelfManaged"),
      params: {
        task: "Review the change.",
      },
      toolCallId: "call-spawn",
      context: createToolContext("AgentSpawn", "call-spawn"),
    });

    expect(executeToolCall).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });

  test("unwraps XML-attributed observations before Pi protocol parsing", async () => {
    const executed = toolResult({ callId: "call-attributed", name: "SearchTool" });
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({ kind: "ToolResults", value: [executed] }),
      recordToolArtifacts: async () => [executed],
      attributionEnabled: () => true,
    });

    const result = await bridge.execute({
      tool: registeredTool("SearchTool"),
      params: { query: "attributed" },
      toolCallId: "call-attributed",
      context: createToolContext("SearchTool", "call-attributed"),
    });
    const message = {
      role: "toolResult",
      toolCallId: "call-attributed",
      toolName: "SearchTool",
      content: result.content,
      isError: false,
    } as Extract<AgentMessage, { role: "toolResult" }>;
    const text = readAgentPiMessageTextContent(message);

    expect(() => JSON.parse(text)).not.toThrow();
    expect(JSON.parse(text)).toMatchObject({ type: "senera.tool_observation.v5" });
  });

  test("routes ordinary tools through the execution scheduler", async () => {
    const executed = toolResult({ callId: "call-search", name: "SearchTool" });
    const run = vi.fn(async (_run, _tool, _params, operation: () => Promise<unknown>) => operation());
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({ kind: "ToolResults", value: [executed] }),
      recordToolArtifacts: async () => [executed],
      executionScheduler: { run } as never,
    });

    await bridge.execute({
      tool: registeredTool("SearchTool"),
      params: { query: "resource leases" },
      toolCallId: "call-search",
      context: createToolContext("SearchTool", "call-search"),
    });

    expect(run).toHaveBeenCalledOnce();
  });

  test("publishes one observed workspace batch through the normal Artifact recorder", async () => {
    const executed = toolResult({ callId: "call-observed" });
    const workspaceCapture: ToolWorkspaceCaptureResult = {
      type: AgentWorkspaceChangeSetProtocol.type,
      version: AgentWorkspaceChangeSetProtocol.version,
      source: "filesystem-observer",
      coverage: "observed",
      scope: { kind: "tool_batch", id: "batch-call-observed" },
      before: {
        capturedAt: "2026-09-28T00:00:00.000Z",
        files: [
          {
            path: "generated.txt",
            absolutePath: "/workspace/generated.txt",
            exists: false,
            kind: "missing",
            size: 0,
            mtimeMs: 0,
            hash: "missing",
          },
        ],
      },
      after: {
        capturedAt: "2026-09-28T00:00:00.000Z",
        files: [
          {
            path: "generated.txt",
            absolutePath: "/workspace/generated.txt",
            exists: true,
            kind: "file",
            size: 5,
            mtimeMs: 1,
            hash: "sha256:generated",
            content: { state: "omitted", reason: "size_limit", byteLength: 5 },
          },
        ],
      },
      changes: [
        {
          path: "generated.txt",
          absolutePath: "/workspace/generated.txt",
          status: "added",
          beforeKind: "missing",
          afterKind: "file",
          beforeHash: "missing",
          afterHash: "sha256:generated",
          beforeSize: 0,
          afterSize: 5,
        },
      ],
    };
    const workspaceChangeObserver: AgentWorkspaceChangeObserverPort = {
      beginBatch: vi.fn(async () => undefined),
      completeCall: vi.fn(async () => workspaceCapture),
      skipCall: vi.fn(),
      cancelCall: vi.fn(),
      cancelPendingBatches: vi.fn(),
    };
    const recordToolArtifacts = vi.fn(async ({ results }: { readonly results: readonly ExecutedToolCallResult[] }) => [
      ...results,
    ]);
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({ kind: "ToolResults", value: [executed] }),
      recordToolArtifacts,
    });

    await bridge.execute({
      tool: registeredTool("SearchTool"),
      params: { query: "generate a file" },
      toolCallId: "call-observed",
      context: createToolContext("SearchTool", "call-observed", { workspaceChangeObserver }),
    });

    expect(workspaceChangeObserver.completeCall).toHaveBeenCalledWith("batch-call-observed", "call-observed", []);
    expect(recordToolArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        results: [expect.objectContaining({ workspaceCapture })],
      }),
    );
  });

  test("terminates the child turn at a persisted supervisor-decision boundary", async () => {
    const recordToolArtifacts = vi.fn(async () => []);
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({
        kind: "SuspendChildRun",
        value: {
          childRunId: "child-1",
          messageId: "message-1",
          message: "Select the migration path.",
        },
      }),
      recordToolArtifacts,
    });

    const result = await bridge.execute({
      tool: registeredTool("AgentContactSupervisor"),
      params: { reason: "need_decision", message: "Select the migration path." },
      toolCallId: "call-supervisor",
      context: createToolContext("AgentContactSupervisor", "call-supervisor"),
    });

    expect(result.terminate).toBe(true);
    expect(parseObservation(result)).toMatchObject({
      status: "waiting",
      detail: {
        result: {
          childRunId: "child-1",
          messageId: "message-1",
          message: "Select the migration path.",
        },
      },
    });
    expect(recordToolArtifacts).not.toHaveBeenCalled();
  });

  test("executes visible tool calls with Pi context and records artifacts before projection", async () => {
    const executed = toolResult({
      result: { answer: "42" },
      artifact: {
        artifactId: "artifact-1",
        artifactUri: "senera://artifact/art_0123456789abcdef01234567",
        artifactPath: "/tmp/artifact",
        relativePath: "artifact.json",
        manifestPath: "/tmp/artifact/manifest.json",
        files: {},
        summary: "answer summary",
        evidence: [],
        delta: [],
      },
    });
    const executeToolCall = vi.fn(async () => ({
      kind: "ToolResults" as const,
      value: [toolResult({ result: { unrecorded: true } })],
    }));
    const recordToolArtifacts = vi.fn(async () => [executed]);
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall,
      recordToolArtifacts,
    });

    const result = await bridge.execute({
      tool: registeredTool("SearchTool"),
      params: { query: "answer" },
      toolCallId: "call-1",
      context: createToolContext("SearchTool", "call-1", {
        requestId: "request-1",
        step: 3,
        preferred: true,
        thinkingLevel: "high",
      }),
    });

    expect(executeToolCall).toHaveBeenCalledWith(
      {
        name: "SearchTool",
        arguments: { query: "answer" },
        expectedContractDigest: null,
        callId: "call-1",
        index: 0,
      },
      expect.objectContaining({
        requestId: "request-1",
        step: 3,
        toolAccessGrant: toolAccessGrant(["SearchTool"], ["SearchTool"]),
        thinkingLevel: "high",
      }),
    );
    expect(recordToolArtifacts).toHaveBeenCalledWith({
      requestId: "request-1",
      step: 3,
      results: [expect.objectContaining({ result: { unrecorded: true } })],
    });
    expect(textContent(result.content[0])).toContain("senera.tool_observation.v5");
    expect(parseObservation(result)).toMatchObject({
      detail: { result: { answer: "42" } },
    });
    expect(parseObservation(result).observation_view).toBeUndefined();
    expect(result.details.senera).toEqual(
      expect.objectContaining({
        toolName: "SearchTool",
        artifactUri: "senera://artifact/art_0123456789abcdef01234567",
        callId: "call-1",
        status: AgentPiToolResultStatuses.Success,
      }),
    );
    expect(JSON.stringify(result)).not.toContain('"executed"');
  });

  test("keeps structured resource state in the shared observation", async () => {
    const executed = toolResult({
      callId: "call-resource",
      name: "ExecutionResourceInspect",
      result: {
        resourceId: "res_0123456789abcdef0123456789abcdef",
        state: "running",
        cursor: 7,
        updates: [{ kind: "output", stream: "stdout", text: "unique-resource-output" }],
      },
      artifact: artifactFixture("resource summary"),
    });
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({ kind: "ToolResults", value: [executed] }),
      recordToolArtifacts: async () => [executed],
    });

    const result = await bridge.execute({
      tool: registeredTool("ExecutionResourceInspect"),
      params: { resourceId: "res_0123456789abcdef0123456789abcdef" },
      toolCallId: "call-resource",
      context: createToolContext("ExecutionResourceInspect", "call-resource"),
    });

    expect(parseObservation(result)).toMatchObject({
      detail: {
        result: {
          updates: [{ text: "unique-resource-output" }],
        },
      },
    });
  });

  test("stores the complete result outside Pi history and emits an artifact-backed bounded view", async () => {
    const hugeText = "large-result\n".repeat(200_000);
    const executed = toolResult({
      callId: "call-large",
      name: "LargeResultTool",
      result: { text: hugeText },
      artifact: artifactFixture("large result"),
    });
    const tokenBudget = new AgentTurnTokenBudget({
      model: "test-model",
      contextWindowTokens: 8_192,
      outputReserveTokens: 2_048,
    });
    const context = createToolContext("LargeResultTool", "call-large", {
      requestId: "request-large",
      tokenBudget,
    });
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({ kind: "ToolResults", value: [executed] }),
      recordToolArtifacts: async () => [executed],
    });

    const result = await bridge.execute({
      tool: registeredTool("LargeResultTool"),
      params: {},
      toolCallId: "call-large",
      context,
    });

    const observation = parseObservation(result);
    expect(observation).toMatchObject({
      artifact_uri: "senera://artifact/art_0123456789abcdef01234567",
      observation_view: {
        complete: false,
      },
    });
    expect((observation.observation_view as Record<string, unknown> | undefined)?.artifact_uri).toBeUndefined();
    expect(JSON.stringify(observation)).not.toContain(hugeText);
    expect(textContent(result.content[0]).length).toBeLessThan(20_000);
    expect(result.details.senera).toEqual({
      toolName: "LargeResultTool",
      artifactUri: executed.artifact?.artifactUri,
      callId: executed.callId,
      status: AgentPiToolResultStatuses.Success,
      executionStatus: "completed",
      outputAvailability: "complete",
    });
    expect(context.turnState?.takeExecutedToolResult("call-large")).toMatchObject({
      result: {
        type: "senera.artifact_backed_tool_result.v1",
        artifactUri: "senera://artifact/art_0123456789abcdef01234567",
      },
    });
    expect(context.turnState?.takeExecutedToolResult("call-large")).toBeUndefined();
  });

  test("keeps hydrated artifact content visible while applying artifact redaction", async () => {
    const executed = toolResult({
      callId: "call-memory",
      name: "ArtifactMemoryReadTool",
      result: {
        artifacts: {
          item: [
            {
              artifactUri: "senera://artifact/art_0123456789abcdef01234567",
              memories: {
                item: [{ ref: "raw", content: "unique-hydrated-content", truncated: false }],
              },
            },
          ],
        },
        apiToken: "must-not-reach-model",
      },
      artifactPolicy: {
        Redact: { Keys: ["token"] },
      },
      artifact: artifactFixture("memory summary"),
    });
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({ kind: "ToolResults", value: [executed] }),
      recordToolArtifacts: async () => [executed],
    });

    const result = await bridge.execute({
      tool: registeredTool("ArtifactMemoryReadTool"),
      params: {},
      toolCallId: "call-memory",
      context: createToolContext("ArtifactMemoryReadTool", "call-memory"),
    });

    const observation = parseObservation(result);
    expect(JSON.stringify(observation.detail)).toContain("unique-hydrated-content");
    expect(observation.detail).toMatchObject({ result: { apiToken: "[REDACTED]" } });
    expect(JSON.stringify(observation)).not.toContain("must-not-reach-model");
  });

  test("keeps a source-view page visible now while retaining only its original coordinates in history", async () => {
    const sourceUri = "senera://artifact/art_0123456789abcdef01234567";
    const executed = toolResult({
      callId: "call-source-view",
      name: "ArtifactMemoryReadTool",
      resultStorage: "SourceView",
      sourceArtifacts: [{ artifactUri: sourceUri, refs: ["raw"] }],
      result: {
        artifacts: {
          item: [
            {
              artifactUri: sourceUri,
              memories: { item: [{ ref: "raw", content: "visible-source-page" }] },
            },
          ],
        },
      },
    });
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({ kind: "ToolResults", value: [executed] }),
      recordToolArtifacts: async () => [executed],
    });
    const context = createToolContext("ArtifactMemoryReadTool", "call-source-view");

    const result = await bridge.execute({
      tool: {
        ...registeredTool("ArtifactMemoryReadTool"),
        runtime: { ...registeredTool("ArtifactMemoryReadTool").runtime, ResultStorage: "SourceView" },
      },
      params: {},
      toolCallId: "call-source-view",
      context,
    });

    const observation = parseObservation(result);
    expect(observation).toMatchObject({
      source_artifacts: [{ artifact_uri: sourceUri, refs: ["raw"] }],
      detail: {
        result: { artifacts: { item: [{ memories: { item: [{ content: "visible-source-page" }] } }] } },
      },
    });
    expect(context.turnState?.takeExecutedToolResult("call-source-view")).toMatchObject({
      result: {
        type: "senera.source_view_tool_result.v1",
        sourceArtifacts: [{ artifactUri: sourceUri, refs: ["raw"] }],
      },
    });
  });

  test("surfaces a source-view contract violation as a tool failure instead of an unreadable success", async () => {
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({ kind: "ToolResults", value: [toolResult({ name: "ArtifactMemoryReadTool" })] }),
      recordToolArtifacts: async () => {
        throw new AgentToolSourceViewInvariantError(
          "ArtifactMemoryReadTool",
          "completed without a canonical source Artifact reference",
        );
      },
    });

    const result = await bridge.execute({
      tool: {
        ...registeredTool("ArtifactMemoryReadTool"),
        runtime: { ...registeredTool("ArtifactMemoryReadTool").runtime, ResultStorage: "SourceView" },
      },
      params: {},
      toolCallId: "call-invalid-source-view",
      context: createToolContext("ArtifactMemoryReadTool", "call-invalid-source-view"),
    });

    expect(parseObservation(result)).toMatchObject({
      status: "failure",
      error: { message: expect.stringContaining("completed without a canonical source Artifact reference") },
    });
  });

  test("keeps JSON continuation metadata intact for final batch projection", async () => {
    const page = {
      type: "senera.artifact_json_view.v2",
      source: { ref: "raw", sha256: "a".repeat(64) },
      query: { sourcePath: ["items"], select: ["id", "value"] },
      page: { scanned: 200, returned: 200, complete: false, nextCursor: "cursor-next-page" },
      marker: "structured-page-emitted-once",
      items: Array.from({ length: 200 }, (_, id) => ({ id, value: `value-${id}-${"x".repeat(100)}` })),
    };
    const executed = toolResult({
      callId: "call-query-page",
      name: "ArtifactMemoryReadTool",
      result: {
        artifacts: {
          item: [
            {
              artifactUri: "senera://artifact/art_0123456789abcdef01234567",
              memories: {
                item: [
                  {
                    ref: "raw",
                    view: { kind: "json_query", complete: false, nextCursor: "cursor-next-page" },
                    structuredContent: page,
                  },
                ],
              },
            },
          ],
        },
      },
      artifact: artifactFixture("query page"),
    });
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({ kind: "ToolResults", value: [executed] }),
      recordToolArtifacts: async () => [executed],
      observationCompressor: createTestToolObservationCompressor({
        summarize: async () => "Continuation cursor cursor-next-page; marker structured-page-emitted-once.",
      }),
    });
    const tokenBudget = new AgentTurnTokenBudget({
      model: "test-model",
      contextWindowTokens: 4_096,
      outputReserveTokens: 1_024,
    });

    const result = await bridge.execute({
      tool: registeredTool("ArtifactMemoryReadTool"),
      params: {},
      toolCallId: "call-query-page",
      context: createToolContext("ArtifactMemoryReadTool", "call-query-page", { tokenBudget }),
    });
    const text = textContent(result.content[0]);

    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).toContain("cursor-next-page");
    expect(text.match(/structured-page-emitted-once/g)?.length).toBe(1);
    expect(text).not.toContain('"content":"{\\"type\\"');
  });

  test("returns structured tool failures so Pi can preserve diagnostics and mark execution failed", async () => {
    const error = {
      code: AgentExecutionErrorCodes.ToolExecutionError,
      message: "Skill validation failed.",
      diagnostics: [
        {
          code: "skill.frontmatter.invalid",
          message: "Skill name must match its directory",
          filePath: "E:/workspace/.senera/skills/json-field-pick/SKILL.md",
          pointer: "/name",
          position: { line: 18, column: 15, position: 420 },
          frame: { startLine: 17, endLine: 19, text: "18 |       Name: JsonPickTool\n   |             ^" },
        },
      ],
    };
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({
        kind: "ToolResults",
        value: [
          toolResult({
            callId: "call-error",
            name: "SkillManage",
            result: { error },
            outcome: createAgentToolFailureOutcome(error, AgentToolFailureSources.Host, "none"),
          }),
        ],
      }),
      recordToolArtifacts: async (input) => [...input.results],
    });

    const result = await bridge.execute({
      tool: registeredTool("SkillManage"),
      params: { action: "publish", name: "json-field-pick" },
      toolCallId: "call-error",
      context: createToolContext("SkillManage", "call-error"),
    });

    expect(parseObservation(result)).toMatchObject({
      status: "failure",
      error: {
        code: AgentExecutionErrorCodes.ToolExecutionError,
        message: "Skill validation failed.",
      },
      detail: {
        result: {
          error: {
            diagnostics: [
              expect.objectContaining({
                code: "skill.frontmatter.invalid",
                pointer: "/name",
                position: { line: 18, column: 15, position: 420 },
              }),
            ],
          },
        },
      },
    });
    expect(result.details.senera).toMatchObject({
      toolName: "SkillManage",
      callId: "call-error",
      artifactUri: undefined,
      status: AgentPiToolResultStatuses.Failure,
      error,
    });
  });

  test("redacts arguments, process output, and failures before projecting them to Pi", async () => {
    const secret = "secret-value";
    const error = {
      code: AgentExecutionErrorCodes.ToolExecutionError,
      message: secret,
      details: { token: secret },
    };
    const executed = toolResult({
      callId: "call-redacted-failure",
      name: "FailureTool",
      arguments: { token: secret },
      process: { exitCode: 1, signal: null, stdout: "public output", stderr: secret },
      result: { error },
      outcome: createAgentToolFailureOutcome(error, AgentToolFailureSources.Host, "partial"),
      artifactPolicy: {
        Redact: {
          Keys: ["token"],
          Paths: ["$.error.message"],
          Streams: ["stderr"],
        },
      },
    });
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({ kind: "ToolResults", value: [executed] }),
      recordToolArtifacts: async () => [executed],
    });

    const result = await bridge.execute({
      tool: registeredTool("FailureTool"),
      params: {},
      toolCallId: "call-redacted-failure",
      context: createToolContext("FailureTool", "call-redacted-failure"),
    });
    const observation = parseObservation(result);

    expect(observation).toMatchObject({
      status: "failure",
      error: {
        code: AgentExecutionErrorCodes.ToolExecutionError,
        message: "[REDACTED]",
      },
      detail: {
        process: {
          exitCode: 1,
          stdout: "public output",
          stderr: "[REDACTED]",
        },
        result: {
          error: {
            code: AgentExecutionErrorCodes.ToolExecutionError,
            message: "[REDACTED]",
            details: { token: "[REDACTED]" },
          },
        },
      },
    });
    expect(result.details.senera).toMatchObject({
      status: AgentPiToolResultStatuses.Failure,
      error: {
        message: "[REDACTED]",
        details: { token: "[REDACTED]" },
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  test("preserves a canonical process-exit failure in the Pi observation", async () => {
    const error = {
      code: AgentExecutionErrorCodes.ToolProcessExited,
      message: "Tool process failed: exit code 5",
      details: { exitCode: 5 },
    };
    const executed = toolResult({
      callId: "call-process-failure",
      name: "ShellCommandTool",
      process: { exitCode: 5, signal: null, stdout: "partial output", stderr: "command failed" },
      result: { error },
      outcome: createAgentToolFailureOutcome(error, AgentToolFailureSources.Process, "partial"),
    });
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({ kind: "ToolResults", value: [executed] }),
      recordToolArtifacts: async () => [executed],
    });

    const result = await bridge.execute({
      tool: registeredTool("ShellCommandTool"),
      params: {},
      toolCallId: "call-process-failure",
      context: createToolContext("ShellCommandTool", "call-process-failure"),
    });

    expect(parseObservation(result)).toMatchObject({
      status: "failure",
      error: {
        code: AgentExecutionErrorCodes.ToolProcessExited,
        kind: "process_exit",
        source: "process",
        retryable: false,
      },
      detail: {
        process: {
          exitCode: 5,
          stdout: "partial output",
          stderr: "command failed",
        },
        result: { error },
      },
    });
    expect(result.details.senera).toMatchObject({
      status: AgentPiToolResultStatuses.Failure,
      error: { code: AgentExecutionErrorCodes.ToolProcessExited },
    });
  });
});

function toolResult(overrides: Partial<ExecutedToolCallResult> = {}): ExecutedToolCallResult {
  return {
    callId: "call-1",
    name: "SearchTool",
    arguments: { query: "answer" },
    process: {
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
    },
    result: { ok: true },
    outcome: AgentToolSuccessOutcome,
    ...overrides,
  };
}

function registeredTool(name: string, scheduling?: "ResourceClaims" | "SelfManaged"): RegisteredTool {
  return {
    owner: {
      kind: "system",
      name: `${name}-owner`,
      title: name,
      rootPath: process.cwd(),
      revision: "test",
      trusted: true,
      requiresApproval: false,
    },
    loading: "Dynamic",
    name,
    permissions: [],
    sources: [],
    handler: { kind: "HostCapability", capability: name },
    runtime: {
      Lifecycle: "Immediate",
      ProtocolVersion: 2,
      ResultAssessment: "ProcessExit",
      ...(scheduling ? { Scheduling: scheduling } : {}),
      Capabilities: { Cancellation: true },
    },
    execution: {
      Targets: ["Local"],
      Network: "Deny",
      Workspace: "ReadOnly",
    },
    childGrant: "inherit",
    evidenceCapabilities: [],
  };
}

function artifactFixture(summary: string): NonNullable<ExecutedToolCallResult["artifact"]> {
  return {
    artifactId: "artifact-1",
    artifactUri: "senera://artifact/art_0123456789abcdef01234567",
    artifactPath: "/tmp/artifact",
    relativePath: "artifact.json",
    manifestPath: "/tmp/artifact/manifest.json",
    files: {},
    summary,
    projection: "metadata-only-projection",
    evidence: [],
    delta: [],
  };
}

function parseObservation(result: Awaited<ReturnType<AgentPiToolExecutionBridge["execute"]>>): Record<string, unknown> {
  return JSON.parse(textContent(result.content[0])) as Record<string, unknown>;
}

function textContent(content: unknown): string {
  return content && typeof content === "object" && "type" in content && content.type === "text" && "text" in content
    ? String(content.text)
    : "";
}

function createToolContext(
  toolName: string,
  callId: string,
  options: {
    requestId?: string;
    step?: number;
    preferred?: boolean;
    tokenBudget?: AgentTurnTokenBudget;
    thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
    workspaceChangeObserver?: AgentWorkspaceChangeObserverPort;
  } = {},
) {
  const grant = toolAccessGrant([toolName], options.preferred ? [toolName] : []);
  const tokenBudget =
    options.tokenBudget ??
    new AgentTurnTokenBudget({
      model: "test-model",
      contextWindowTokens: 128_000,
      outputReserveTokens: 8_192,
    });
  const turnState = new AgentPiTurnState({
    systemPrompt: "Test agent system context.",
    userMessage: `Test request for ${toolName}.`,
    approvalMode: "agent",
    requestId: options.requestId ?? `request-${callId}`,
    step: options.step ?? 1,
    toolAccessGrant: grant,
    toolExposure: new AgentToolExposureState(grant),
    activeSkills: [],
    usageLedger: new AgentModelUsageLedger(),
    toolPlan: new AgentPiToolPlanCoordinator(),
    tokenBudget,
    thinkingLevel: options.thinkingLevel,
    workspaceChangeObserver: options.workspaceChangeObserver,
  });
  turnState.registerToolBatch(`batch-${callId}`, [{ toolCallId: callId, toolName, input: {} }]);
  return {
    requestId: options.requestId,
    step: options.step,
    toolAccessGrant: grant,
    toolExposure: turnState.context.toolExposure,
    turnState,
    tokenBudget,
    thinkingLevel: options.thinkingLevel,
  };
}
