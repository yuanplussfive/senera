import { z } from "zod";
import type { AgentLanguageModelRequest, AgentLanguageModelStream } from "../AgentLanguageModel.js";
import type {
  EndpointRuntime,
  TextGenerationEndpoint,
  TextGenerationEndpointResult,
} from "./ModelEndpointTypes.js";
import { shouldSendMaxOutputTokens } from "./ModelPayloadOptions.js";
import { buildOpenAiInput } from "./OpenAiMessageProjection.js";

const TextContentPartSchema = z.object({
  text: z.string().nullish(),
}).passthrough();

const TextContentSchema = z.union([
  z.string(),
  z.array(TextContentPartSchema),
]).nullish();

const ChatCompletionBodySchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: TextContentSchema,
    }).passthrough().optional(),
  }).passthrough()).optional(),
}).passthrough();

const ChatCompletionStreamEventSchema = z.object({
  choices: z.array(z.object({
    delta: z.object({
      content: TextContentSchema,
    }).passthrough().optional(),
  }).passthrough()).optional(),
}).passthrough();

export class OpenAiChatCompletionsEndpoint implements TextGenerationEndpoint {
  constructor(private readonly runtime: EndpointRuntime) {}

  async complete(request: AgentLanguageModelRequest): Promise<TextGenerationEndpointResult> {
    const payload: Record<string, unknown> = {
      model: this.runtime.config.Model,
      messages: buildOpenAiInput(request),
      temperature: this.runtime.config.Temperature,
    };
    if (shouldSendMaxOutputTokens(this.runtime.config)) {
      payload.max_tokens = this.runtime.config.MaxOutputTokens;
    }
    const body = ChatCompletionBodySchema.parse(
      await this.runtime.http.postJson(["chat", "completions"], payload, this.authHeaders(), {
        signal: request.signal,
      }),
    );

    return {
      text: readTextContent(body.choices?.[0]?.message?.content),
    };
  }

  async stream(request: AgentLanguageModelRequest): Promise<AgentLanguageModelStream> {
    const payload: Record<string, unknown> = {
      model: this.runtime.config.Model,
      messages: buildOpenAiInput(request),
      temperature: this.runtime.config.Temperature,
      stream: true,
    };
    if (shouldSendMaxOutputTokens(this.runtime.config)) {
      payload.max_tokens = this.runtime.config.MaxOutputTokens;
    }

    return this.runtime.http.postSseStream(["chat", "completions"], payload, this.authHeaders(), (event) => {
      const parsed = ChatCompletionStreamEventSchema.parse(event);
      return readTextContent(parsed.choices?.[0]?.delta?.content);
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

function readTextContent(value: string | Array<{ text?: string | null }> | null | undefined): string {
  return typeof value === "string"
    ? value
    : value?.map((item) => item.text ?? "").join("") ?? "";
}
