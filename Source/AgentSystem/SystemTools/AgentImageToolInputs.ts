import fs from "node:fs/promises";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { lookup as lookupMime } from "mime-types";
import { sha256Hex } from "../Core/AgentHash.js";
import { throwAbortReason } from "../Core/AgentCancellation.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { resolveAgentModelVisionInputCapabilities } from "../ModelEndpoints/AgentModelVisionInputCapabilities.js";
import {
  AgentImageInputCapabilityViolations,
  resolveAgentImageInputCapabilityViolation,
  type AgentImageInputCapabilities,
  type AgentImageNormalizationService,
} from "../Images/AgentImageNormalizationService.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { resolveAgentSystemLocalResource } from "./AgentSystemResource.js";
import type { AgentResourceSource } from "../Resources/AgentResourceSource.js";
import { fetchWebResource } from "../Web/AgentWebHttpClient.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";

const ImageReadChunkBytes = 64 * 1024;

export interface AgentImageToolInputPolicy {
  readonly input: {
    readonly maxImageCount: number;
    readonly maxSourceImageBytes: number;
    readonly maxImageBytes: number;
    readonly maxTotalImageBytes: number;
  };
  readonly remote: {
    readonly maxRedirects: number;
    readonly maxUrlLength: number;
    readonly requestTimeoutMs: number;
    readonly maxOperationTimeoutMs: number;
    readonly allowPrivateNetworks: boolean;
    readonly allowSyntheticProxyAddresses: boolean;
    readonly userAgent: string;
  };
}

export interface ResolvedImageInput {
  readonly source: AgentResourceSource;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly sha256: string;
  readonly base64: string;
}

export async function resolveAgentImageToolInputs(
  input: {
    readonly images: readonly AgentResourceSource[];
    readonly timeoutMs?: number;
    readonly preserveOriginal?: boolean;
  },
  context: AgentHostToolContext,
  configuration: AgentImageToolInputPolicy,
  provider: ResolvedAgentModelProviderConfig,
  imageNormalization: Pick<AgentImageNormalizationService, "normalize"> | undefined,
): Promise<ResolvedImageInput[]> {
  if (input.images.length > configuration.input.maxImageCount) {
    throw new AgentLocalizedError("vision.imageCountExceeded", {
      count: input.images.length,
      maxImageCount: configuration.input.maxImageCount,
    });
  }

  const images: ResolvedImageInput[] = [];
  const target = constrainTargetBytes(
    resolveAgentModelVisionInputCapabilities(provider),
    configuration.input.maxImageBytes,
  );
  let totalImageBytes = 0;
  for (const source of input.images) {
    const image = input.preserveOriginal
      ? await readAgentImageToolOriginal(source, context, configuration)
      : await resolveImageInput(
          source,
          input.timeoutMs,
          context,
          configuration,
          target,
          requireImageNormalization(imageNormalization),
        );
    if (
      input.preserveOriginal &&
      (image.size > configuration.input.maxImageBytes || !target.supportedMimeTypes.includes(image.mime))
    ) {
      throw new Error(
        "Mask editing requires original reference images within the configured byte and MIME limits. Images cannot be resized or re-encoded with a mask.",
      );
    }
    totalImageBytes += image.size;
    assertTotalImageSize(totalImageBytes, configuration.input.maxTotalImageBytes);
    images.push(image);
  }
  return images;
}

/** Original bytes for pixel-aligned masks and provider image downloads; never resize or re-encode. */
export async function readAgentImageToolOriginal(
  source: AgentResourceSource,
  context: AgentHostToolContext,
  configuration: AgentImageToolInputPolicy,
): Promise<ResolvedImageInput> {
  let bytes: Buffer;
  let name: string;
  let resolvedSource: AgentResourceSource;
  if (source.kind === "http_url") {
    const response = await fetchWebResource(
      source.url,
      {
        ...configuration.remote,
        timeoutMs: configuration.remote.requestTimeoutMs,
        responseMaxBytes: configuration.input.maxSourceImageBytes,
      },
      context.signal,
    );
    if (response.transfer.truncated)
      throw new AgentLocalizedError("vision.imageSourceTooLarge", {
        size: response.transfer.receivedBytes + 1,
        maxSourceImageBytes: configuration.input.maxSourceImageBytes,
      });
    bytes = Buffer.from(response.body);
    name = readImageName(response.url);
    resolvedSource = { kind: "http_url", url: response.url };
  } else {
    const resource = await resolveAgentSystemLocalResource(context, source);
    bytes = await readBoundedImageResource(resource.filePath, configuration.input.maxSourceImageBytes, context.signal);
    name = resource.name;
    resolvedSource = resource.source;
  }
  const mime = (await fileTypeFromBuffer(bytes))?.mime;
  if (!mime?.startsWith("image/")) throw new Error("The supplied resource does not contain a supported image.");
  return {
    source: resolvedSource,
    name,
    mime,
    size: bytes.byteLength,
    sha256: sha256Hex(bytes),
    base64: bytes.toString("base64"),
  };
}

async function resolveImageInput(
  source: AgentResourceSource,
  timeoutMs: number | undefined,
  context: AgentHostToolContext,
  configuration: AgentImageToolInputPolicy,
  target: AgentImageInputCapabilities,
  imageNormalization: Pick<AgentImageNormalizationService, "normalize">,
): Promise<ResolvedImageInput> {
  if (source.kind !== "http_url") {
    const resource = await resolveAgentSystemLocalResource(context, source);
    assertSourceImageSize(resource.size, configuration.input.maxSourceImageBytes);
    const upload =
      resource.origin === "upload" && isImageMime(resource.mime) && context.uploadStore?.resolveImageForModel
        ? await context.uploadStore.resolveImageForModel({
            resourceUri: resource.resourceUri,
            target,
            normalizer: imageNormalization,
            signal: context.signal,
          })
        : undefined;
    if (upload) {
      assertDeliveredImageTarget(upload, target);
      return {
        source: resource.source,
        name: resource.name,
        mime: upload.mime,
        size: upload.size,
        sha256: upload.sha256,
        base64: upload.bytes.toString("base64"),
      };
    }
    const original = await readBoundedImageResource(
      resource.filePath,
      configuration.input.maxSourceImageBytes,
      context.signal,
    );
    const mime = await resolveImageMime(original, resource.mime, resource.name);
    assertImageMime(mime);
    const normalized = await imageNormalization.normalize({
      bytes: original,
      mime,
      sourceSha256: sha256Hex(original),
      target,
      transferSource: true,
      signal: context.signal,
    });
    assertDeliveredImageTarget(normalized, target);
    return {
      source: resource.source,
      name: resource.name,
      mime: normalized.mime,
      size: normalized.bytes.byteLength,
      sha256: normalized.derived ? sha256Hex(normalized.bytes) : normalized.sourceSha256,
      base64: normalized.bytes.toString("base64"),
    };
  }

  const requestTimeoutMs = resolveImageRequestTimeout(timeoutMs, configuration.remote);
  const response = await fetchWebResource(
    source.url,
    {
      maxRedirects: configuration.remote.maxRedirects,
      responseMaxBytes: configuration.input.maxSourceImageBytes,
      timeoutMs: requestTimeoutMs,
      userAgent: configuration.remote.userAgent,
      maxUrlLength: configuration.remote.maxUrlLength,
      allowPrivateNetworks: configuration.remote.allowPrivateNetworks,
      allowSyntheticProxyAddresses: configuration.remote.allowSyntheticProxyAddresses,
    },
    context.signal,
  );
  if (response.transfer.truncated) {
    throw new AgentLocalizedError("vision.imageSourceTooLarge", {
      size: response.transfer.declaredContentLength ?? response.transfer.receivedBytes + 1,
      maxSourceImageBytes: configuration.input.maxSourceImageBytes,
    });
  }
  const mime = await resolveImageMime(response.body, response.contentType, readImageName(response.url));
  assertImageMime(mime);
  const original = Buffer.from(response.body);
  const sourceSha256 = sha256Hex(original);
  const normalized = await imageNormalization.normalize({
    bytes: original,
    mime,
    sourceSha256,
    target,
    transferSource: true,
    signal: context.signal,
  });
  const content = normalized.bytes;
  assertDeliveredImageTarget(normalized, target);
  return {
    source: { kind: "http_url", url: response.url },
    name: readImageName(response.url),
    mime: normalized.mime,
    size: content.byteLength,
    sha256: normalized.derived ? sha256Hex(content) : normalized.sourceSha256,
    base64: content.toString("base64"),
  };
}

function requireImageNormalization(
  imageNormalization: Pick<AgentImageNormalizationService, "normalize"> | undefined,
): Pick<AgentImageNormalizationService, "normalize"> {
  if (imageNormalization) return imageNormalization;
  throw new Error("Image analysis requires the shared image normalization runtime.");
}

async function readBoundedImageResource(
  filePath: string,
  maximumSourceBytes: number,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  throwAbortReason(signal);
  const handle = await fs.open(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    const chunk = Buffer.allocUnsafe(ImageReadChunkBytes);
    for (;;) {
      throwAbortReason(signal);
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      size += bytesRead;
      assertSourceImageSize(size, maximumSourceBytes);
      chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, size);
  } finally {
    await handle.close();
  }
}

function constrainTargetBytes(target: AgentImageInputCapabilities, maximum: number): AgentImageInputCapabilities {
  return {
    ...target,
    maxBytes: target.maxBytes === undefined ? maximum : Math.min(target.maxBytes, maximum),
  };
}

export function resolveImageRequestTimeout(
  requested: number | undefined,
  configuration: AgentImageToolInputPolicy["remote"],
): number {
  if (requested === undefined) return configuration.requestTimeoutMs;
  if (requested > configuration.maxOperationTimeoutMs) {
    throw new Error(
      `Image download timeoutMs must be an integer between 1000 and ${configuration.maxOperationTimeoutMs}.`,
    );
  }
  return requested;
}

async function resolveImageMime(content: Uint8Array, declaredMime: string, name: string): Promise<string> {
  const detected = normalizeMime((await fileTypeFromBuffer(content))?.mime);
  const declared = normalizeMime(declaredMime.split(";", 1)[0]);
  const named = normalizeMime(lookupMime(name) || undefined);
  return detected ?? declared ?? named ?? "application/octet-stream";
}

function assertImageMime(mime: string): void {
  if (!isImageMime(mime)) {
    throw new AgentLocalizedError("vision.imageMimeRequired", { mime });
  }
}

function isImageMime(mime: string): boolean {
  return mime.trim().toLowerCase().startsWith("image/");
}

function assertSourceImageSize(size: number, maxSourceImageBytes: number): void {
  if (size > maxSourceImageBytes) {
    throw new AgentLocalizedError("vision.imageSourceTooLarge", { size, maxSourceImageBytes });
  }
}

function assertDeliveredImageTarget(
  image: {
    readonly mime: string;
    readonly size?: number;
    readonly bytes?: Uint8Array;
    readonly width?: number;
    readonly height?: number;
    readonly animated: boolean;
  },
  target: AgentImageInputCapabilities,
): void {
  const size = image.size ?? image.bytes?.byteLength;
  if (size === undefined) throw new Error("Image normalizer did not provide an image byte length.");
  const violation = resolveAgentImageInputCapabilityViolation({ ...image, byteLength: size }, target);
  if (violation === AgentImageInputCapabilityViolations.ByteLimitExceeded) {
    throw new AgentLocalizedError("vision.imageTooLarge", { size, maxImageBytes: target.maxBytes });
  }
  if (violation !== undefined) {
    throw new Error("Image normalizer returned media outside the selected model input contract.");
  }
}

function assertTotalImageSize(totalImageBytes: number, maxTotalImageBytes: number): void {
  if (totalImageBytes > maxTotalImageBytes) {
    throw new AgentLocalizedError("vision.imageTotalTooLarge", { totalImageBytes, maxTotalImageBytes });
  }
}

function readImageName(url: string): string {
  const name = path.basename(new URL(url).pathname);
  return name || "remote-image";
}

function normalizeMime(value: string | false | undefined): string | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized || undefined;
}
