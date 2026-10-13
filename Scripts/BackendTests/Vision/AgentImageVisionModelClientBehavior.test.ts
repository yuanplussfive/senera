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
  test.each(["native", "baml"] as const)(
    "uses %s structured output with both images for every declared endpoint",
    async (mode) => {
      for (const endpoint of ["Responses", "ChatCompletions", "ClaudeMessages", "GoogleGenerateContent"] as const) {
        const provider = createModelProvider({
          Endpoint: endpoint,
          ToolPlanningMode: mode,
          Capabilities: { Vision: true, ToolCalling: true },
          MaxNetworkRetries: 0,
        });
        const stream = vi.fn((_model: unknown, _context: Context) =>
          completedTestPiStream(
            testPiAssistantMessage(
              mode === "native"
                ? [{ type: "toolCall", id: "call-1", name: "AnalyzeImage", arguments: { analysis: "ok" } }]
                : [{ type: "text", text: '{"analysis":"ok"}' }],
            ),
          ),
        );
        createConfiguredProvider.mockReturnValue({
          model: projectAgentNativeToolModel(provider),
          provider: { stream },
        });
        const result = await new AgentImageVisionModelClient().complete({
          provider,
          systemPrompt: "Use only visible evidence.",
          prompt: "Compare image 1 and image 2.",
          images: [
            { mime: "image/png", base64: "first-image" },
            { mime: "image/jpeg", base64: "second-image" },
          ],
        });
        expect(result).toEqual({ text: "ok", provider: { id: provider.Id, endpoint, model: provider.Model } });
        expect(stream).toHaveBeenCalledOnce();
        const context = stream.mock.calls[0][1];
        const user = context.messages.find((message) => message.role === "user")!;
        expect(user.content).toEqual(
          expect.arrayContaining([
            { type: "image", mimeType: "image/png", data: "first-image" },
            { type: "image", mimeType: "image/jpeg", data: "second-image" },
          ]),
        );
        expect(JSON.stringify(user.content)).toContain("Compare image 1 and image 2.");
      }
    },
  );
  test("rejects missing or malformed native analysis without parsing ordinary text", async () => {
    const provider = createModelProvider({ ToolPlanningMode: "native", MaxNetworkRetries: 0 });
    const stream = vi.fn(() =>
      completedTestPiStream(testPiAssistantMessage([{ type: "text", text: '{"analysis":"fake success"}' }])),
    );
    createConfiguredProvider.mockReturnValue({ model: projectAgentNativeToolModel(provider), provider: { stream } });
    await expect(
      new AgentImageVisionModelClient().complete({ provider, systemPrompt: "", prompt: "Describe", images: [] }),
    ).rejects.toThrow("did not return required tool");
    expect(stream).toHaveBeenCalledOnce();
  });
});
