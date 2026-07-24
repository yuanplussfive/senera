import { z } from "zod";
import type { AgentLanguageModelRequest, AgentLanguageModelStream } from "./AgentLanguageModel.js";
import type { EndpointRuntime, TextGenerationEndpoint, TextGenerationEndpointResult } from "./ModelEndpointTypes.js";
import { shouldSendMaxOutputTokens } from "./ModelPayloadOptions.js";
import { resolveAgentModelCompatibility } from "./ModelCompatibility.js";
import { buildOpenAiInput } from "./OpenAiMessageProjection.js";
import { createProviderReportedUsage, type AgentModelUsageValue } from "./AgentModelUsage.js";
import { ModelUsageNumberWireSchema, projectModelUsageNumber } from "./ModelUsageWireSchema.js";

const OpenAiUsageSchema = z
  .object({
    prompt_tokens: ModelUsageNumberWireSchema,
    completion_tokens: ModelUsageNumberWireSchema,
    total_tokens: ModelUsageNumberWireSchema,
    prompt_tokens_details: z
      .object({
        cached_tokens: ModelUsageNumberWireSchema,
        cache_write_tokens: ModelUsageNumberWireSchema,
      })
      .passthrough()
      .nullish(),
    completion_tokens_details: z
      .object({
        reasoning_tokens: ModelUsageNumberWireSchema,
      })
      .passthrough()
      .nullish(),
    prompt_cache_hit_tokens: ModelUsageNumberWireSchema,
  })
  .passthrough()
  .nullish();

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
            usage: OpenAiUsageSchema,
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
    usage: OpenAiUsageSchema,
  })
  .passthrough();

const ChatCompletionStreamEventSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            usage: OpenAiUsageSchema,
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
    usage: OpenAiUsageSchema,
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

function projectOpenAiUsage(usage: z.infer<typeof OpenAiUsageSchema>): AgentModelUsageValue | undefined {
  if (!usage) return undefined;
  const cacheReadTokens = projectModelUsageNumber(
    usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens,
  );
  const cacheWriteTokens = projectModelUsageNumber(usage.prompt_tokens_details?.cache_write_tokens);
  const promptTokens = projectModelUsageNumber(usage.prompt_tokens);
  return createProviderReportedUsage({
    inputTokens:
      promptTokens === undefined
        ? undefined
        : Math.max(0, promptTokens - (cacheReadTokens ?? 0) - (cacheWriteTokens ?? 0)),
    outputTokens: projectModelUsageNumber(usage.completion_tokens),
    totalTokens: projectModelUsageNumber(usage.total_tokens),
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens: projectModelUsageNumber(usage.completion_tokens_details?.reasoning_tokens),
  });
}

function readTextContent(value: string | Array<{ text?: string | null }> | null | undefined): string {
  return typeof value === "string" ? value : (value?.map((item) => item.text ?? "").join("") ?? "");
}
