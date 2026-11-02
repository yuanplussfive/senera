import OpenAI, { toFile } from "openai";
import type {
  ImageEditParamsNonStreaming,
  ImageGenerateParamsNonStreaming,
  ImagesResponse,
} from "openai/resources/images";
import type { AssistantImages, ImageContent, ProviderImages, Usage } from "@earendil-works/pi-ai";
import { retryProviderRequest } from "@earendil-works/pi-ai/utils/provider-retry";
import { errorMessage } from "../Core/AgentErrors.js";
import { isAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import type { AgentImageGenerationOptions } from "./AgentImageGenerationContract.js";

/** OpenAI Images is a separate, declared protocol, registered through Pi's image-provider contract. */
export function createAgentOpenAIImagesAdapter(input: {
  readonly options: AgentImageGenerationOptions;
  readonly mask?: ImageContent;
  readonly download: (url: string, signal?: AbortSignal) => Promise<ImageContent>;
}): ProviderImages {
  return {
    async generateImages(model, context, options) {
      const result: AssistantImages = {
        api: model.api,
        provider: model.provider,
        model: model.id,
        output: [],
        stopReason: "stop",
        timestamp: Date.now(),
      };
      try {
        const client = new OpenAI({
          apiKey: options?.apiKey || "",
          baseURL: model.baseUrl,
          defaultHeaders: { ...model.headers, ...options?.headers },
          maxRetries: 0,
          timeout: options?.timeoutMs,
          fetch: options?.fetch,
        });
        const prompt = context.input
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        const images = context.input.filter((part) => part.type === "image");
        const body = {
          model: model.id,
          prompt,
          size: input.options.size,
          quality: input.options.quality,
          n: input.options.n,
          output_format: input.options.outputFormat,
          output_compression: input.options.outputCompression,
          background: input.options.background,
          moderation: input.options.moderation,
        };
        const requestOptions = { signal: options?.signal, timeout: options?.timeoutMs };
        const edit = images.length
          ? {
              image: await Promise.all(
                images.map((image, index) =>
                  toFile(Buffer.from(image.data, "base64"), `input-${index}.${image.mimeType.split("/")[1]}`, {
                    type: image.mimeType,
                  }),
                ),
              ),
              ...(input.mask
                ? { mask: await toFile(Buffer.from(input.mask.data, "base64"), "mask.png", { type: "image/png" }) }
                : {}),
            }
          : undefined;
        const response = await retryProviderRequest(
          () =>
            edit
              ? client.images.edit({ ...body, ...edit } as ImageEditParamsNonStreaming, requestOptions).withResponse()
              : client.images.generate(body as ImageGenerateParamsNonStreaming, requestOptions).withResponse(),
          { signal: options?.signal, maxRetries: options?.maxRetries, maxRetryDelayMs: options?.maxRetryDelayMs },
        );
        await options?.onResponse?.(
          { status: response.response.status, headers: Object.fromEntries(response.response.headers) },
          model,
        );
        const usage = projectUsage(response.data);
        if (usage) result.usage = usage;
        for (const image of response.data.data ?? []) {
          if (image.revised_prompt) result.output.push({ type: "text", text: image.revised_prompt });
          if (image.b64_json) {
            result.output.push({
              type: "image",
              mimeType: `image/${input.options.outputFormat ?? "png"}`,
              data: image.b64_json,
            });
          } else if (image.url) {
            result.output.push(await input.download(image.url, options?.signal));
          }
        }
      } catch (error) {
        result.stopReason = options?.signal?.aborted ? "aborted" : "error";
        result.errorMessage = errorMessage(error);
      }
      return result;
    },
  };
}

function projectUsage(response: ImagesResponse): Usage | undefined {
  const raw: unknown = response.usage;
  if (!isAgentUnknownRecord(raw)) return undefined;
  const input = typeof raw.input_tokens === "number" ? raw.input_tokens : undefined;
  const output = typeof raw.output_tokens === "number" ? raw.output_tokens : undefined;
  if (input === undefined || output === undefined) return undefined;
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: typeof raw.total_tokens === "number" ? raw.total_tokens : input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
