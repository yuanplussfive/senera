import { describe, expect, test } from "vitest";
import { AgentPiToolObservationProtocolError } from "../../../Source/AgentSystem/PiShared/AgentPiToolObservationProtocol.js";
import { AgentPiOpenAiPlanningProjector } from "../../../Source/AgentSystem/PiProxy/AgentPiOpenAiPlanningProjector.js";
import type { ResolvedAgentModelProviderConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { compilePiToolObservation } from "../Support/PiToolObservationFixtures.js";

describe("Pi OpenAI planning projection", () => {
  test("preserves a bounded tool observation when the whole turn fits the dynamic planning budget", () => {
    const projector = new AgentPiOpenAiPlanningProjector({ modelProvider: provider() });
    const diagnostic = "failure detail 0123456789 abcdefghijklmnopqrstuvwxyz\n".repeat(2_000);
    const observation = JSON.stringify(
      compilePiToolObservation({
        toolName: "ShellCommandTool",
        callId: "call-shell",
        status: "failure",
        summary: "The command failed.",
        result: { diagnostic },
        error: {
          code: "ToolProcessExited",
          message: "The command failed with exit code 2.",
        },
      }),
    );

    const projected = projector.project({
      model: "test-model",
      messages: [
        { role: "user", content: "Run the check." },
        {
          role: "assistant",
          content: "Running the check.",
          tool_calls: [
            {
              id: "call-shell",
              type: "function",
              function: { name: "ShellCommandTool", arguments: '{"command":"check"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call-shell", content: observation },
      ],
    });

    const toolMessage = projected.messages.at(-1) as { content?: string } | undefined;
    expect(toolMessage?.content).toBe(observation);
    expect(projected.projection).toMatchObject({
      omittedOlderMessages: 0,
      truncatedTextFields: 0,
      truncatedJsonFields: 0,
    });
    expect(projected.toolTranscript[0]?.observation).toMatchObject({
      status: "failure",
      summary: "The command failed.",
      error: {
        code: "ToolProcessExited",
        message: "The command failed with exit code 2.",
      },
    });
  });

  test("rejects an unbounded Senera observation before planning tokenization", () => {
    const projector = new AgentPiOpenAiPlanningProjector({ modelProvider: provider() });
    const observation = JSON.stringify({
      type: "senera.tool_observation.v1",
      tool_name: "LegacyTool",
      call_id: "call-legacy",
      result: { diagnostic: "x".repeat(100_000) },
    });

    expect(() =>
      projector.project({
        model: "test-model",
        messages: [{ role: "tool", tool_call_id: "call-legacy", content: observation }],
      }),
    ).toThrow(AgentPiToolObservationProtocolError);
  });
});

function provider(): ResolvedAgentModelProviderConfig {
  return {
    Id: "test-model",
    ProviderId: "test-endpoint",
    Kind: "OpenAICompatible",
    Endpoint: "ChatCompletions",
    BaseUrl: "https://example.invalid/v1",
    ApiKey: "test-key",
    ApiVersion: "",
    Model: "test-model",
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
  };
}
