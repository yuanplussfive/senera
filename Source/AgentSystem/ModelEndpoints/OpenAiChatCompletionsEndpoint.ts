import { z } from "zod";
import type { AgentLanguageModelRequest, AgentLanguageModelStream } from "./AgentLanguageModel.js";
import type { EndpointRuntime, TextGenerationEndpoint, TextGenerationEndpointResult } from "./ModelEndpointTypes.js";
import { shouldSendMaxOutputTokens } from "./ModelPayloadOptions.js";
import { resolveAgentModelCompatibility } from "./ModelCompatibility.js";
import { buildOpenAiInput } from "./OpenAiMessageProjection.js";
import { createProviderReportedUsage, type AgentModelUsageValue } from "./AgentModelUsage.js";

const OpenAiUsageSchema = z
  .object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
    prompt_tokens_details: z
      .object({
        cached_tokens: z.number().optional(),
        cache_write_tokens: z.number().optional(),
      })
      .passthrough()
      .optional(),
    completion_tokens_details: z
      .object({
        reasoning_tokens: z.number().optional(),
      })
      .passthrough()
      .optional(),
    prompt_cache_hit_tokens: z.number().optional(),
  })
  .passthrough();

const TextContentPartSchema = z
  .object({
    text: z.string().nullish(),
  })
  .passthrough();

const TextContentSchema = z.union([z.string(), z.array(TextContentPartSchema)]).nullish();

const ChatCompletionBodySchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            usage: OpenAiUsageSchema.optional(),
            message: z
              .object({
                content: TextContentSchema,
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
    usage: OpenAiUsageSchema.optional(),
  })
  .passthrough();

const ChatCompletionStreamEventSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            usage: OpenAiUsageSchema.optional(),
            delta: z
              .object({
                content: TextContentSchema,
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
    usage: OpenAiUsageSchema.optional(),
  })
  .passthrough();

export class OpenAiChatCompletionsEndpoint implements TextGenerationEndpoint {
  constructor(private readonly runtime: EndpointRuntime) {}

  async complete(request: AgentLanguageModelRequest): Promise<TextGenerationEndpointResult> {
    const payload: Record<string, unknown> = {
      model: this.runtime.config.Model,
      messages: buildOpenAiInput(request, resolveAgentModelCompatibility(this.runtime.config)),
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
      usage: projectOpenAiUsage(body.usage ?? body.choices?.[0]?.usage),
    };
  }

  async stream(request: AgentLanguageModelRequest): Promise<AgentLanguageModelStream> {
    const compatibility = resolveAgentModelCompatibility(this.runtime.config);
    const payload: Record<string, unknown> = {
      model: this.runtime.config.Model,
      messages: buildOpenAiInput(request, compatibility),
      temperature: this.runtime.config.Temperature,
      stream: true,
    };
    if (compatibility.supportsStreamingUsage) payload.stream_options = { include_usage: true };
    if (shouldSendMaxOutputTokens(this.runtime.config)) {
      payload.max_tokens = this.runtime.config.MaxOutputTokens;
    }

    return this.runtime.http.postSseStream(
      ["chat", "completions"],
      payload,
      this.authHeaders(),
      (event) => {
        const parsed = ChatCompletionStreamEventSchema.parse(event);
        return {
          textDelta: readTextContent(parsed.choices?.[0]?.delta?.content),
          usage: projectOpenAiUsage(parsed.usage ?? parsed.choices?.[0]?.usage),
        };
      },
      undefined,
      {
        signal: request.signal,
      },
    );
  }

  private authHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.runtime.config.ApiKey}`,
      ...this.runtime.config.Headers,
    };
  }
}

function projectOpenAiUsage(usage: z.infer<typeof OpenAiUsageSchema> | undefined): AgentModelUsageValue | undefined {
  if (!usage) return undefined;
  const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens;
  const cacheWriteTokens = usage.prompt_tokens_details?.cache_write_tokens;
  const promptTokens = usage.prompt_tokens;
  return createProviderReportedUsage({
    inputTokens:
      promptTokens === undefined
        ? undefined
        : Math.max(0, promptTokens - (cacheReadTokens ?? 0) - (cacheWriteTokens ?? 0)),
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
  });
}

function readTextContent(value: string | Array<{ text?: string | null }> | null | undefined): string {
  return typeof value === "string" ? value : (value?.map((item) => item.text ?? "").join("") ?? "");
}
