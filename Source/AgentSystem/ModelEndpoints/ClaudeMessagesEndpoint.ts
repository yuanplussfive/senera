import { z } from "zod";
import type { AgentLanguageModelRequest, AgentLanguageModelStream } from "./AgentLanguageModel.js";
import type {
  EndpointRuntime,
  TextGenerationEndpoint,
  TextGenerationEndpointResult,
} from "./ModelEndpointTypes.js";
import { shouldSendMaxOutputTokens } from "./ModelPayloadOptions.js";
import { projectOpenAiCompatibleTextMessages } from "./OpenAiCompatibleMessageProjector.js";

const ClaudeContentBlockSchema = z.object({
  type: z.string().optional(),
  text: z.string().optional(),
}).passthrough();

const ClaudeMessageBodySchema = z.object({
  content: z.array(ClaudeContentBlockSchema).optional(),
}).passthrough();

const ClaudeStreamEventSchema = z.object({
  type: z.string().optional(),
  delta: z.object({
    text: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

export class ClaudeMessagesEndpoint implements TextGenerationEndpoint {
  constructor(private readonly runtime: EndpointRuntime) {}

  async complete(request: AgentLanguageModelRequest): Promise<TextGenerationEndpointResult> {
    const body = ClaudeMessageBodySchema.parse(
      await this.runtime.http.postJson(
        ["messages"],
        this.buildPayload(request, false),
        this.authHeaders(),
        { signal: request.signal },
      ),
    );

    return {
      text: body.content
        ?.filter((content) => content.type === "text")
        .map((content) => content.text ?? "")
        .join("") ?? "",
    };
  }

  async stream(request: AgentLanguageModelRequest): Promise<AgentLanguageModelStream> {
    return this.runtime.http.postSseStream(
      ["messages"],
      this.buildPayload(request, true),
      this.authHeaders(),
      (event) => {
        const parsed = ClaudeStreamEventSchema.parse(event);
        return parsed.type === "content_block_delta" ? parsed.delta?.text ?? "" : "";
      },
      undefined,
      { signal: request.signal },
    );
  }

  private buildPayload(request: AgentLanguageModelRequest, stream: boolean): Record<string, unknown> {
    const messages = projectOpenAiCompatibleTextMessages(request, {
      developerRole: "system",
    });
    const system = messages
      .filter((message) => message.role === "system" || message.role === "developer")
      .map((message) => message.content)
      .join("\n\n");
    const payload: Record<string, unknown> = {
      model: this.runtime.config.Model,
      system,
      messages: messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({
        role: message.role,
        content: message.content,
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
