import { describe, expect, test, vi } from "vitest";
import {
  AgentPiToolExecutionBridge,
  type AgentPiToolExecutionError,
} from "../../../Source/AgentSystem/Pi/AgentPiToolExecutionBridge.js";
import type { ExecutedToolCallResult } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/PluginRuntimeTypes.js";

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
    expect(result.details.senera).toEqual(
      expect.objectContaining({
        toolName: "SearchTool",
        artifactUri: "senera://artifact/1",
        callId: "call-1",
        executed,
      }),
    );
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
    expect(result.details.senera.result).toEqual({
      question: "哪个文件？",
      reason_code: "missing_path",
    });
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
        result: undefined,
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

function registeredTool(name: string): RegisteredTool {
  return {
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
    handler: { kind: "HostCapability", capability: name },
    execution: {
      Boundary: "Local",
      Network: "Deny",
      Workspace: "ReadOnly",
      LocalFallback: "Deny",
    },
    evidenceCapabilities: [],
  };
}

function textContent(content: unknown): string {
  return content && typeof content === "object" && "type" in content && content.type === "text" && "text" in content
    ? String(content.text)
    : "";
}
