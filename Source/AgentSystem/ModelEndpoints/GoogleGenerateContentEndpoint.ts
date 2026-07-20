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
import { projectOpenAiCompatibleTextMessages } from "./OpenAiCompatibleMessageProjector.js";
import { createProviderReportedUsage, type AgentModelUsageValue } from "./AgentModelUsage.js";

const GoogleUsageSchema = z
  .object({
    promptTokenCount: z.number().optional(),
    candidatesTokenCount: z.number().optional(),
    totalTokenCount: z.number().optional(),
    cachedContentTokenCount: z.number().optional(),
    thoughtsTokenCount: z.number().optional(),
  })
  .passthrough();

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
    usageMetadata: GoogleUsageSchema.optional(),
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

    return { text: readGoogleText(body), usage: projectGoogleUsage(body.usageMetadata) };
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
    const messages = projectOpenAiCompatibleTextMessages(request, {
      developerRole: "system",
    });
    const system = messages
      .filter((message) => message.role === "system" || message.role === "developer")
      .map((message) => message.content)
      .join("\n\n");

    return {
      systemInstruction: {
        parts: [{ text: system }],
      },
      contents: messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({
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

function projectGoogleUsage(usage: z.infer<typeof GoogleUsageSchema> | undefined): AgentModelUsageValue | undefined {
  if (!usage) return undefined;
  const cacheReadTokens = usage.cachedContentTokenCount;
  const thoughtsTokens = usage.thoughtsTokenCount;
  return createProviderReportedUsage({
    inputTokens:
      usage.promptTokenCount === undefined ? undefined : Math.max(0, usage.promptTokenCount - (cacheReadTokens ?? 0)),
    outputTokens:
      usage.candidatesTokenCount === undefined && thoughtsTokens === undefined
        ? undefined
        : (usage.candidatesTokenCount ?? 0) + (thoughtsTokens ?? 0),
    totalTokens: usage.totalTokenCount,
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
