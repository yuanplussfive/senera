import {
  createModels,
  createProvider,
  type ImageContent,
  type ImageModel,
  type ImagesContext,
  type ImagesOptions,
  type ProviderImages,
  type AssistantImages,
} from "@earendil-works/pi-ai";
import { generateImages as generateOpenRouterImages } from "@earendil-works/pi-ai/api/openrouter-images";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { AgentImageGenerationOptionsSchema, type AgentImageGenerationOptions } from "./AgentImageGenerationContract.js";
import { createAgentOpenAIImagesAdapter } from "./AgentOpenAIImagesAdapter.js";
import { assertAgentModelRequirements } from "../ModelEndpoints/AgentModelRequirements.js";
import { AgentModelRequestRequirements } from "../Core/AgentModelCapabilityContract.js";
import { priceAgentPiUsage, projectAgentPiModelPrices } from "../ModelEndpoints/AgentModelPricing.js";
import { projectAgentPiUsage } from "../ModelEndpoints/AgentPiModelUsage.js";
import { recordActiveAgentModelUsage } from "../ModelEndpoints/AgentModelUsage.js";
import { throwAbortReason, awaitWithAbortSignal } from "../Core/AgentCancellation.js";
import {
  collectAgentProviderDiagnosticSecrets,
  startAgentProviderStreamCapture,
} from "../Diagnostics/AgentProviderStreamDiagnostics.js";
import {
  resolveAgentModelResponseBudget,
  AgentModelResponseBudgetError,
} from "../ModelEndpoints/ModelResponseBudget.js";
import { isAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import { ModelRequestTimeoutError, normalizeModelHttpError } from "../ModelEndpoints/ModelHttpErrors.js";

export interface AgentImageGenerationRequest {
  readonly context: ImagesContext;
  readonly options?: AgentImageGenerationOptions;
  readonly mask?: ImageContent;
  readonly requestId?: string;
  readonly signal?: AbortSignal;
  readonly download: (url: string, signal?: AbortSignal) => Promise<ImageContent>;
}

/** One Pi image operation shared by ordinary tools and composed tool calls. */
export class AgentImageGenerationClient {
  constructor(private readonly configuration: ResolvedAgentModelProviderConfig) {}

  async generate(input: AgentImageGenerationRequest): Promise<AssistantImages> {
    const configuration = this.configuration;
    assertAgentModelRequirements(configuration, AgentModelRequestRequirements.ImageOutput);
    const declaration = configuration.ImageGeneration;
    if (!declaration) throw new Error(`Model ${configuration.Id} requires an explicit ImageGeneration.Api.`);
    if (!configuration.ApiKey) throw new Error(`Configure an API key for image model ${configuration.Id}.`);
    const hasImages = input.context.input.some((part) => part.type === "image");
    if (hasImages && !declaration.Editing) throw new Error(`Model ${configuration.Id} does not declare image editing.`);
    if (input.mask && (!hasImages || !declaration.Mask))
      throw new Error(`Model ${configuration.Id} does not support this mask request.`);
    const imageOptions = AgentImageGenerationOptionsSchema.parse(input.options ?? {});
    const allowed =
      declaration.Api === "openrouter-images"
        ? new Set(["aspectRatio", "imageSize"])
        : new Set(["size", "quality", "n", "outputFormat", "outputCompression", "background", "moderation"]);
    const unsupported = Object.keys(imageOptions).filter((key) => !allowed.has(key));
    if (unsupported.length)
      throw new Error(`${declaration.Api} does not support image options: ${unsupported.join(", ")}.`);
    if (
      imageOptions.outputCompression !== undefined &&
      imageOptions.outputFormat !== "jpeg" &&
      imageOptions.outputFormat !== "webp"
    ) {
      throw new Error("outputCompression requires jpeg or webp output.");
    }
    throwAbortReason(input.signal);
    const model: ImageModel<string> = {
      type: "image",
      api: declaration.Api,
      provider: configuration.ProviderId,
      id: configuration.Model,
      name: configuration.Model,
      baseUrl: configuration.BaseUrl,
      headers: configuration.Headers,
      input: declaration.Editing ? ["text", "image"] : ["text"],
      output: ["image", "text"],
      cost: projectAgentPiModelPrices(configuration.Pricing),
    };
    const capture = startAgentProviderStreamCapture({
      invocationId: input.requestId,
      stage: "image.generate",
      providerId: configuration.Id,
      model,
      secrets: collectAgentProviderDiagnosticSecrets({
        apiKeys: [configuration.ApiKey],
        headers: [configuration.Headers],
      }),
    });
    const controller = new AbortController();
    const signals = [input.signal, controller.signal].filter((signal): signal is AbortSignal => signal !== undefined);
    const signal = AbortSignal.any(signals);
    const timeout =
      configuration.MaxRequestMs > 0
        ? setTimeout(
            () => controller.abort(normalizeModelHttpError(configuration, new ModelRequestTimeoutError("max_request"))),
            configuration.MaxRequestMs,
          )
        : undefined;
    let status: "completed" | "failed" | "aborted" = "failed";
    let failure: unknown;
    try {
      const models = createModels();
      const adapter: ProviderImages =
        declaration.Api === "openrouter-images"
          ? { generateImages: generateOpenRouterImages }
          : createAgentOpenAIImagesAdapter({
              options: imageOptions,
              mask: input.mask,
              download: input.download,
            });
      models.setProvider(
        createProvider({
          id: model.provider,
          name: `Senera images (${model.provider})`,
          models: [model],
          auth: {
            apiKey: {
              name: "Senera model credential",
              resolve: async () => ({ auth: { apiKey: configuration.ApiKey }, source: "Senera model configuration" }),
            },
          },
          images: { [model.api]: adapter },
        }),
      );
      const options: ImagesOptions = {
        signal,
        timeoutMs: configuration.TimeoutMs,
        maxRetries: configuration.MaxNetworkRetries,
        maxRetryDelayMs: configuration.RetryAfterMaxDelayMs,
        fetch: boundedImageFetch(configuration, controller),
        ...(declaration.Api === "openrouter-images"
          ? {
              onPayload: (payload: unknown) => {
                if (!isAgentUnknownRecord(payload)) throw new Error("Pi image payload must be an object.");
                return {
                  ...payload,
                  ...(Object.keys(imageOptions).length
                    ? { image_config: { aspect_ratio: imageOptions.aspectRatio, image_size: imageOptions.imageSize } }
                    : {}),
                };
              },
            }
          : {}),
      };
      const result = await awaitWithAbortSignal(models.generateImages(model, input.context, options), signal);
      capture?.observeResult(result);
      if (result.usage) {
        priceAgentPiUsage(result.usage, configuration.Pricing);
        const usage = projectAgentPiUsage(result.usage);
        if (usage) recordActiveAgentModelUsage({ stage: "image.generate", usage });
      }
      throwAbortReason(signal);
      if (result.stopReason !== "stop") throw new Error(result.errorMessage ?? "Image generation did not complete.");
      if (!result.output.some((part) => part.type === "image"))
        throw new Error(
          "The image endpoint returned no image blocks. Check the configured image protocol and provider response.",
        );
      status = "completed";
      return result;
    } catch (error) {
      failure = signal.aborted ? signal.reason : error;
      status = input.signal?.aborted ? "aborted" : "failed";
      throw failure;
    } finally {
      if (timeout) clearTimeout(timeout);
      controller.abort();
      capture?.finish(status, failure);
    }
  }
}

/** Bound the actual JSON body, including error responses and Base64 payloads, before SDK parsing. */
function boundedImageFetch(configuration: ResolvedAgentModelProviderConfig, controller: AbortController): typeof fetch {
  const maximum = resolveAgentModelResponseBudget(configuration).maxResponseBytes;
  return async (request, options) => {
    const response = await fetch(request, options);
    const reader = response.body?.getReader();
    if (!reader) return response;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maximum) {
          const error = new AgentModelResponseBudgetError("response_bytes", maximum, size);
          // A deterministic response limit must never become an SDK network retry.
          controller.abort(error);
          throw error;
        }
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    return new Response(Buffer.concat(chunks), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
