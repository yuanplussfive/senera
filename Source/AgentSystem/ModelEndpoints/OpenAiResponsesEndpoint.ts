import { z } from "zod";
import type { AgentLanguageModelRequest, AgentLanguageModelStream } from "./AgentLanguageModel.js";
import type {
  EndpointRuntime,
  TextGenerationEndpoint,
  TextGenerationEndpointResult,
} from "./ModelEndpointTypes.js";
import { shouldSendMaxOutputTokens } from "./ModelPayloadOptions.js";
import { buildOpenAiInput } from "./OpenAiMessageProjection.js";

const TextPartSchema = z.object({
  text: z.string().optional(),
}).passthrough();

const ResponsesBodySchema = z.object({
  output_text: z.string().optional(),
  output: z.array(z.object({
    content: z.array(TextPartSchema).optional(),
  }).passthrough()).optional(),
}).passthrough();

const ResponsesStreamEventSchema = z.object({
  type: z.string().optional(),
  delta: z.string().optional(),
}).passthrough();

export class OpenAiResponsesEndpoint implements TextGenerationEndpoint {
  constructor(private readonly runtime: EndpointRuntime) {}

  async complete(request: AgentLanguageModelRequest): Promise<TextGenerationEndpointResult> {
    const payload: Record<string, unknown> = {
      model: this.runtime.config.Model,
      input: buildOpenAiInput(request),
      temperature: this.runtime.config.Temperature,
    };
    if (shouldSendMaxOutputTokens(this.runtime.config)) {
      payload.max_output_tokens = this.runtime.config.MaxOutputTokens;
    }
    const body = ResponsesBodySchema.parse(
      await this.runtime.http.postJson(["responses"], payload, this.authHeaders(), {
        signal: request.signal,
      }),
    );

    return {
      text: body.output_text ?? body.output
        ?.flatMap((output) => output.content ?? [])
        .map((content) => content.text ?? "")
        .join("") ?? "",
    };
  }

  async stream(request: AgentLanguageModelRequest): Promise<AgentLanguageModelStream> {
    const payload: Record<string, unknown> = {
      model: this.runtime.config.Model,
      input: buildOpenAiInput(request),
      temperature: this.runtime.config.Temperature,
      stream: true,
    };
    if (shouldSendMaxOutputTokens(this.runtime.config)) {
      payload.max_output_tokens = this.runtime.config.MaxOutputTokens;
    }

    return this.runtime.http.postSseStream(["responses"], payload, this.authHeaders(), (event) => {
      const parsed = ResponsesStreamEventSchema.parse(event);
      return parsed.type === "response.output_text.delta" || parsed.type === "response_output_text_delta"
        ? parsed.delta ?? ""
        : "";
    }, undefined, {
      signal: request.signal,
    });
  }

  private authHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.runtime.config.ApiKey}`,
      ...this.runtime.config.Headers,
    };
  }
}
