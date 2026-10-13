import { createAssistantMessageEventStream, type Context } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import { completedTestPiStream, testPiAssistantMessage } from "../Support/AgentPiModelTestStream.js";
import { projectAgentNativeToolModel } from "../../../Source/AgentSystem/ModelEndpoints/AgentNativeToolModelProjector.js";
import { AgentStateCardRewriteSchema } from "../../../Source/AgentSystem/StateCard/AgentStateCardPrompt.js";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";

const createConfiguredProvider = vi.hoisted(() => vi.fn());
vi.mock("../../../Source/AgentSystem/ModelEndpoints/AgentPiConfiguredProvider.js", () => ({
  createAgentPiConfiguredProvider: createConfiguredProvider,
}));
import { AgentStructuredModelClient } from "../../../Source/AgentSystem/ModelEndpoints/AgentStructuredModelClient.js";

const contract = {
  name: "RewriteStateCard",
  description: "Resolve the current request.",
  schema: AgentStateCardRewriteSchema,
  bamlFunction: "RewriteStateCard",
} as const;
const input = {
  contract,
  systemPrompt: "Resolve only grounded context.",
  userPrompt: '{"current":"杭州呢","history":[{"user":"苏州天气"}]}',
  requestId: "test-request",
};

afterEach(() => {
  vi.restoreAllMocks();
  createConfiguredProvider.mockReset();
});

describe("shared structured model execution", () => {
  test.each(["native", "baml"] as const)(
    "uses %s output with conversation images and constructor telemetry",
    async (mode) => {
      const provider = createModelProvider({ ToolPlanningMode: mode });
      const value = { topicRelation: "continue", standaloneRequest: "杭州天气" };
      const stream = vi.fn((_model: unknown, _context: Context) =>
        completedTestPiStream(
          testPiAssistantMessage(
            mode === "native"
              ? [{ type: "toolCall", id: "call", name: contract.name, arguments: value }]
              : [{ type: "text", text: JSON.stringify(value) }],
          ),
        ),
      );
      createConfiguredProvider.mockReturnValue({ model: projectAgentNativeToolModel(provider), provider: { stream } });
      const timing = vi.fn();
      const usage = vi.fn();
      const client = new AgentStructuredModelClient(provider, "test", { timingSink: timing, usageSink: usage });
      await expect(
        client.execute({
          ...input,
          messages: [{ role: "user", content: "杭州呢" }],
          attachments: [{ type: "image", data: "image-bytes", mimeType: "image/png" }],
        }),
      ).resolves.toEqual(value);
      expect(stream).toHaveBeenCalledOnce();
      expect(stream.mock.calls[0]![1].messages.find((message) => message.role === "user")!.content).toEqual(
        expect.arrayContaining([{ type: "image", data: "image-bytes", mimeType: "image/png" }]),
      );
      expect(timing).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
      expect(usage).toHaveBeenCalledOnce();
    },
  );
  test.each(["native", "baml"] as const)(
    "propagates cancellation in %s mode without repair or parsing substitutes",
    async (mode) => {
      const provider = createModelProvider({ ToolPlanningMode: mode, MaxNetworkRetries: 3 });
      const controller = new AbortController();
      const reason = new AgentCancellationError();
      const stream = vi.fn(() => {
        const result = createAssistantMessageEventStream();
        queueMicrotask(() => controller.abort(reason));
        return result;
      });
      createConfiguredProvider.mockReturnValue({ model: projectAgentNativeToolModel(provider), provider: { stream } });
      const pending = new AgentStructuredModelClient(provider, "test").execute({ ...input, signal: controller.signal });
      await expect(pending).rejects.toBe(reason);
      expect(stream).toHaveBeenCalledOnce();
    },
  );
});
