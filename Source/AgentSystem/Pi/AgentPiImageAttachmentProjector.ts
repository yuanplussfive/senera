import fs from "node:fs/promises";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import { isAgentInlineImageMime } from "../Uploads/AgentUploadMime.js";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";

export interface AgentPiImageModelInput {
  readonly input: readonly string[];
}

export interface AgentPiImageAttachmentProjectionOptions {
  readonly attachments?: readonly AgentUploadAttachment[];
  readonly model?: AgentPiImageModelInput;
  readonly uploadStore?: Pick<AgentUploadStore, "resolve">;
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
  if (!options.model || !canProjectImages(options.model) || !options.uploadStore || !options.attachments?.length) {
    return [];
  }

  const images: ImageContent[] = [];
  for (const attachment of options.attachments) {
    if (!isAgentInlineImageMime(attachment.mime)) continue;

    const upload = await options.uploadStore.resolve(attachment.resourceUri);
    if (!upload) {
      throw new Error(`Image attachment resource is unavailable: ${attachment.resourceUri}`);
    }

    const mimeType = upload.manifest.mime;
    if (!isAgentInlineImageMime(mimeType)) continue;

    const bytes = await fs.readFile(upload.filePath, { signal: options.signal });
    images.push({
      type: "image",
      data: bytes.toString("base64"),
      mimeType,
    });
  }
  return images;
}

function canProjectImages(model: AgentPiImageModelInput): boolean {
  return model.input.includes("image");
}
