import type { ImageContent } from "@earendil-works/pi-ai";
import { fileTypeFromBuffer } from "file-type";
import { isAgentBase64 } from "../Core/AgentBase64.js";
import { resolveModelProviderCatalog } from "../AgentDefaults.js";
import { AgentImageGenerationClient } from "../Images/AgentImageGenerationClient.js";
import { type AgentImageGenerationOptions } from "../Images/AgentImageGenerationContract.js";
import type { AgentImageNormalizationService } from "../Images/AgentImageNormalizationService.js";
import { AgentImageToolsExtensionConfigurationSchema } from "../Images/AgentImageToolsConfiguration.js";
import { readAgentImageToolOriginal, resolveAgentImageToolInputs } from "./AgentImageToolInputs.js";
import { defineSystemTool, systemToolArguments, systemToolExecutionResult } from "./AgentSystemToolDefinition.js";
import type { AgentLocalResourceSource, AgentResourceSource } from "../Resources/AgentResourceSource.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";

interface ImageGenerateArguments {
  readonly prompt: string;
  readonly model?: string;
  readonly images?: readonly AgentResourceSource[];
  readonly mask?: AgentLocalResourceSource;
  readonly options?: AgentImageGenerationOptions;
}

export function createImageGenerateSystemTools(
  extensionConfiguration?: Record<string, unknown>,
  imageNormalization?: Pick<AgentImageNormalizationService, "normalize">,
) {
  const configuration = AgentImageToolsExtensionConfigurationSchema.parse(extensionConfiguration ?? {});
  const listModels = (context: AgentHostToolContext) => {
    const catalog = resolveModelProviderCatalog(context.config);
    return catalog
      .list()
      .filter((model) => model.capabilities.ImageOutput)
      .map((model) => catalog.resolve(model.id))
      .filter((model) => model.ImageGeneration);
  };
  const execute = async (arguments_: Record<string, unknown>, context: AgentHostToolContext) => {
    const input = systemToolArguments<ImageGenerateArguments>(arguments_);
    if (!context.resourcePublisher) throw new Error("Image generation requires the host resource publisher.");
    const catalog = resolveModelProviderCatalog(context.config);
    const selected = input.model?.trim() || configuration.generation.modelProviderId;
    const available = listModels(context);
    if (!selected && available.length !== 1) {
      throw new Error("Select an image model in the image settings or pass a model ID returned by ImageModels.");
    }
    const provider = selected ? catalog.resolve(selected) : available[0]!;
    if (!provider.Capabilities?.ImageOutput || !provider.ImageGeneration)
      throw new Error(`Model ${provider.Id} requires ImageOutput and ImageGeneration.Api.`);
    if (input.images?.length && !provider.ImageGeneration.Editing)
      throw new Error(`Model ${provider.Id} does not declare image editing.`);
    if (input.mask && (!input.images?.length || !provider.ImageGeneration.Mask))
      throw new Error(`Model ${provider.Id} does not declare mask editing or no reference image was supplied.`);
    context.deadline?.extendTo?.(
      Math.max(provider.MaxRequestMs, provider.TimeoutMs) +
        (input.images?.length ?? 0) * configuration.remote.requestTimeoutMs,
    );
    const images = input.images?.length
      ? await resolveAgentImageToolInputs(
          { images: input.images, preserveOriginal: Boolean(input.mask) },
          context,
          configuration,
          provider,
          imageNormalization,
        )
      : [];
    let mask: ImageContent | undefined;
    if (input.mask) {
      const image = await readAgentImageToolOriginal(input.mask, context, configuration);
      if (image.mime !== "image/png")
        throw new Error(
          "An edit mask must be a PNG image. The image endpoint validates its alpha channel and dimensions.",
        );
      mask = { type: "image", mimeType: image.mime, data: image.base64 };
    }
    let downloadedBytes = 0;
    const result = await new AgentImageGenerationClient(provider).generate({
      context: {
        input: [
          { type: "text", text: input.prompt },
          ...images.map((image): ImageContent => ({ type: "image", data: image.base64, mimeType: image.mime })),
        ],
      },
      options: input.options,
      mask,
      requestId: context.requestId,
      signal: context.signal,
      download: async (url, signal) => {
        const image = await readAgentImageToolOriginal(
          { kind: "http_url", url },
          { ...context, signal },
          configuration,
        );
        downloadedBytes += image.size;
        if (downloadedBytes > configuration.input.maxTotalImageBytes)
          throw new Error("Generated image downloads exceeded the configured total image byte limit.");
        return { type: "image", mimeType: image.mime, data: image.base64 };
      },
    });
    const resources = [];
    for (const part of result.output) {
      if (part.type !== "image") continue;
      if (!isAgentBase64(part.data)) throw new Error("The image endpoint returned invalid image Base64.");
      const bytes = Buffer.from(part.data, "base64");
      const detected = await fileTypeFromBuffer(bytes);
      if (!detected?.mime.startsWith("image/"))
        throw new Error("The image endpoint returned data that is not a supported image.");
      const resource = await context.resourcePublisher.publishBytes({
        bytes,
        mime: detected.mime,
        name: `image.${detected.ext}`,
        retention: "persistent",
        ...(context.sessionId && context.requestId
          ? { owner: { sessionId: context.sessionId, requestId: context.requestId } }
          : {}),
        signal: context.signal,
      });
      resources.push(resource);
    }
    const output = {
      model: provider.Id,
      images: resources.map((resource) => ({
        source: { kind: "local_path" as const, path: resource.localPath },
        name: resource.name,
        mime: resource.mime,
        size: resource.size,
      })),
      ...(result.output.some((part) => part.type === "text")
        ? {
            text: result.output
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n"),
          }
        : {}),
    };
    return systemToolExecutionResult(output, {
      artifactPayload: {
        rawResponse: {
          ...output,
          resources: resources.map((resource) => ({
            uri: resource.resourceUri,
            name: resource.name,
            mime: resource.mime,
            size: resource.size,
          })),
        },
        evidence: resources.map((resource) => ({
          key: `resource:${resource.resourceUri}`,
          kind: "resource",
          locator: resource.resourceUri,
          display: resource.name,
          metadata: {
            contentType: "resource",
            resourceUri: resource.resourceUri,
            name: resource.name,
            mimeType: resource.mime,
            size: resource.size,
            sha256: resource.sha256,
          },
        })),
      },
    });
  };
  return [
    defineSystemTool({
      capability: "system.tool.agent-image-tools.ImageGenerate",
      execute: async (input, context) => (await execute(input, context)).result,
      executeWithArtifacts: execute,
    }),
    defineSystemTool({
      capability: "system.tool.agent-image-tools.ImageModels",
      execute: (_input, context) => ({
        models: listModels(context).map((model) => ({
          id: model.Id,
          model: model.Model,
          api: model.ImageGeneration!.Api,
          editing: model.ImageGeneration!.Editing ?? false,
          mask: model.ImageGeneration!.Mask ?? false,
        })),
      }),
    }),
  ];
}
