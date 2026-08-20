import { describe, expect, test, vi } from "vitest";
import {
  AgentPiToolExecutionBridge as AgentPiToolExecutionBridgeBase,
  type AgentPiToolExecutionBridgeOptions,
} from "../../../Source/AgentSystem/Pi/AgentPiToolExecutionBridge.js";
import { AgentPiToolResultStatuses } from "../../../Source/AgentSystem/Pi/AgentPiTypes.js";
import type { ExecutedToolCallResult } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import type { AgentToolObservationProjectionManifest } from "../../../Source/AgentSystem/Types/AgentToolObservationProjectionTypes.js";
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
import { StandardAgentToolObservationProjection } from "../../../Source/AgentSystem/ToolRuntime/AgentToolObservationProjectionPlan.js";

class AgentPiToolExecutionBridge extends AgentPiToolExecutionBridgeBase {
  constructor(options: Omit<AgentPiToolExecutionBridgeOptions, "model">) {
    super({ ...options, model: "test-model" });
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
      tool: registeredTool("AgentSpawn", StandardAgentToolObservationProjection, "SelfManaged"),
      params: {
        task: "Review the change.",
      },
      toolCallId: "call-spawn",
      context: createToolContext("AgentSpawn", "call-spawn"),
    });

    expect(executeToolCall).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
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
        artifactUri: "senera://artifact/1",
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
    expect(textContent(result.content[0])).toContain("senera.tool_observation.v3");
    expect(parseObservation(result)).toMatchObject({
      observation_view: { complete: true, artifact_uri: "senera://artifact/1" },
      detail: { result: { answer: "42" } },
    });
    expect(result.details.senera).toEqual(
      expect.objectContaining({
        toolName: "SearchTool",
        artifactUri: "senera://artifact/1",
        callId: "call-1",
        status: AgentPiToolResultStatuses.Success,
      }),
    );
    expect(JSON.stringify(result)).not.toContain('"executed"');
  });

  test("projects artifact-backed resource output with declarative continuation metadata", async () => {
    const executed = toolResult({
      callId: "call-resource",
      name: "ExecutionResourceInspect",
      result: {
        resourceId: "res_0123456789abcdef0123456789abcdef",
        state: "running",
        cursor: 7,
        events: [{ kind: "output", stream: "stdout", text: "unique-resource-output" }],
      },
      artifact: artifactFixture("resource summary"),
    });
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({ kind: "ToolResults", value: [executed] }),
      recordToolArtifacts: async () => [executed],
    });

    const result = await bridge.execute({
      tool: registeredTool("ExecutionResourceInspect", resourceObservation()),
      params: { resourceId: "res_0123456789abcdef0123456789abcdef" },
      toolCallId: "call-resource",
      context: createToolContext("ExecutionResourceInspect", "call-resource"),
    });

    expect(parseObservation(result)).toMatchObject({
      detail: {
        result: {
          events: [{ text: "unique-resource-output" }],
        },
        continuation: {
          kind: "cursor",
          handle: "res_0123456789abcdef0123456789abcdef",
          cursor: 7,
          state: "running",
          terminal: false,
        },
      },
    });
    expect(parseObservation(result)).not.toHaveProperty("projection");
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
      observation_view: {
        complete: false,
        artifact_uri: "senera://artifact/1",
      },
    });
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
    expect(context.turnState?.takeExecutedToolResult("call-large")).toBe(executed);
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

  test("keeps JSON continuation metadata intact for final batch projection", async () => {
    const page = {
      type: "senera.artifact_json_view.v2",
      source: { ref: "raw", sha256: "a".repeat(64) },
      query: { sourcePath: ["items"], select: ["id", "value"] },
      page: { scanned: 200, returned: 200, complete: false, nextCursor: "cursor-next-page" },
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
                    content: JSON.stringify(page),
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
  });

  test("terminates Pi turn when a tool asks for user input", async () => {
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({
        kind: "AskUser",
        value: {
          question: "哪个文件？",
          reason_code: "missing_path",
        },
      }),
      recordToolArtifacts: vi.fn(),
    });

    const result = await bridge.execute({
      tool: registeredTool("ReadFile"),
      params: {},
      toolCallId: "call-ask",
      context: createToolContext("ReadFile", "call-ask"),
    });

    expect(result.terminate).toBe(true);
    expect(textContent(result.content[0])).toContain("哪个文件");
    expect(parseObservation(result)).toMatchObject({
      status: "waiting",
      observation_view: {
        type: "senera.tool_observation_source_view.v3",
        complete: true,
      },
      detail: {
        summary: "哪个文件？",
        result: {
          question: "哪个文件？",
          reason_code: "missing_path",
        },
      },
    });
    expect(parseObservation(result)).not.toHaveProperty("control");
    expect(result.details.senera).toEqual({
      toolName: "ReadFile",
      status: AgentPiToolResultStatuses.Success,
      executionStatus: "completed",
      outputAvailability: "complete",
    });
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
      tool: registeredTool("FailureTool", fullObservationProjection()),
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
        arguments: { token: "[REDACTED]" },
        outcome: {
          assessment: {
            status: "failure",
            error: {
              code: AgentExecutionErrorCodes.ToolExecutionError,
              message: "[REDACTED]",
              details: { token: "[REDACTED]" },
            },
          },
        },
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
      tool: registeredTool("ShellCommandTool", fullObservationProjection()),
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

function registeredTool(
  name: string,
  observationProjection: AgentToolObservationProjectionManifest = StandardAgentToolObservationProjection,
  scheduling?: "ResourceClaims" | "SelfManaged",
): RegisteredTool {
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
    observationProjection,
    execution: {
      Targets: ["Local"],
      Network: "Deny",
      Workspace: "ReadOnly",
    },
    childGrant: "inherit",
    evidenceCapabilities: [],
  };
}

function resourceObservation(): AgentToolObservationProjectionManifest {
  return {
    ...StandardAgentToolObservationProjection,
    continuation: {
      kind: "cursor",
      handle: "/resourceId",
      cursor: "/cursor",
      state: "/state",
      terminalStates: ["completed", "failed", "cancelled"],
    },
    sources: [
      projectionSource("continuation", "json", "essential", 192),
      ...StandardAgentToolObservationProjection.sources,
    ],
  };
}

function fullObservationProjection(): AgentToolObservationProjectionManifest {
  return {
    ...StandardAgentToolObservationProjection,
    maxTokens: 6_000,
    sources: [
      projectionSource("error", "json", "essential", 1_024),
      projectionSource("process", "json", "high", 1_024),
      projectionSource("arguments", "json", "normal", 1_024),
      projectionSource("outcome", "json", "normal", 1_024),
      ...StandardAgentToolObservationProjection.sources,
    ],
  };
}

function projectionSource(
  source: AgentToolObservationProjectionManifest["sources"][number]["source"],
  mode: AgentToolObservationProjectionManifest["sources"][number]["mode"],
  priority: AgentToolObservationProjectionManifest["sources"][number]["priority"],
  maxTokens: number,
): AgentToolObservationProjectionManifest["sources"][number] {
  return {
    source,
    mode,
    priority,
    requiredForCompletion: true,
    maxTokens,
    limits: {
      maxDepth: 8,
      maxArrayItems: 32,
      maxObjectProperties: 48,
      maxNodes: 384,
    },
  };
}

function artifactFixture(summary: string): NonNullable<ExecutedToolCallResult["artifact"]> {
  return {
    artifactId: "artifact-1",
    artifactUri: "senera://artifact/1",
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
