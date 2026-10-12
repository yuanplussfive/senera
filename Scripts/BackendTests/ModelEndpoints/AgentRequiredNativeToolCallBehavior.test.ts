import { Type, createAssistantMessageEventStream, type Context, type Tool } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import { completedTestPiStream, testPiAssistantMessage } from "../Support/AgentPiModelTestStream.js";
import {
  ModelProviderHttpError,
  ModelRequestTimeoutError,
} from "../../../Source/AgentSystem/ModelEndpoints/ModelHttpErrors.js";
import { AgentRequiredModelToolCallError } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelFailureMapper.js";
import { isAgentNativeToolContractFailure } from "../../../Source/AgentSystem/ModelEndpoints/AgentNativeToolCallRecovery.js";
import { projectAgentNativeToolModel } from "../../../Source/AgentSystem/ModelEndpoints/AgentNativeToolModelProjector.js";
import type { AgentModelUsageSink } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";
import { AgentModelResponseBudgetError } from "../../../Source/AgentSystem/ModelEndpoints/ModelResponseBudget.js";

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
const input = {
  tool: ContractTool,
  systemPrompt: "stable contract",
  userPrompt: "extract it",
  cache: { scope: "same-cache", retention: "long" as const },
};
const success = () =>
  testPiAssistantMessage([{ type: "toolCall", id: "call-1", name: ContractTool.name, arguments: { value: "ok" } }]);

beforeEach(() => createConfiguredProvider.mockReset());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function fixture(
  stream: ReturnType<typeof vi.fn>,
  overrides: Parameters<typeof createModelProvider>[0] = {},
  usageSink?: AgentModelUsageSink,
) {
  const config = createModelProvider({ MaxNetworkRetries: 1, ...overrides });
  createConfiguredProvider.mockReturnValue({ model: projectAgentNativeToolModel(config), provider: { stream } });
  return new AgentRequiredNativeToolCall(config, "Test", usageSink);
}
describe("required native structured execution", () => {
  test("repairs only typed contract failures and keeps required tool selection and cache", async () => {
    const usage = vi.fn();
    const stream = vi
      .fn()
      .mockImplementationOnce(() =>
        completedTestPiStream(testPiAssistantMessage([{ type: "text", text: "not a call" }])),
      )
      .mockImplementationOnce(() => completedTestPiStream(success()));
    expect(await fixture(stream, {}, usage).execute(input)).toEqual({ value: "ok" });
    expect(stream).toHaveBeenCalledTimes(2);
    expect(usage).toHaveBeenCalledTimes(2);
    const options = stream.mock.calls.map((call) => call[2]);
    expect(options[0].toolChoice).toEqual(options[1].toolChoice);
    expect(options[0].toolChoice).not.toBe("auto");
    expect(options[0].sessionId).toBe(options[1].sessionId);
    expect(JSON.stringify(stream.mock.calls[1][1])).toContain("Structured tool repair");
  });
  test("does not retry a rejected tool_choice or another HTTP client error", async () => {
    const stream = vi.fn(() => {
      throw new ModelProviderHttpError(400, "Bad Request", "tool_choice unsupported");
    });
    await expect(fixture(stream).execute(input)).rejects.toThrow();
    expect(stream).toHaveBeenCalledOnce();
    expect(isAgentNativeToolContractFailure(new Error("tool_choice unsupported"))).toBe(false);
    expect(isAgentNativeToolContractFailure(new AgentRequiredModelToolCallError(ContractTool.name, []))).toBe(true);
  });
  test("bounds repairs by the configured budget", async () => {
    const stream = vi.fn(() => completedTestPiStream(testPiAssistantMessage([{ type: "text", text: "still prose" }])));
    await expect(fixture(stream, { MaxNetworkRetries: 2 }).execute(input)).rejects.toBeInstanceOf(
      AgentRequiredModelToolCallError,
    );
    expect(stream).toHaveBeenCalledTimes(3);
  });
  test.each(["first_token", "max_request"] as const)(
    "reports %s deadline even when a provider ignores the abort signal",
    async (kind) => {
      vi.useFakeTimers();
      const stream = vi.fn(() => createAssistantMessageEventStream());
      const call = fixture(stream, {
        FirstTokenTimeoutMs: kind === "first_token" ? 50 : -1,
        MaxRequestMs: kind === "max_request" ? 50 : -1,
      });
      const pending = expect(call.execute(input)).rejects.toBeInstanceOf(ModelRequestTimeoutError);
      await vi.advanceTimersByTimeAsync(51);
      await pending;
      expect(stream).toHaveBeenCalledOnce();
    },
  );
  test("retains caller cancellation without treating it as a provider timeout", async () => {
    const controller = new AbortController();
    const reason = new Error("caller stopped");
    const stream = vi.fn(() => createAssistantMessageEventStream());
    const pending = expect(fixture(stream).execute({ ...input, signal: controller.signal })).rejects.toBe(reason);
    controller.abort(reason);
    await pending;
    expect(stream).toHaveBeenCalledOnce();
  });
  test("reports captured cache timing after actual provider usage", async () => {
    const timingSink = vi.fn();
    const wireSnapshotSink = vi.fn();
    const stream = vi.fn((_model, _context: Context, options) => {
      options.onPayload?.({ messages: [{ role: "system", content: "stable" }] }, _model);
      return completedTestPiStream(success());
    });
    await fixture(stream).execute({ ...input, timingSink, wireSnapshotSink });
    expect(timingSink).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", firstTokenMs: expect.any(Number), cacheReadTokens: 0 }),
    );
    expect(wireSnapshotSink).toHaveBeenCalledOnce();
  });
  test.each([{ MaxResponseBytes: 16 }, { MaxSseEventBytes: 16 }, { MaxSseEvents: 1 }])(
    "aborts a response budget failure without repair: %j",
    async (limits) => {
      const usage = vi.fn();
      const stream = vi.fn((_model: unknown, _context: Context, _options: { signal: AbortSignal }) => {
        const result = createAssistantMessageEventStream();
        const message = success();
        result.push({ type: "start", partial: message });
        result.push({ type: "done", reason: "toolUse", message });
        return result;
      });
      await expect(fixture(stream, { ...limits, MaxNetworkRetries: 3 }, usage).execute(input)).rejects.toBeInstanceOf(
        AgentModelResponseBudgetError,
      );
      expect(stream).toHaveBeenCalledOnce();
      expect(stream.mock.calls[0]![2].signal.aborted).toBe(true);
    },
  );
});
