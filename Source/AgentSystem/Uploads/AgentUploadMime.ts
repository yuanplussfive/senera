import { extension, lookup } from "mime-types";

export const UnknownBinaryMimeType = "application/octet-stream";

export const AgentInlineImageMimeTypes = [
  "image/apng",
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/tiff",
  "image/webp",
] as const;

export type AgentInlineImageMimeType = (typeof AgentInlineImageMimeTypes)[number];

const AgentInlineImageMimeTypeSet: ReadonlySet<string> = new Set(AgentInlineImageMimeTypes);

export interface AgentUploadMimeDetection {
  effective: string;
  declared?: string;
  detected?: string;
  extension?: string;
}

export async function detectAgentUploadMime(input: {
  filePath: string;
  originalName: string;
  declaredMime?: string;
}): Promise<AgentUploadMimeDetection> {
  const detected = await detectMimeFromBytes(input.filePath);
  const declared = normalizeMime(input.declaredMime);
  const named = normalizeMime(lookup(input.originalName) || undefined);
  const effective = detected ?? declared ?? named ?? UnknownBinaryMimeType;
  return {
    effective,
    declared,
    detected,
    extension: extension(effective) || undefined,
  };
}

export function isAgentInlineImageMime(value: string | undefined): value is AgentInlineImageMimeType {
  return value !== undefined && AgentInlineImageMimeTypeSet.has(value);
}

/**
 * Browser-renderable media and text keep their native MIME under the resource
 * response's sandbox policy. Office files, archives and unknown binaries remain
 * downloads. SVG can render as an image without gaining access to the host.
 */
export function isAgentInlinePreviewMime(value: string | undefined): boolean {
  if (!value) return false;
  return (
    isAgentInlineImageMime(value) ||
    value === "application/pdf" ||
    value.startsWith("text/") ||
    value === "application/json" ||
    value === "application/ld+json" ||
    value === "application/xml" ||
    value === "application/javascript" ||
    value === "application/x-javascript" ||
    value === "application/x-ndjson" ||
    value.startsWith("audio/") ||
    value.startsWith("video/")
  );
}

async function detectMimeFromBytes(filePath: string): Promise<string | undefined> {
  const { fileTypeFromFile } = await import("file-type");
  const fileType = await fileTypeFromFile(filePath);
  return normalizeMime(fileType?.mime);
}

function normalizeMime(value: string | false | undefined): string | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized ? normalized : undefined;
}
