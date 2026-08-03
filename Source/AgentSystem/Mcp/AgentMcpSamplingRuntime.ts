import type { CreateMessageRequest, CreateMessageResult } from "@modelcontextprotocol/sdk/types.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentImageVisionModelClient } from "../Vision/AgentImageVisionModelClient.js";
import { resolveAgentVisionProvider } from "../Vision/AgentVisionProviderResolver.js";

export type AgentMcpSamplingHandler = (
  params: CreateMessageRequest["params"],
  signal?: AbortSignal,
) => Promise<CreateMessageResult>;

export function createAgentMcpSamplingHandler(
  config: AgentSystemConfig,
  modelProviderId?: string,
): AgentMcpSamplingHandler {
  return async (params, signal) => {
    const provider = resolveAgentVisionProvider(config, { conversationModelProviderId: modelProviderId });
    const content = params.messages.flatMap((message) =>
      Array.isArray(message.content) ? message.content : [message.content],
    );
    const image = content.find((item) => item.type === "image");
    if (!image || image.type !== "image") throw new Error("MCP vision sampling requires image content.");
    const prompt = content
      .filter((item): item is Extract<(typeof content)[number], { type: "text" }> => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    const response = await new AgentImageVisionModelClient().complete({
      provider,
      systemPrompt: params.systemPrompt ?? "Analyze only the supplied image evidence.",
      prompt,
      mime: image.mimeType,
      base64: image.data,
      signal,
    });
    return {
      model: response.provider.model,
      role: "assistant",
      content: { type: "text", text: response.text },
      stopReason: "endTurn",
    };
  };
}
