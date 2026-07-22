import { describe, expect, test, vi } from "vitest";
import {
  AgentPiToolExecutionBridge,
  type AgentPiToolExecutionError,
} from "../../../Source/AgentSystem/Pi/AgentPiToolExecutionBridge.js";
import type { ExecutedToolCallResult } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/PluginRuntimeTypes.js";
import type { ToolObservationManifest } from "../../../Source/AgentSystem/Types/PluginManifestTypes.js";
import {
  registerPiProxyRuntimeContext,
  releasePiProxyRuntimeContext,
  takePiProxyExecutedToolResult,
} from "../../../Source/AgentSystem/PiProxy/AgentPiProxyRuntimeContext.js";

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
      model: "test-model",
    });

    const result = await bridge.execute({
      tool: registeredTool("SearchTool"),
      params: { query: "answer" },
      toolCallId: "call-1",
      context: {
        requestId: "request-1",
        step: 3,
        visibleToolNames: ["SearchTool"],
      },
    });

    expect(executeToolCall).toHaveBeenCalledWith(
      {
        name: "SearchTool",
        arguments: { query: "answer" },
        callId: "call-1",
      },
      expect.objectContaining({
        requestId: "request-1",
        step: 3,
        loadedToolNames: ["SearchTool"],
      }),
    );
    expect(recordToolArtifacts).toHaveBeenCalledWith({
      requestId: "request-1",
      step: 3,
      results: [expect.objectContaining({ result: { unrecorded: true } })],
    });
    expect(textContent(result.content[0])).toContain("senera.tool_observation.v1");
    expect(parseObservation(result)).toMatchObject({
      result: { answer: "42" },
      artifact_uri: "senera://artifact/1",
    });
    expect(result.details.senera).toEqual(
      expect.objectContaining({
        toolName: "SearchTool",
        artifactUri: "senera://artifact/1",
        callId: "call-1",
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
      model: "test-model",
    });

    const result = await bridge.execute({
      tool: registeredTool("ExecutionResourceInspect", resourceObservation()),
      params: { resourceId: "res_0123456789abcdef0123456789abcdef" },
      toolCallId: "call-resource",
      context: {},
    });

    expect(parseObservation(result)).toMatchObject({
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
    });
    expect(parseObservation(result)).not.toHaveProperty("projection");
  });

  test("keeps full execution data in the turn context instead of persisted Pi details", async () => {
    const hugeText = "large-result\n".repeat(200_000);
    const executed = toolResult({
      result: { text: hugeText },
      artifact: artifactFixture("large result"),
    });
    const contextId = registerPiProxyRuntimeContext({ requestId: "request-large" });
    try {
      const bridge = new AgentPiToolExecutionBridge({
        executeToolCall: async () => ({ kind: "ToolResults", value: [executed] }),
        recordToolArtifacts: async () => [executed],
        model: "test-model",
      });

      const result = await bridge.execute({
        tool: registeredTool("LargeResultTool"),
        params: {},
        toolCallId: "call-large",
        context: { piProxyRuntimeContextId: contextId },
      });

      expect(JSON.stringify(result).length).toBeLessThan(32_000);
      expect(result.details.senera).toEqual({
        toolName: "LargeResultTool",
        artifactUri: executed.artifact?.artifactUri,
        callId: executed.callId,
      });
      expect(takePiProxyExecutedToolResult(contextId, "call-large")).toBe(executed);
      expect(takePiProxyExecutedToolResult(contextId, "call-large")).toBeUndefined();
    } finally {
      releasePiProxyRuntimeContext(contextId);
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
      model: "test-model",
    });

    const result = await bridge.execute({
      tool: registeredTool("ArtifactMemoryReadTool", {
        MaxTokens: 6_000,
        IncludeArtifactProjection: false,
      }),
      params: {},
      toolCallId: "call-memory",
      context: {},
    });

    const observation = parseObservation(result);
    expect(JSON.stringify(observation.result)).toContain("unique-hydrated-content");
    expect(observation.result).toMatchObject({ apiToken: "[REDACTED]" });
    expect(JSON.stringify(observation)).not.toContain("must-not-reach-model");
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
      model: "test-model",
    });

    const result = await bridge.execute({
      tool: registeredTool("ReadFile"),
      params: {},
      toolCallId: "call-ask",
      context: {},
    });

    expect(result.terminate).toBe(true);
    expect(textContent(result.content[0])).toContain("哪个文件");
    expect(result.details.senera).toEqual({ toolName: "ReadFile" });
  });

  test("throws structured tool errors so Pi can surface failed execution", async () => {
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({
        kind: "ToolResults",
        value: [toolResult({ result: { error: { code: "failed", message: "boom" } } })],
      }),
      recordToolArtifacts: async (input) => [...input.results],
      model: "test-model",
    });

    await expect(
      bridge.execute({
        tool: registeredTool("ShellCommandTool"),
        params: { command: "exit 1" },
        toolCallId: "call-error",
        context: {},
      }),
    ).rejects.toMatchObject({
      name: "AgentPiToolExecutionError",
      message: "boom",
    } satisfies Partial<AgentPiToolExecutionError>);
  });

  test("projects empty tool results without crashing", async () => {
    const bridge = new AgentPiToolExecutionBridge({
      executeToolCall: async () => ({
        kind: "ToolResults",
        value: [],
      }),
      recordToolArtifacts: async () => [],
      model: "test-model",
    });

    const result = await bridge.execute({
      tool: registeredTool("EmptyTool"),
      params: {},
      toolCallId: "call-empty",
      context: {},
    });

    expect(textContent(result.content[0])).toContain('"status":"empty"');
    expect(result.details.senera).toEqual(
      expect.objectContaining({
        toolName: "EmptyTool",
      }),
    );
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
      stderr: "",
    },
    result: { ok: true },
    ...overrides,
  };
}

function registeredTool(name: string, observation?: ToolObservationManifest): RegisteredTool {
  return {
    loading: "Dynamic",
    plugin: {
      rootPath: "",
      rootKind: "System",
      manifestPath: "",
      config: {
        fileName: "PluginConfig.toml",
        path: "",
        exists: false,
        source: "default",
        templateExists: false,
        needsUserConfig: false,
        toml: "",
        sections: [],
        runtime: {
          enabled: true,
          tools: {},
        },
        diagnostics: [],
      },
      manifest: {
        ManifestVersion: 2,
        Plugin: {
          Name: `${name}Plugin`,
          Title: name,
          Version: "1.0.0",
          Kind: "Tool",
        },
      },
    },
    name,
    permissions: [],
    sources: [],
    handler: { kind: "HostCapability", capability: name },
    runtime: { Lifecycle: "Immediate", ProtocolVersion: 2, Capabilities: { Cancellation: true } },
    observation,
    execution: {
      Targets: ["Local"],
      Network: "Deny",
      Workspace: "ReadOnly",
    },
    evidenceCapabilities: [],
  };
}

function resourceObservation(): ToolObservationManifest {
  return {
    MaxTokens: 6_000,
    IncludeArtifactProjection: false,
    Continuation: {
      Kind: "cursor",
      Handle: "$.resourceId",
      Cursor: "$.cursor",
      State: "$.state",
      TerminalStates: ["completed", "failed", "cancelled"],
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
