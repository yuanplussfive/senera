import { randomUUID } from "node:crypto";
import type { AssistantMessage, ImageContent, TextContent } from "@earendil-works/pi-ai";
import { AgentPiModelRequestExecutor } from "../ModelEndpoints/AgentPiModelRequestExecutor.js";
import type { AgentImageVisionRequest, AgentImageVisionResponse } from "./AgentImageVisionTypes.js";

/** Native multimodal analysis over the shared provider, timeout and usage path. */
export class AgentImageVisionModelClient {
  async complete(request: AgentImageVisionRequest): Promise<AgentImageVisionResponse> {
    if (request.images.length === 0) throw new Error("Image analysis requires at least one image.");
    if (!request.prompt.trim()) throw new Error("Image analysis requires a non-empty analysis request.");
    const client = new AgentPiModelRequestExecutor(request.provider, "ImageAnalysis");
    const requestId = request.requestId ?? randomUUID();
    const content: (TextContent | ImageContent)[] = request.images.flatMap((image, index) => [
      {
        type: "text",
        text: `Image ${index + 1}${image.name ? ` (filename: ${JSON.stringify(image.name)})` : ""}`,
      } as TextContent,
      { type: "image", mimeType: image.mime, data: image.base64 } as ImageContent,
    ]);
    content.push({ type: "text", text: request.prompt });
    const result = await client.execute({
      requestId,
      stage: "ImageAnalysis",
      signal: request.signal,
      omitOutputTokenLimit: true,
      context: {
        systemPrompt: request.systemPrompt,
        messages: [{ role: "user", content, timestamp: Date.now() }],
      },
      validate: readImageAnalysis,
    });
    return {
      text: readImageAnalysis(result),
      provider: { id: request.provider.Id, endpoint: request.provider.Endpoint, model: request.provider.Model },
    };
  }
}

function readImageAnalysis(message: AssistantMessage): string {
  if (message.content.some((part) => part.type === "toolCall")) {
    throw new Error("Image analysis returned a tool call instead of visual evidence.");
  }
  if (message.stopReason === "length") {
    throw new Error("Image analysis was interrupted by the model output limit.");
  }
  const text = message.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
  if (!text) throw new Error("Image analysis completed without an answer.");
  return text;
}
