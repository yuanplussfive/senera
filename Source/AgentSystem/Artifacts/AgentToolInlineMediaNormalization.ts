import { extension as mimeExtension } from "mime-types";
import { isAgentBase64 } from "../Core/AgentBase64.js";
import { sha256Hex } from "../Core/AgentHash.js";
import { readAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import { createAgentArtifactAssetLink } from "./AgentArtifactAssetLink.js";
import type { AgentToolArtifactAsset, ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";

const InlineImageAssetPrefix = "inline-image";
const InlineImageUnavailableReason = "invalid_inline_image";

interface InlineImageAssetDescriptor {
  readonly asset: AgentToolArtifactAsset;
  readonly signature: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface AgentToolInlineMediaNormalization {
  readonly result: ExecutedToolCallResult;
  /** Asset ids which exist only if this Artifact publication succeeds. */
  readonly generatedAssetIds: readonly string[];
}

/**
 * Converts protocol-declared inline tool images into Artifact assets before
 * either the durable record or a model observation sees the result.
 *
 * This only recognizes the standard `{ type: "image", data, mimeType }`
 * envelope. Bare strings which happen to resemble Base64 remain application
 * data; a tool must opt into the media protocol explicitly.
 */
export function normalizeAgentToolInlineMedia(result: ExecutedToolCallResult): AgentToolInlineMediaNormalization {
  const existingAssets = result.artifactPayload?.assets;
  const catalog = new AgentToolInlineImageCatalog(existingAssets ?? []);
  const normalizedResult = normalizeInlineImages(result.result, catalog);
  const rawResponse = result.artifactPayload?.rawResponse;
  const normalizedRawResponse = rawResponse === undefined ? undefined : normalizeInlineImages(rawResponse, catalog);
  const assets = catalog.assets();
  const resultChanged = normalizedResult !== result.result;
  const rawResponseChanged = normalizedRawResponse !== rawResponse;
  const assetsChanged = catalog.hasGeneratedAssets();

  if (!resultChanged && !rawResponseChanged && !assetsChanged) return { result, generatedAssetIds: [] };

  const artifactPayload = {
    ...(result.artifactPayload ?? {}),
    ...(assetsChanged ? { assets } : {}),
    ...(rawResponse !== undefined ? { rawResponse: normalizedRawResponse } : {}),
  };
  return {
    result: {
      ...result,
      ...(resultChanged ? { result: normalizedResult } : {}),
      artifactPayload,
    },
    generatedAssetIds: catalog.generatedAssetIds(),
  };
}

/**
 * An intermediate asset coordinate has meaning only inside a successful
 * Artifact transaction. If publication fails, turn those coordinates into an
 * explicit result rather than leaving the model an unusable resource URI.
 */
export function projectUnpublishedAgentToolInlineMedia(
  result: ExecutedToolCallResult,
  generatedAssetIds: readonly string[],
): ExecutedToolCallResult {
  if (generatedAssetIds.length === 0) return result;
  const pendingResourceUris = new Set(generatedAssetIds.map((assetId) => createAgentArtifactAssetLink(assetId)));
  const projected = replaceUnpublishedResources(result.result, pendingResourceUris, new WeakSet<object>());
  return projected === result.result ? result : { ...result, result: projected };
}

class AgentToolInlineImageCatalog {
  private readonly knownAssets = new Map<string, InlineImageAssetDescriptor>();
  private readonly assetsById = new Map<string, AgentToolArtifactAsset>();
  private readonly allAssets: AgentToolArtifactAsset[];
  private readonly generatedIds: string[] = [];
  private readonly initialAssetCount: number;

  constructor(initialAssets: readonly AgentToolArtifactAsset[]) {
    this.allAssets = [...initialAssets];
    this.initialAssetCount = initialAssets.length;
    for (const asset of initialAssets) {
      this.assetsById.set(asset.id, asset);
      const descriptor = describeImageAsset(asset);
      if (descriptor && !this.knownAssets.has(descriptor.signature)) {
        this.knownAssets.set(descriptor.signature, descriptor);
      }
    }
  }

  assets(): readonly AgentToolArtifactAsset[] {
    return this.allAssets;
  }

  hasGeneratedAssets(): boolean {
    return this.allAssets.length !== this.initialAssetCount;
  }

  generatedAssetIds(): readonly string[] {
    return this.generatedIds;
  }

  resourceFor(record: Record<string, unknown>): unknown {
    const image = readInlineImage(record);
    if (!image) return createUnavailableInlineImage(record);

    const descriptor = this.knownAssets.get(image.signature) ?? this.createAsset(image);
    return {
      type: "resource",
      resource: {
        uri: createAgentArtifactAssetLink(descriptor.asset.id),
        name: descriptor.asset.fileName,
        mimeType: descriptor.asset.mediaType,
        size: descriptor.byteLength,
        sha256: descriptor.sha256,
      },
    };
  }

  private createAsset(image: InlineImagePayload): InlineImageAssetDescriptor {
    const id = this.allocateAssetId(image.signature);
    const extension = mimeExtension(image.mimeType);
    const asset: AgentToolArtifactAsset = {
      id,
      fileName: `${id}${typeof extension === "string" && extension ? `.${extension}` : ""}`,
      mediaType: image.mimeType,
      dataBase64: image.bytes.toString("base64"),
    };
    const descriptor: InlineImageAssetDescriptor = {
      asset,
      signature: image.signature,
      byteLength: image.bytes.byteLength,
      sha256: image.sha256,
    };
    this.assetsById.set(id, asset);
    this.knownAssets.set(image.signature, descriptor);
    this.allAssets.push(asset);
    this.generatedIds.push(id);
    return descriptor;
  }

  private allocateAssetId(signature: string): string {
    const base = `${InlineImageAssetPrefix}-${sha256Hex(signature).slice(0, 32)}`;
    let candidate = base;
    let suffix = 1;
    while (this.assetsById.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }
}

function normalizeInlineImages(value: unknown, catalog: AgentToolInlineImageCatalog): unknown {
  return normalizeValue(value, catalog, new WeakSet<object>());
}

function normalizeValue(value: unknown, catalog: AgentToolInlineImageCatalog, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) return value;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      let changed = false;
      const projected = value.map((entry) => {
        const next = normalizeValue(entry, catalog, ancestors);
        changed ||= next !== entry;
        return next;
      });
      return changed ? projected : value;
    }

    const record = readAgentUnknownRecord(value);
    if (!record) return value;
    if (isDeclaredInlineImage(record)) return catalog.resourceFor(record);

    let changed = false;
    const entries = Object.entries(record).map(([key, entry]) => {
      const next = normalizeValue(entry, catalog, ancestors);
      changed ||= next !== entry;
      return [key, next] as const;
    });
    return changed ? Object.fromEntries(entries) : value;
  } finally {
    ancestors.delete(value);
  }
}

interface InlineImagePayload {
  readonly mimeType: string;
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly signature: string;
}

function readInlineImage(record: Record<string, unknown>): InlineImagePayload | undefined {
  const mimeType = normalizeImageMime(record.mimeType);
  const data = typeof record.data === "string" ? record.data : undefined;
  if (!mimeType || !data || !isAgentBase64(data)) return undefined;
  const bytes = Buffer.from(data, "base64");
  if (bytes.byteLength === 0) return undefined;
  const sha256 = sha256Hex(bytes);
  return {
    mimeType,
    bytes,
    sha256,
    signature: `${mimeType}\u0000${sha256}`,
  };
}

function isDeclaredInlineImage(record: Record<string, unknown>): boolean {
  return record.type === "image" && (Object.hasOwn(record, "data") || Object.hasOwn(record, "mimeType"));
}

function describeImageAsset(asset: AgentToolArtifactAsset): InlineImageAssetDescriptor | undefined {
  const image = readInlineImage({ type: "image", data: asset.dataBase64, mimeType: asset.mediaType });
  return image
    ? {
        asset,
        signature: image.signature,
        byteLength: image.bytes.byteLength,
        sha256: image.sha256,
      }
    : undefined;
}

function normalizeImageMime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const mimeType = value.trim().toLowerCase();
  return /^image\/[a-z0-9!#$&^_.+-]+$/iu.test(mimeType) ? mimeType : undefined;
}

function createUnavailableInlineImage(record: Record<string, unknown>): Record<string, unknown> {
  const mediaType = normalizeImageMime(record.mimeType);
  return {
    type: "media_unavailable",
    reason: InlineImageUnavailableReason,
    message: "The tool returned an inline image that could not be published as a durable resource.",
    ...(mediaType ? { mediaType } : {}),
  };
}

function replaceUnpublishedResources(
  value: unknown,
  pendingResourceUris: ReadonlySet<string>,
  ancestors: WeakSet<object>,
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) return value;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      let changed = false;
      const projected = value.map((entry) => {
        const next = replaceUnpublishedResources(entry, pendingResourceUris, ancestors);
        changed ||= next !== entry;
        return next;
      });
      return changed ? projected : value;
    }
    const record = readAgentUnknownRecord(value);
    if (!record) return value;
    const resource = record.type === "resource" ? readAgentUnknownRecord(record.resource) : undefined;
    if (resource && typeof resource.uri === "string" && pendingResourceUris.has(resource.uri)) {
      return {
        type: "media_unavailable",
        reason: "artifact_recording_failed",
        message: "The tool image could not be published as a durable resource, so it is unavailable for this turn.",
      };
    }
    let changed = false;
    const entries = Object.entries(record).map(([key, entry]) => {
      const next = replaceUnpublishedResources(entry, pendingResourceUris, ancestors);
      changed ||= next !== entry;
      return [key, next] as const;
    });
    return changed ? Object.fromEntries(entries) : value;
  } finally {
    ancestors.delete(value);
  }
}
