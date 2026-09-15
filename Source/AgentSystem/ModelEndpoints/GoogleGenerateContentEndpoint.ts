import { z } from "zod";
import type { AgentLanguageModelRequest, AgentLanguageModelStream } from "./AgentLanguageModel.js";
import type {
  EndpointRuntime,
  ModelHttpPathSegment,
  TextGenerationEndpoint,
  TextGenerationEndpointResult,
} from "./ModelEndpointTypes.js";
import { rawPathSegment } from "./ModelHttpClient.js";
import { shouldSendMaxOutputTokens } from "./ModelPayloadOptions.js";
import { projectOpenAiCompatibleMessages } from "./OpenAiCompatibleMessageProjector.js";
import { createProviderReportedUsage, type AgentModelUsageValue } from "./AgentModelUsage.js";
import { ModelUsageNumberWireSchema, projectModelUsageNumber } from "./ModelUsageWireSchema.js";
import { createAgentModelCompletionMetadata } from "./AgentModelCompletion.js";

const GoogleUsageSchema = z
  .object({
    promptTokenCount: ModelUsageNumberWireSchema,
    candidatesTokenCount: ModelUsageNumberWireSchema,
    totalTokenCount: ModelUsageNumberWireSchema,
    cachedContentTokenCount: ModelUsageNumberWireSchema,
    thoughtsTokenCount: ModelUsageNumberWireSchema,
  })
  .passthrough()
  .nullish();

const GooglePartSchema = z
  .object({
    text: z.string().optional(),
  })
  .passthrough();

const GoogleGenerateContentBodySchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            finishReason: z.string().nullish(),
            content: z
              .object({
                parts: z.array(GooglePartSchema).optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
    usageMetadata: GoogleUsageSchema,
  })
  .passthrough();

export class GoogleGenerateContentEndpoint implements TextGenerationEndpoint {
  constructor(private readonly runtime: EndpointRuntime) {}

  async complete(request: AgentLanguageModelRequest): Promise<TextGenerationEndpointResult> {
    const body = GoogleGenerateContentBodySchema.parse(
      await this.runtime.http.postJson(this.path("generateContent"), this.buildPayload(request), this.authHeaders(), {
        signal: request.signal,
      }),
    );

    return {
      text: readGoogleText(body),
      usage: projectGoogleUsage(body.usageMetadata),
      completion: projectGoogleCompletion(body),
    };
  }

  async stream(request: AgentLanguageModelRequest): Promise<AgentLanguageModelStream> {
    return this.runtime.http.postSseStream(
      this.path("streamGenerateContent"),
      this.buildPayload(request),
      this.authHeaders(),
      (event) => {
        const body = GoogleGenerateContentBodySchema.parse(event);
        return {
          textDelta: readGoogleText(body),
          usage: projectGoogleUsage(body.usageMetadata),
          completion: projectGoogleCompletion(body),
        };
      },
      { alt: "sse" },
      { signal: request.signal },
    );
  }

  private buildPayload(request: AgentLanguageModelRequest): Record<string, unknown> {
    const generationConfig: Record<string, unknown> = {
      temperature: this.runtime.config.Temperature,
    };
    if (shouldSendMaxOutputTokens(this.runtime.config)) {
      generationConfig.maxOutputTokens = this.runtime.config.MaxOutputTokens;
    }
    const messages = projectOpenAiCompatibleMessages(request, {
      developerRole: "system",
    });
    const system = messages
      .filter((message) => message.role === "system" || message.role === "developer")
      .map((message) => readMessageText(message.content))
      .join("\n\n");

    return {
      systemInstruction: {
        parts: [{ text: system }],
      },
      contents: messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: projectGoogleParts(message.content),
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

function projectGoogleParts(
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>,
): unknown[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((part) => {
    if (part.type === "text") return { text: part.text ?? "" };
    const dataUri = part.image_url?.url ?? "";
    const match = /^data:([^;]+);base64,(.*)$/su.exec(dataUri);
    if (!match) return { text: "[image attachment unavailable]" };
    return {
      inlineData: {
        mimeType: match[1],
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

function projectGoogleUsage(usage: z.infer<typeof GoogleUsageSchema>): AgentModelUsageValue | undefined {
  if (!usage) return undefined;
  const cacheReadTokens = projectModelUsageNumber(usage.cachedContentTokenCount);
  const thoughtsTokens = projectModelUsageNumber(usage.thoughtsTokenCount);
  const promptTokens = projectModelUsageNumber(usage.promptTokenCount);
  const candidateTokens = projectModelUsageNumber(usage.candidatesTokenCount);
  return createProviderReportedUsage({
    inputTokens: promptTokens === undefined ? undefined : Math.max(0, promptTokens - (cacheReadTokens ?? 0)),
    outputTokens:
      candidateTokens === undefined && thoughtsTokens === undefined
        ? undefined
        : (candidateTokens ?? 0) + (thoughtsTokens ?? 0),
    totalTokens: projectModelUsageNumber(usage.totalTokenCount),
    cacheReadTokens,
    reasoningTokens: thoughtsTokens,
  });
}

function readGoogleText(body: z.infer<typeof GoogleGenerateContentBodySchema>): string {
  return (
    body.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("") ?? ""
  );
}

function projectGoogleCompletion(
  body: z.infer<typeof GoogleGenerateContentBodySchema>,
): ReturnType<typeof createAgentModelCompletionMetadata> {
  return createAgentModelCompletionMetadata({
    finishReason: body.candidates?.[0]?.finishReason ?? undefined,
  });
}
