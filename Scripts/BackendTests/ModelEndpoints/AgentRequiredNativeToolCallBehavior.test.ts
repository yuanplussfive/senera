import { Type, type AssistantMessage, type Tool } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import { ModelProviderHttpError } from "../../../Source/AgentSystem/ModelEndpoints/ModelHttpErrors.js";
import { AgentRequiredModelToolCallError } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelFailureMapper.js";
import {
  AgentNativeToolCallRecoveryPolicy,
  buildAgentNativeToolRepairPrompt,
  extractAgentNativeToolArguments,
  isAgentNativeToolContractFailure,
} from "../../../Source/AgentSystem/ModelEndpoints/AgentNativeToolCallRecovery.js";

const createConfiguredProvider = vi.hoisted(() => vi.fn());

vi.mock("../../../Source/AgentSystem/ModelEndpoints/AgentPiConfiguredProvider.js", () => ({
  createAgentPiConfiguredProvider: createConfiguredProvider,
}));

import { AgentRequiredNativeToolCall } from "../../../Source/AgentSystem/ModelEndpoints/AgentRequiredNativeToolCall.js";

const ContractTool = {
  name: "CommitResult",
  description: "Commit one structured result.",
  parameters: Type.Object({ value: Type.String() }, { additionalProperties: false }),
} satisfies Tool;

describe("required native tool call recovery", () => {
  beforeEach(() => {
    createConfiguredProvider.mockReset();
  });

  test("repairs a missing tool call once and keeps the cache scope stable", async () => {
    const requests: Array<{ context: Record<string, unknown>; options: Record<string, unknown> }> = [];
    const stream = vi.fn((_model: unknown, context: Record<string, unknown>, options: Record<string, unknown>) => {
      requests.push({ context, options });
      const message = requests.length === 1 ? assistantMessage([{ type: "text", text: "not a call" }]) : toolMessage();
      return { result: async () => message };
    });
    createConfiguredProvider.mockReturnValue({ model: nativeModel(), provider: { stream } });

    const result = await new AgentRequiredNativeToolCall(
      createModelProvider({ Endpoint: "ChatCompletions" }),
      "Test",
    ).execute({
      tool: ContractTool,
      systemPrompt: "stable contract",
      userPrompt: "extract it",
      cache: { scope: "same-cache-scope", retention: "long" },
    });

    expect(result).toEqual({ value: "ok" });
    expect(stream).toHaveBeenCalledTimes(2);
    expect(requests[0]?.options.toolChoice).toEqual({ type: "function", function: { name: ContractTool.name } });
    expect(requests[1]?.options.toolChoice).toBe("auto");
    expect(requests[0]?.options.sessionId).toMatch(/^[a-f0-9]{64}$/u);
    expect(requests[1]?.options.sessionId).toMatch(/^[a-f0-9]{64}$/u);
    expect(requests[1]?.options.sessionId).toBe(requests[0]?.options.sessionId);
    expect((requests[1]?.context.messages as Array<{ content: string }>)[0]?.content).toContain(
      "Structured tool repair",
    );
  });

  test("captures the provider payload and reports cache state through timing", async () => {
    const snapshots: Array<Record<string, unknown>> = [];
    const timings: Array<Record<string, unknown>> = [];
    const stream = vi.fn((_model: unknown, _context: Record<string, unknown>, options: Record<string, unknown>) => {
      const onPayload = options.onPayload as ((payload: unknown, model: unknown) => unknown) | undefined;
      return {
        result: async () => {
          await onPayload?.({ messages: [{ role: "system", content: "stable" }] }, _model);
          return toolMessage({ cacheRead: 32 });
        },
      };
    });
    createConfiguredProvider.mockReturnValue({ model: nativeModel(), provider: { stream } });

    await new AgentRequiredNativeToolCall(createModelProvider(), "Test").execute({
      tool: ContractTool,
      systemPrompt: "stable contract",
      userPrompt: "extract",
      cache: {
        scope: "provider-scope",
        sessionId: "session-a",
        logicalCacheScope: "logical-scope",
        retention: "long",
      },
      wireSnapshotSink: (snapshot) => {
        snapshots.push(snapshot as unknown as Record<string, unknown>);
      },
      timingSink: (timing) => {
        timings.push(timing as unknown as Record<string, unknown>);
      },
    });

    expect(optionsOf(stream).onPayload).toBeTypeOf("function");
    expect(snapshots[0]).toMatchObject({
      logicalCacheScope: "logical-scope",
      providerCacheScope: expect.stringMatching(/^[a-f0-9]{64}$/u),
      sessionId: "session-a",
      observation: "hit",
      cacheReadTokens: 32,
    });
    expect(timings[0]?.promptCache).toMatchObject({ observation: "hit" });
  });

  test("repairs an upstream required-choice rejection, but does not retry payload failures", async () => {
    const stream = vi
      .fn()
      .mockImplementationOnce(() => ({
        result: async () => {
          throw new ModelProviderHttpError(400, "Bad Request", "tool_choice is not supported by this gateway");
        },
      }))
      .mockImplementationOnce(() => ({ result: async () => toolMessage() }));
    createConfiguredProvider.mockReturnValue({ model: nativeModel(), provider: { stream } });

    await expect(
      new AgentRequiredNativeToolCall(createModelProvider(), "Test").execute({
        tool: ContractTool,
        systemPrompt: "stable",
        userPrompt: "extract",
      }),
    ).resolves.toEqual({ value: "ok" });
    expect(stream).toHaveBeenCalledTimes(2);

    createConfiguredProvider.mockReset();
    const payloadFailure = vi.fn(() => ({
      result: async () => {
        throw new ModelProviderHttpError(413, "Payload Too Large", "request body is too large");
      },
    }));
    createConfiguredProvider.mockReturnValue({ model: nativeModel(), provider: { stream: payloadFailure } });
    await expect(
      new AgentRequiredNativeToolCall(createModelProvider(), "Test").execute({
        tool: ContractTool,
        systemPrompt: "stable",
        userPrompt: "extract",
      }),
    ).rejects.toBeInstanceOf(ModelProviderHttpError);
    expect(payloadFailure).toHaveBeenCalledTimes(1);
  });

  test("does not loop after the bounded repair attempt", async () => {
    const stream = vi.fn(() => ({ result: async () => assistantMessage([{ type: "text", text: "still prose" }]) }));
    createConfiguredProvider.mockReturnValue({ model: nativeModel(), provider: { stream } });

    await expect(
      new AgentRequiredNativeToolCall(createModelProvider(), "Test").execute({
        tool: ContractTool,
        systemPrompt: "stable",
        userPrompt: "extract",
      }),
    ).rejects.toThrow("did not return required tool");
    expect(stream).toHaveBeenCalledTimes(AgentNativeToolCallRecoveryPolicy.maxRepairAttempts + 1);
  });

  test("keeps recovery classification and extraction deterministic", () => {
    const missing = new Error("Model response did not return required tool CommitResult: none.");
    expect(isAgentNativeToolContractFailure(missing)).toBe(false);
    const structured = assistantMessage([{ type: "text", text: "no" }]);
    expect(() => extractAgentNativeToolArguments(structured, ContractTool.name)).toThrow(
      "did not return required tool",
    );
    const contractFailure = new AgentRequiredModelToolCallError(ContractTool.name, []);
    expect(buildAgentNativeToolRepairPrompt(ContractTool.name, contractFailure)).toContain("CommitResult");
    expect(isAgentNativeToolContractFailure(contractFailure)).toBe(true);
    expect(isAgentNativeToolContractFailure(new Error("tool_choice unsupported"))).toBe(true);
  });
});

function nativeModel(): Record<string, unknown> {
  return {
    api: "openai-completions",
    provider: "test-provider",
    id: "test-model",
    baseUrl: "https://model.example/v1",
    headers: {},
  };
}

function toolMessage(usageOverrides: Partial<AssistantMessage["usage"]> = {}): AssistantMessage {
  return assistantMessage(
    [{ type: "toolCall", id: "call-1", name: ContractTool.name, arguments: { value: "ok" } }],
    usageOverrides,
  );
}

function assistantMessage(
  content: AssistantMessage["content"],
  usageOverrides: Partial<AssistantMessage["usage"]> = {},
): AssistantMessage {
  return {
    role: "assistant",
    api: "openai-completions",
    provider: "test-provider",
    model: "test-model",
    content,
    usage: usage(usageOverrides),
    stopReason: "stop",
    timestamp: Date.now(),
  } as AssistantMessage;
}

function usage(overrides: Partial<AssistantMessage["usage"]> = {}): AssistantMessage["usage"] {
  return {
    input: 2,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 3,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...overrides,
  };
}

function optionsOf(stream: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return (stream.mock.calls[0]?.[2] ?? {}) as Record<string, unknown>;
}
