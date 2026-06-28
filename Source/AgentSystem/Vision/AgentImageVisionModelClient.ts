import { z } from "zod";
import { createModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import { rawPathSegment } from "../ModelEndpoints/ModelHttpClient.js";
import { ModelHttpClient } from "../ModelEndpoints/ModelHttpClient.js";
import { shouldSendMaxOutputTokens } from "../ModelEndpoints/ModelPayloadOptions.js";
import type { AgentImageVisionRequest, AgentImageVisionResponse } from "./AgentImageVisionTypes.js";

const TextPartSchema = z.object({
  text: z.string().optional(),
}).passthrough();

const OpenAiResponsesBodySchema = z.object({
  output_text: z.string().optional(),
  output: z.array(z.object({
    content: z.array(TextPartSchema).optional(),
  }).passthrough()).optional(),
}).passthrough();

const OpenAiChatBodySchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.union([
        z.string(),
        z.array(TextPartSchema),
      ]).nullish(),
    }).passthrough().optional(),
  }).passthrough()).optional(),
}).passthrough();

const ClaudeBodySchema = z.object({
  content: z.array(z.object({
    type: z.string().optional(),
    text: z.string().optional(),
  }).passthrough()).optional(),
}).passthrough();

const GoogleBodySchema = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(TextPartSchema).optional(),
    }).passthrough().optional(),
  }).passthrough()).optional(),
}).passthrough();

export class AgentImageVisionModelClient {
  async complete(request: AgentImageVisionRequest): Promise<AgentImageVisionResponse> {
    const metadata = createModelProviderMetadata(request.provider);
    const http = new ModelHttpClient(request.provider, metadata);
    const text = await this.completeByEndpoint(request, http);
    return {
      text,
      provider: {
        id: request.provider.Id,
        endpoint: request.provider.Endpoint,
        model: request.provider.Model,
      },
    };
  }

  private completeByEndpoint(
    request: AgentImageVisionRequest,
    http: ModelHttpClient,
  ): Promise<string> {
    switch (request.provider.Endpoint) {
      case "Responses":
        return this.completeOpenAiResponses(request, http);
      case "ChatCompletions":
        return this.completeOpenAiChat(request, http);
      case "ClaudeMessages":
        return this.completeClaude(request, http);
      case "GoogleGenerateContent":
        return this.completeGoogle(request, http);
    }
  }

  private async completeOpenAiResponses(
    request: AgentImageVisionRequest,
    http: ModelHttpClient,
  ): Promise<string> {
    const payload: Record<string, unknown> = {
      model: request.provider.Model,
      input: [
        {
          role: "system",
          content: request.systemPrompt,
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: request.prompt,
            },
            {
              type: "input_image",
              image_url: dataUri(request),
            },
          ],
        },
      ],
      temperature: request.provider.Temperature,
    };
    if (shouldSendMaxOutputTokens(request.provider)) {
      payload.max_output_tokens = request.provider.MaxOutputTokens;
    }

    const body = OpenAiResponsesBodySchema.parse(
      await http.postJson(["responses"], payload, openAiHeaders(request), {
        signal: request.signal,
      }),
    );
    return body.output_text ?? body.output
      ?.flatMap((output) => output.content ?? [])
      .map((content) => content.text ?? "")
      .join("") ?? "";
  }

  private async completeOpenAiChat(
    request: AgentImageVisionRequest,
    http: ModelHttpClient,
  ): Promise<string> {
    const payload: Record<string, unknown> = {
      model: request.provider.Model,
      messages: [
        {
          role: "system",
          content: request.systemPrompt,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: request.prompt,
            },
            {
              type: "image_url",
              image_url: {
                url: dataUri(request),
              },
            },
          ],
        },
      ],
      temperature: request.provider.Temperature,
    };
    if (shouldSendMaxOutputTokens(request.provider)) {
      payload.max_tokens = request.provider.MaxOutputTokens;
    }

    const body = OpenAiChatBodySchema.parse(
      await http.postJson(["chat", "completions"], payload, openAiHeaders(request), {
        signal: request.signal,
      }),
    );
    return readTextContent(body.choices?.[0]?.message?.content);
  }

  private async completeClaude(
    request: AgentImageVisionRequest,
    http: ModelHttpClient,
  ): Promise<string> {
    const payload: Record<string, unknown> = {
      model: request.provider.Model,
      system: request.systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: request.prompt,
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: request.mime,
                data: request.base64,
              },
            },
          ],
        },
      ],
      temperature: request.provider.Temperature,
    };
    if (shouldSendMaxOutputTokens(request.provider)) {
      payload.max_tokens = request.provider.MaxOutputTokens;
    }

    const body = ClaudeBodySchema.parse(
      await http.postJson(["messages"], payload, {
        "x-api-key": request.provider.ApiKey,
        "anthropic-version": request.provider.ApiVersion,
        ...request.provider.Headers,
      }, {
        signal: request.signal,
      }),
    );
    return body.content
      ?.filter((content) => content.type === "text")
      .map((content) => content.text ?? "")
      .join("") ?? "";
  }

  private async completeGoogle(
    request: AgentImageVisionRequest,
    http: ModelHttpClient,
  ): Promise<string> {
    const generationConfig: Record<string, unknown> = {
      temperature: request.provider.Temperature,
    };
    if (shouldSendMaxOutputTokens(request.provider)) {
      generationConfig.maxOutputTokens = request.provider.MaxOutputTokens;
    }

    const body = GoogleBodySchema.parse(
      await http.postJson(
        ["models", rawPathSegment(`${request.provider.Model}:generateContent`)],
        {
          systemInstruction: {
            parts: [{ text: request.systemPrompt }],
          },
          contents: [
            {
              role: "user",
              parts: [
                { text: request.prompt },
                {
                  inlineData: {
                    mimeType: request.mime,
                    data: request.base64,
                  },
                },
              ],
            },
          ],
          generationConfig,
        },
        {
          "x-goog-api-key": request.provider.ApiKey,
          ...request.provider.Headers,
        },
        {
          signal: request.signal,
        },
      ),
    );
    return body.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("") ?? "";
  }
}

function openAiHeaders(request: AgentImageVisionRequest): HeadersInit {
  return {
    Authorization: `Bearer ${request.provider.ApiKey}`,
    ...request.provider.Headers,
  };
}

function dataUri(request: AgentImageVisionRequest): string {
  return `data:${request.mime};base64,${request.base64}`;
}

function readTextContent(value: string | Array<{ text?: string | null }> | null | undefined): string {
  return typeof value === "string"
    ? value
    : value?.map((item) => item.text ?? "").join("") ?? "";
}
