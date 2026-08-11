import { describe, expect, test } from "vitest";
import { AgentPiPlanningContextCompiler } from "../../../Source/AgentSystem/Pi/AgentPiPlanningContextCompiler.js";
import { AgentPiToolObservationProtocolError } from "../../../Source/AgentSystem/PiShared/AgentPiToolObservationProtocol.js";
import type { ResolvedAgentModelProviderConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { compilePiToolObservation } from "../Support/PiToolObservationFixtures.js";

describe("Pi native planning context compilation", () => {
  test("preserves a bounded v2 observation in both the native transcript and reconciliation index", () => {
    const compiler = new AgentPiPlanningContextCompiler({ modelProvider: provider() });
    const observation = compilePiToolObservation({
      toolName: "ShellCommandTool",
      callId: "call-shell",
      status: "failure",
      outputAvailability: "partial",
      summary: "The command failed.",
      result: { diagnostic: "failure detail" },
      error: {
        code: "ToolProcessExited",
        message: "The command failed with exit code 2.",
      },
    });

    const projected = compiler.compile({
      model: "test-model",
      context: {
        messages: [
          userMessage("Run the check."),
          assistantToolCall("call-shell", "ShellCommandTool", { command: "check" }),
          toolResult("call-shell", "ShellCommandTool", observation),
        ],
      },
    });

    expect(projected.planningContext.messages.at(-1)).toEqual({
      role: "tool",
      callId: "call-shell",
      toolName: "ShellCommandTool",
      observation,
    });
    expect(projected.planningContext.toolTranscript[0]?.observation).toMatchObject({
      status: "failure",
      summary: "The command failed.",
      error: {
        code: "ToolProcessExited",
        message: "The command failed with exit code 2.",
      },
    });
  });

  test("rejects an observation outside protocol v2 before any planning projection", () => {
    const compiler = new AgentPiPlanningContextCompiler({ modelProvider: provider() });
    const legacy = {
      type: "senera.tool_observation.v1",
      tool_name: "LegacyTool",
      call_id: "call-legacy",
      result: { diagnostic: "x".repeat(100_000) },
    };

    expect(() =>
      compiler.compile({
        model: "test-model",
        context: { messages: [toolResult("call-legacy", "LegacyTool", legacy)] },
      }),
    ).toThrow(AgentPiToolObservationProtocolError);
  });

  test("selects complete recent turns and derives the tool transcript from the same retained messages", () => {
    const compiler = new AgentPiPlanningContextCompiler({
      modelProvider: provider({ ContextWindowTokens: 1_200, MaxOutputTokens: 200 }),
    });
    const oldObservation = compilePiToolObservation({
      toolName: "OldTool",
      callId: "call-old",
      summary: "Old result.",
    });
    const recentObservation = compilePiToolObservation({
      toolName: "RecentTool",
      callId: "call-recent",
      summary: "Recent result.",
    });

    const projected = compiler.compile({
      model: "test-model",
      context: {
        messages: [
          userMessage(`old request ${"x".repeat(20_000)}`),
          assistantToolCall("call-old", "OldTool", {}),
          toolResult("call-old", "OldTool", oldObservation),
          userMessage("recent request"),
          assistantToolCall("call-recent", "RecentTool", {}),
          toolResult("call-recent", "RecentTool", recentObservation),
        ],
      },
    });

    expect(projected.planningContext.messages).toEqual([
      { role: "user", content: "recent request" },
      expect.objectContaining({ role: "assistant", toolCalls: [expect.objectContaining({ id: "call-recent" })] }),
      expect.objectContaining({ role: "tool", callId: "call-recent" }),
    ]);
    expect(projected.planningContext.toolTranscript.map((entry) => entry.callId)).toEqual(["call-recent"]);
    expect(projected.planningContext.projection).toMatchObject({
      omittedOlderMessages: 3,
      originalToolCallCount: 2,
      projectedToolCallCount: 1,
      omittedOlderToolCalls: 1,
    });
  });

  test("fails explicitly instead of structurally truncating an oversized current turn", () => {
    const compiler = new AgentPiPlanningContextCompiler({
      modelProvider: provider({ ContextWindowTokens: 512, MaxOutputTokens: 128 }),
    });

    expect(() =>
      compiler.compile({
        model: "test-model",
        context: { messages: [userMessage("x".repeat(100_000))] },
      }),
    ).toThrow("current Pi conversation turn exceeds");
  });
});

function userMessage(content: string) {
  return { role: "user" as const, content, timestamp: 1 };
}

function assistantToolCall(callId: string, name: string, args: Record<string, unknown>) {
  return {
    role: "assistant" as const,
    api: "senera-planning" as const,
    provider: "senera",
    model: "test-model",
    content: [{ type: "toolCall" as const, id: callId, name, arguments: args }],
    usage: emptyUsage(),
    stopReason: "toolUse" as const,
    timestamp: 2,
  };
}

function toolResult(callId: string, toolName: string, observation: unknown) {
  return {
    role: "toolResult" as const,
    toolCallId: callId,
    toolName,
    content: [{ type: "text" as const, text: JSON.stringify(observation) }],
    isError: false,
    timestamp: 3,
  };
}

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function provider(overrides: Partial<ResolvedAgentModelProviderConfig> = {}): ResolvedAgentModelProviderConfig {
  return {
    Id: "test-model",
    ProviderId: "test-endpoint",
    Kind: "OpenAICompatible",
    Endpoint: "ChatCompletions",
    BaseUrl: "https://example.invalid/v1",
    ApiKey: "test-key",
    ApiVersion: "",
    Model: "test-model",
    ToolPlanningMode: "baml",
    ContextWindowTokens: 128_000,
    Temperature: 0,
    MaxOutputTokens: 8_192,
    Stream: true,
    TimeoutMs: 20_000,
    FirstTokenTimeoutMs: 20_000,
    MaxRequestMs: 20_000,
    MaxNetworkRetries: 0,
    RetryBaseDelayMs: 250,
    RetryMaxDelayMs: 10_000,
    RetryAfterMaxDelayMs: 60_000,
    Headers: {},
    Capabilities: {},
    ...overrides,
  };
}
