import { z } from "zod";
import type { AgentLanguageModelRequest, AgentLanguageModelStream } from "./AgentLanguageModel.js";
import type { EndpointRuntime, TextGenerationEndpoint, TextGenerationEndpointResult } from "./ModelEndpointTypes.js";
import { shouldSendMaxOutputTokens } from "./ModelPayloadOptions.js";
import { projectOpenAiCompatibleMessages } from "./OpenAiCompatibleMessageProjector.js";
import { createProviderReportedUsage, type AgentModelUsageValue } from "./AgentModelUsage.js";
import { ModelUsageNumberWireSchema, projectModelUsageNumber } from "./ModelUsageWireSchema.js";
import { createAgentModelCompletionMetadata } from "./AgentModelCompletion.js";

const ClaudeUsageSchema = z
  .object({
    input_tokens: ModelUsageNumberWireSchema,
    output_tokens: ModelUsageNumberWireSchema,
    cache_read_input_tokens: ModelUsageNumberWireSchema,
    cache_creation_input_tokens: ModelUsageNumberWireSchema,
  })
  .passthrough()
  .nullish();

const ClaudeContentBlockSchema = z
  .object({
    type: z.string().optional(),
    text: z.string().optional(),
  })
  .passthrough();

const ClaudeMessageBodySchema = z
  .object({
    stop_reason: z.string().nullish(),
    content: z.array(ClaudeContentBlockSchema).optional(),
    usage: ClaudeUsageSchema,
  })
  .passthrough();

const ClaudeStreamEventSchema = z
  .object({
    type: z.string().optional(),
    delta: z
      .object({
        text: z.string().optional(),
        stop_reason: z.string().nullish(),
      })
      .passthrough()
      .optional(),
    message: z
      .object({
        usage: ClaudeUsageSchema,
      })
      .passthrough()
      .optional(),
    usage: ClaudeUsageSchema,
  })
  .passthrough();

export class ClaudeMessagesEndpoint implements TextGenerationEndpoint {
  constructor(private readonly runtime: EndpointRuntime) {}

  async complete(request: AgentLanguageModelRequest): Promise<TextGenerationEndpointResult> {
    const body = ClaudeMessageBodySchema.parse(
      await this.runtime.http.postJson(["messages"], this.buildPayload(request, false), this.authHeaders(), {
        signal: request.signal,
      }),
    );

    return {
      text:
        body.content
          ?.filter((content) => content.type === "text")
          .map((content) => content.text ?? "")
          .join("") ?? "",
      usage: projectClaudeUsage(body.usage),
      completion: createAgentModelCompletionMetadata({
        finishReason: body.stop_reason ?? undefined,
      }),
    };
  }

  async stream(request: AgentLanguageModelRequest): Promise<AgentLanguageModelStream> {
    return this.runtime.http.postSseStream(
      ["messages"],
      this.buildPayload(request, true),
      this.authHeaders(),
      (event) => {
        const parsed = ClaudeStreamEventSchema.parse(event);
        return {
          textDelta: parsed.type === "content_block_delta" ? (parsed.delta?.text ?? "") : "",
          usage: projectClaudeUsage(parsed.usage ?? parsed.message?.usage),
          completion: createAgentModelCompletionMetadata({
            finishReason: parsed.delta?.stop_reason ?? undefined,
          }),
        };
      },
      undefined,
      { signal: request.signal },
    );
  }

  private buildPayload(request: AgentLanguageModelRequest, stream: boolean): Record<string, unknown> {
    const messages = projectOpenAiCompatibleMessages(request, {
      developerRole: "system",
    });
    const system = messages
      .filter((message) => message.role === "system" || message.role === "developer")
      .map((message) => readMessageText(message.content))
      .join("\n\n");
    const payload: Record<string, unknown> = {
      model: this.runtime.config.Model,
      system,
      messages: messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({
          role: message.role,
          content: projectClaudeContent(message.content),
        })),
      temperature: this.runtime.config.Temperature,
      stream,
    };
    if (shouldSendMaxOutputTokens(this.runtime.config)) {
      payload.max_tokens = this.runtime.config.MaxOutputTokens;
    }
    return payload;
  }

  private authHeaders(): HeadersInit {
    return {
      "x-api-key": this.runtime.config.ApiKey,
      "anthropic-version": this.runtime.config.ApiVersion,
      ...this.runtime.config.Headers,
    };
  }
}

function projectClaudeContent(
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>,
): unknown {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text ?? "" };
    const dataUri = part.image_url?.url ?? "";
    const match = /^data:([^;]+);base64,(.*)$/su.exec(dataUri);
    if (!match) return { type: "text", text: "[image attachment unavailable]" };
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: match[1],
        data: match[2],
      },
    };
  });
}

function readMessageText(content: string | Array<{ type: string; text?: string }>): string {
  return typeof content === "string"
    ? content
    : content.flatMap((part) => (part.type === "text" ? [part.text ?? ""] : [])).join("");
}

function projectClaudeUsage(usage: z.infer<typeof ClaudeUsageSchema>): AgentModelUsageValue | undefined {
  if (!usage) return undefined;
  return createProviderReportedUsage({
    inputTokens: projectModelUsageNumber(usage.input_tokens),
    outputTokens: projectModelUsageNumber(usage.output_tokens),
    cacheReadTokens: projectModelUsageNumber(usage.cache_read_input_tokens),
    cacheWriteTokens: projectModelUsageNumber(usage.cache_creation_input_tokens),
  });
}
