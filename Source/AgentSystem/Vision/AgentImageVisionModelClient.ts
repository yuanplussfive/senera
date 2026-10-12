import { z } from "zod";
import { AgentStructuredModelClient } from "../ModelEndpoints/AgentStructuredModelClient.js";
import type { AgentImageVisionRequest, AgentImageVisionResponse } from "./AgentImageVisionTypes.js";

const ImageAnalysisSchema = z.object({ analysis: z.string().trim().min(1) }).strict();

/** Image analysis and MCP image sampling use the same configured Pi structured request path. */
export class AgentImageVisionModelClient {
  async complete(request: AgentImageVisionRequest): Promise<AgentImageVisionResponse> {
    const client = new AgentStructuredModelClient(request.provider, "ImageAnalysis");
    const result = await client.execute({
      contract: {
        name: "AnalyzeImage",
        description: "Return the grounded analysis of the supplied images.",
        schema: ImageAnalysisSchema,
        bamlFunction: "AnalyzeImage",
      },
      systemPrompt: request.systemPrompt,
      userPrompt: request.prompt,
      requestId: request.requestId ?? crypto.randomUUID(),
      signal: request.signal,
      attachments: request.images.map((image) => ({ type: "image", mimeType: image.mime, data: image.base64 })),
    });
    return {
      text: result.analysis,
      provider: { id: request.provider.Id, endpoint: request.provider.Endpoint, model: request.provider.Model },
    };
  }
}
