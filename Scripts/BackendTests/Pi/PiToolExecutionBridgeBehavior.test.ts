import { describe, expect, test, vi } from "vitest";
import {
  AgentPiToolExecutionBridge as AgentPiToolExecutionBridgeBase,
  type AgentPiToolExecutionBridgeOptions,
} from "../../../Source/AgentSystem/Pi/AgentPiToolExecutionBridge.js";
import { AgentPiToolResultStatuses } from "../../../Source/AgentSystem/Pi/AgentPiTypes.js";
import type { ExecutedToolCallResult } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import type { AgentToolObservationProjectionManifest } from "../../../Source/AgentSystem/Types/AgentToolObservationProjectionTypes.js";
import { AgentPiTurnContextRegistry } from "../../../Source/AgentSystem/PiShared/AgentPiTurnContext.js";
import { AgentExecutionErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";
import { toolAccessGrant } from "../Support/AgentTestFixtures.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import {
  AgentToolFailureSources,
  AgentToolSuccessOutcome,
  createAgentToolFailureOutcome,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import { StandardAgentToolObservationProjection } from "../../../Source/AgentSystem/ToolRuntime/AgentToolObservationProjectionPlan.js";

const turnContexts = new AgentPiTurnContextRegistry();

class AgentPiToolExecutionBridge extends AgentPiToolExecutionBridgeBase {
  constructor(options: Omit<AgentPiToolExecutionBridgeOptions, "model" | "turnContexts">) {
    super({ ...options, model: "test-model", turnContexts });
  }
}

describe("Pi tool execution bridge behavior", () => {
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
      context: {
        toolAccessGrant: toolAccessGrant(["SearchTool"], ["SearchTool"]),
        requestId: "request-1",
        step: 3,
      },
    });

    expect(executeToolCall).toHaveBeenCalledWith(
      {
        name: "SearchTool",
        arguments: { query: "answer" },
        expectedContractDigest: null,
        callId: "call-1",
      },
      expect.objectContaining({
        requestId: "request-1",
        step: 3,
        toolAccessGrant: toolAccessGrant(["SearchTool"], ["SearchTool"]),
      }),
    );
    expect(recordToolArtifacts).toHaveBeenCalledWith({
      requestId: "request-1",
      step: 3,
      results: [expect.objectContaining({ result: { unrecorded: true } })],
    });
    expect(textContent(result.content[0])).toContain("senera.tool_observation.v1");
    expect(parseObservation(result)).toMatchObject({
      artifact_uri: "senera://artifact/1",
      detail: { result: { answer: "42" } },
      observation_view: { complete: true },
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
      context: { toolAccessGrant: toolAccessGrant(["ExecutionResourceInspect"]) },
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
      result: { text: hugeText },
      artifact: artifactFixture("large result"),
    });
    const accessGrant = toolAccessGrant(["LargeResultTool"]);
    const contextId = turnContexts.register({
      requestId: "request-large",
      toolAccessGrant: accessGrant,
      toolExposure: new AgentToolExposureState(accessGrant),
    });
    try {
      const bridge = new AgentPiToolExecutionBridge({
        executeToolCall: async () => ({ kind: "ToolResults", value: [executed] }),
        recordToolArtifacts: async () => [executed],
      });

      const result = await bridge.execute({
        tool: registeredTool("LargeResultTool"),
        params: {},
        toolCallId: "call-large",
        context: {
          toolAccessGrant: accessGrant,
          piTurnContextId: contextId,
          tokenBudget: new AgentTurnTokenBudget({
            model: "test-model",
            contextWindowTokens: 8_192,
            outputReserveTokens: 2_048,
          }),
        },
      });

      const observation = parseObservation(result);
      expect(observation).toMatchObject({
        artifact_uri: "senera://artifact/1",
        observation_view: {
          complete: false,
          artifact_fallback: { strategy: "reference", available: true },
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
      expect(turnContexts.takeExecutedToolResult(contextId, "call-large")).toBe(executed);
      expect(turnContexts.takeExecutedToolResult(contextId, "call-large")).toBeUndefined();
    } finally {
      turnContexts.release(contextId);
    }
  });

  test("keeps hydrated artifact content visible while applying artifact redaction", async () => {
    const executed = toolResult({
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
      context: { toolAccessGrant: toolAccessGrant(["ArtifactMemoryReadTool"]) },
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
      context: { toolAccessGrant: toolAccessGrant(["ArtifactMemoryReadTool"]), tokenBudget },
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
      context: { toolAccessGrant: toolAccessGrant(["ReadFile"]) },
    });

    expect(result.terminate).toBe(true);
    expect(textContent(result.content[0])).toContain("哪个文件");
    expect(parseObservation(result)).toMatchObject({
      call_id: "call-ask",
      batch_id: expect.any(String),
      status: "waiting",
      observation_view: {
        type: "senera.tool_observation_source_view.v1",
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
      context: { toolAccessGrant: toolAccessGrant(["SkillManage"]) },
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
      callId: "call-1",
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
      context: { toolAccessGrant: toolAccessGrant(["FailureTool"]) },
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
      context: { toolAccessGrant: toolAccessGrant(["ShellCommandTool"]) },
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

  test("rejects an impossible execution batch without a result", async () => {
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({
        kind: "ToolResults",
        value: [],
      }),
      recordToolArtifacts: async () => [],
    });

    await expect(
      bridge.execute({
        tool: registeredTool("EmptyTool"),
        params: {},
        toolCallId: "call-empty",
        context: { toolAccessGrant: toolAccessGrant(["EmptyTool"]) },
      }),
    ).rejects.toThrow("without a result");
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
      Capabilities: { Cancellation: true },
    },
    observationProjection,
    execution: {
      Targets: ["Local"],
      Network: "Deny",
      Workspace: "ReadOnly",
    },
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
    maxTokens,
    limits: {
      maxDepth: 8,
      maxArrayItems: 32,
      maxObjectProperties: 48,
      maxStringCharacters: 2_048,
      maxTotalCharacters: 12_288,
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
