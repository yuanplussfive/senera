import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import type {
  AgentImageInputCapabilities,
  AgentImageNormalizationService,
} from "../Images/AgentImageNormalizationService.js";
import { isAgentNormalizableRasterImageMime } from "../Images/AgentImageNormalizationService.js";

export interface AgentPiImageModelInput {
  readonly input: readonly string[];
}

export interface AgentPiImageAttachmentProjectionOptions {
  readonly attachments?: readonly AgentUploadAttachment[];
  readonly model?: AgentPiImageModelInput;
  readonly uploadStore?: Partial<Pick<AgentUploadStore, "resolveImageForModel">>;
  readonly imageNormalization?: Pick<AgentImageNormalizationService, "normalize">;
  readonly imageInputCapabilities?: AgentImageInputCapabilities;
  readonly signal?: AbortSignal;
}

/**
 * Loads uploaded images for Pi's multimodal providers.
 *
 * The attachment remains a Senera resource in the conversation regardless of
 * whether it is projected to the provider. BAML planning receives the same
 * visual inputs through its provider-neutral message attachment contract.
 */
export async function projectAgentPiImageAttachments(
  options: AgentPiImageAttachmentProjectionOptions,
): Promise<ImageContent[]> {
  if (!options.model || !canProjectImages(options.model) || !options.attachments?.length) {
    return [];
  }
  if (!options.uploadStore?.resolveImageForModel || !options.imageNormalization || !options.imageInputCapabilities) {
    throw new Error("Vision attachment projection requires the shared image normalization runtime.");
  }

  const images: ImageContent[] = [];
  for (const attachment of options.attachments) {
    if (!isNormalizableRasterAttachment(attachment)) continue;

    const image = await options.uploadStore.resolveImageForModel({
      resourceUri: attachment.resourceUri,
      target: options.imageInputCapabilities,
      normalizer: options.imageNormalization,
      signal: options.signal,
    });
    if (!image) {
      throw new Error(`Image attachment resource is unavailable: ${attachment.resourceUri}`);
    }
    images.push({
      type: "image",
      data: image.bytes.toString("base64"),
      mimeType: image.mime,
    });
  }
  return images;
}

function isNormalizableRasterAttachment(attachment: AgentUploadAttachment): boolean {
  return isAgentNormalizableRasterImageMime(attachment.mime);
}

function canProjectImages(model: AgentPiImageModelInput): boolean {
  return model.input.includes("image");
}
