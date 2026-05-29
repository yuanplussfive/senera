import { z } from "zod";
import type { AgentLanguageModelRequest, AgentLanguageModelStream } from "../AgentLanguageModel.js";
import type {
  EndpointRuntime,
  ModelHttpPathSegment,
  TextGenerationEndpoint,
  TextGenerationEndpointResult,
} from "./ModelEndpointTypes.js";
import { rawPathSegment } from "./ModelHttpClient.js";
import { shouldSendMaxOutputTokens } from "./ModelPayloadOptions.js";

const GooglePartSchema = z.object({
  text: z.string().optional(),
}).passthrough();

const GoogleGenerateContentBodySchema = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(GooglePartSchema).optional(),
    }).passthrough().optional(),
  }).passthrough()).optional(),
}).passthrough();

export class GoogleGenerateContentEndpoint implements TextGenerationEndpoint {
  constructor(private readonly runtime: EndpointRuntime) {}

  async complete(request: AgentLanguageModelRequest): Promise<TextGenerationEndpointResult> {
    const body = GoogleGenerateContentBodySchema.parse(
      await this.runtime.http.postJson(
        this.path("generateContent"),
        this.buildPayload(request),
        this.authHeaders(),
      ),
    );

    return { text: readGoogleText(body) };
  }

  async stream(request: AgentLanguageModelRequest): Promise<AgentLanguageModelStream> {
    return this.runtime.http.postSseStream(
      this.path("streamGenerateContent"),
      this.buildPayload(request),
      this.authHeaders(),
      (event) => readGoogleText(GoogleGenerateContentBodySchema.parse(event)),
      { alt: "sse" },
    );
  }

  private buildPayload(request: AgentLanguageModelRequest): Record<string, unknown> {
    const generationConfig: Record<string, unknown> = {
      temperature: this.runtime.config.Temperature,
    };
    if (shouldSendMaxOutputTokens(this.runtime.config)) {
      generationConfig.maxOutputTokens = this.runtime.config.MaxOutputTokens;
    }

    return {
      systemInstruction: {
        parts: [{ text: request.systemPrompt }],
      },
      contents: request.messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      generationConfig,
    };
  }

  private path(method: "generateContent" | "streamGenerateContent"): ModelHttpPathSegment[] {
    return ["models", rawPathSegment(`${this.runtime.config.Model}:${method}`)];
  }

  private authHeaders(): HeadersInit {
    return {
      "x-goog-api-key": this.runtime.config.ApiKey,
      ...this.runtime.config.Headers,
    };
  }
}

function readGoogleText(body: z.infer<typeof GoogleGenerateContentBodySchema>): string {
  return body.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("") ?? "";
}
