import { z } from "zod";
import type { AgentLanguageModelRequest, AgentLanguageModelStream } from "./AgentLanguageModel.js";
import type { EndpointRuntime, TextGenerationEndpoint, TextGenerationEndpointResult } from "./ModelEndpointTypes.js";
import { shouldSendMaxOutputTokens } from "./ModelPayloadOptions.js";
import { resolveAgentModelCompatibility } from "./ModelCompatibility.js";
import { buildOpenAiInput } from "./OpenAiMessageProjection.js";
import { createProviderReportedUsage, type AgentModelUsageValue } from "./AgentModelUsage.js";
import { ModelUsageNumberWireSchema, projectModelUsageNumber } from "./ModelUsageWireSchema.js";

const OpenAiResponsesUsageSchema = z
  .object({
    input_tokens: ModelUsageNumberWireSchema,
    output_tokens: ModelUsageNumberWireSchema,
    total_tokens: ModelUsageNumberWireSchema,
    input_tokens_details: z
      .object({
        cached_tokens: ModelUsageNumberWireSchema,
      })
      .passthrough()
      .nullish(),
    output_tokens_details: z
      .object({
        reasoning_tokens: ModelUsageNumberWireSchema,
      })
      .passthrough()
      .nullish(),
  })
  .passthrough()
  .nullish();

const TextPartSchema = z
  .object({
    text: z.string().optional(),
  })
  .passthrough();

const ResponsesBodySchema = z
  .object({
    output_text: z.string().optional(),
    output: z
      .array(
        z
          .object({
            content: z.array(TextPartSchema).optional(),
          })
          .passthrough(),
      )
      .optional(),
    usage: OpenAiResponsesUsageSchema,
  })
  .passthrough();

const ResponsesStreamEventSchema = z
  .object({
    type: z.string().optional(),
    delta: z.string().optional(),
    usage: OpenAiResponsesUsageSchema,
    response: z
      .object({
        usage: OpenAiResponsesUsageSchema,
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export class OpenAiResponsesEndpoint implements TextGenerationEndpoint {
  constructor(private readonly runtime: EndpointRuntime) {}

  async complete(request: AgentLanguageModelRequest): Promise<TextGenerationEndpointResult> {
    const payload: Record<string, unknown> = {
      model: this.runtime.config.Model,
      input: this.buildInput(request),
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
      text:
        body.output_text ??
        body.output
          ?.flatMap((output) => output.content ?? [])
          .map((content) => content.text ?? "")
          .join("") ??
        "",
      usage: projectResponsesUsage(body.usage),
    };
  }

  async stream(request: AgentLanguageModelRequest): Promise<AgentLanguageModelStream> {
    const payload: Record<string, unknown> = {
      model: this.runtime.config.Model,
      input: this.buildInput(request),
      temperature: this.runtime.config.Temperature,
      stream: true,
    };
    if (shouldSendMaxOutputTokens(this.runtime.config)) {
      payload.max_output_tokens = this.runtime.config.MaxOutputTokens;
    }

    return this.runtime.http.postSseStream(
      ["responses"],
      payload,
      this.authHeaders(),
      (event) => {
        const parsed = ResponsesStreamEventSchema.parse(event);
        return {
          textDelta:
            parsed.type === "response.output_text.delta" || parsed.type === "response_output_text_delta"
              ? (parsed.delta ?? "")
              : "",
          usage: projectResponsesUsage(parsed.response?.usage ?? parsed.usage),
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

  private buildInput(request: AgentLanguageModelRequest) {
    return buildOpenAiInput(request, resolveAgentModelCompatibility(this.runtime.config));
  }
}

function projectResponsesUsage(usage: z.infer<typeof OpenAiResponsesUsageSchema>): AgentModelUsageValue | undefined {
  if (!usage) return undefined;
  const cacheReadTokens = projectModelUsageNumber(usage.input_tokens_details?.cached_tokens);
  const inputTokens = projectModelUsageNumber(usage.input_tokens);
  return createProviderReportedUsage({
    inputTokens: inputTokens === undefined ? undefined : Math.max(0, inputTokens - (cacheReadTokens ?? 0)),
    outputTokens: projectModelUsageNumber(usage.output_tokens),
    totalTokens: projectModelUsageNumber(usage.total_tokens),
    cacheReadTokens,
    reasoningTokens: projectModelUsageNumber(usage.output_tokens_details?.reasoning_tokens),
  });
}
