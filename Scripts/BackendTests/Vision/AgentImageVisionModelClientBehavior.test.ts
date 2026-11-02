import type { Context } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import { completedTestPiStream, testPiAssistantMessage } from "../Support/AgentPiModelTestStream.js";
import { projectAgentNativeToolModel } from "../../../Source/AgentSystem/ModelEndpoints/AgentNativeToolModelProjector.js";
import { AgentImageVisionModelClient } from "../../../Source/AgentSystem/Vision/AgentImageVisionModelClient.js";

const createConfiguredProvider = vi.hoisted(() => vi.fn());
vi.mock("../../../Source/AgentSystem/ModelEndpoints/AgentPiConfiguredProvider.js", () => ({
  createAgentPiConfiguredProvider: createConfiguredProvider,
}));

afterEach(() => {
  vi.restoreAllMocks();
  createConfiguredProvider.mockReset();
});

describe("Pi image analysis", () => {
  test.each(["native", "baml"] as const)("uses native images regardless of planner mode %s", async (mode) => {
    for (const endpoint of ["Responses", "ChatCompletions", "ClaudeMessages", "GoogleGenerateContent"] as const) {
      const provider = createModelProvider({
        Endpoint: endpoint,
        ToolPlanningMode: mode,
        Capabilities: { Vision: true, ToolCalling: false },
        MaxNetworkRetries: 0,
      });
      const stream = vi.fn((_model: unknown, _context: Context) =>
        completedTestPiStream(testPiAssistantMessage([{ type: "text", text: "图 2 的数值从 8 变为 12。" }])),
      );
      createConfiguredProvider.mockReturnValue({ model: projectAgentNativeToolModel(provider), provider: { stream } });
      const result = await new AgentImageVisionModelClient().complete({
        provider,
        systemPrompt: "Use only visible evidence.",
        prompt: "用户正在核对报表，请比较图 1 和图 2 的变化，使用中文。",
        images: [
          { name: "first.png", mime: "image/png", base64: "first-image" },
          { name: "second.jpg", mime: "image/jpeg", base64: "second-image" },
        ],
      });
      expect(result).toEqual({
        text: "图 2 的数值从 8 变为 12。",
        provider: { id: provider.Id, endpoint, model: provider.Model },
      });
      expect(stream).toHaveBeenCalledOnce();
      const context = stream.mock.calls[0][1];
      expect(context.messages.find((message) => message.role === "user")?.content).toEqual([
        { type: "text", text: 'Image 1 (filename: "first.png")' },
        { type: "image", mimeType: "image/png", data: "first-image" },
        { type: "text", text: 'Image 2 (filename: "second.jpg")' },
        { type: "image", mimeType: "image/jpeg", data: "second-image" },
        { type: "text", text: "用户正在核对报表，请比较图 1 和图 2 的变化，使用中文。" },
      ]);
      expect(context.tools ?? []).toEqual([]);
    }
  });

  test.each([
    {
      content: [{ type: "thinking", thinking: "Only internal reasoning" }],
      stopReason: "stop",
      error: "without an answer",
    },
    {
      content: [{ type: "toolCall", id: "call-1", name: "AnalyzeImage", arguments: {} }],
      stopReason: "toolUse",
      error: "tool call",
    },
    { content: [{ type: "text", text: "partial" }], stopReason: "length", error: "output limit" },
  ] as const)("rejects incomplete analysis: $error", async ({ content, stopReason, error }) => {
    const provider = createModelProvider({ MaxNetworkRetries: 0, Capabilities: { Vision: true } });
    const stream = vi.fn(() => completedTestPiStream(testPiAssistantMessage([...content], { stopReason })));
    createConfiguredProvider.mockReturnValue({ model: projectAgentNativeToolModel(provider), provider: { stream } });
    await expect(
      new AgentImageVisionModelClient().complete({
        provider,
        systemPrompt: "",
        prompt: "Describe",
        images: [{ mime: "image/png", base64: "image" }],
      }),
    ).rejects.toThrow(error);
    expect(stream).toHaveBeenCalledOnce();
  });
});
