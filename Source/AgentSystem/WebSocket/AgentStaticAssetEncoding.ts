import path from "node:path";
import mime from "mime-types";

export const AgentStaticAssetEncodingVariants = [
  { contentEncoding: "br", fileSuffix: ".br" },
  { contentEncoding: "gzip", fileSuffix: ".gz" },
] as const;

export type AgentStaticAssetContentEncoding = (typeof AgentStaticAssetEncodingVariants)[number]["contentEncoding"];

export const AgentStaticAssetCompressionPolicy = {
  minimumByteLength: 1024,
  mediaTypePrefixes: ["text/"],
  mediaTypes: ["application/javascript", "application/json", "application/wasm", "image/svg+xml"],
} as const;

export function shouldPrecompressAgentStaticAsset(filePath: string, byteLength: number): boolean {
  if (byteLength < AgentStaticAssetCompressionPolicy.minimumByteLength || isAgentStaticAssetSidecar(filePath)) {
    return false;
  }
  const mediaType = mime.lookup(path.extname(filePath));
  if (!mediaType) return false;
  return (
    AgentStaticAssetCompressionPolicy.mediaTypes.some((candidate) => candidate === mediaType) ||
    AgentStaticAssetCompressionPolicy.mediaTypePrefixes.some((prefix) => mediaType.startsWith(prefix))
  );
}

export function selectAgentStaticAssetContentEncoding(
  acceptEncoding: string | undefined,
  isAvailable: (contentEncoding: AgentStaticAssetContentEncoding) => boolean,
): AgentStaticAssetContentEncoding | undefined {
  const qualityByEncoding = parseAcceptEncoding(acceptEncoding);
  const wildcardQuality = qualityByEncoding.get("*");
  return AgentStaticAssetEncodingVariants.map(({ contentEncoding }, preference) => ({
    contentEncoding,
    preference,
    quality: qualityByEncoding.get(contentEncoding) ?? wildcardQuality ?? 0,
  }))
    .filter(({ contentEncoding, quality }) => quality > 0 && isAvailable(contentEncoding))
    .sort((left, right) => right.quality - left.quality || left.preference - right.preference)[0]?.contentEncoding;
}

export function readAgentStaticAssetSidecarSuffix(
  contentEncoding: AgentStaticAssetContentEncoding,
): (typeof AgentStaticAssetEncodingVariants)[number]["fileSuffix"] {
  const variant = AgentStaticAssetEncodingVariants.find((candidate) => candidate.contentEncoding === contentEncoding);
  if (!variant) throw new Error(`Unsupported static asset content encoding: ${contentEncoding}`);
  return variant.fileSuffix;
}

export function isAgentStaticAssetSidecar(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return AgentStaticAssetEncodingVariants.some(({ fileSuffix }) => normalized.endsWith(fileSuffix));
}

function parseAcceptEncoding(header: string | undefined): Map<string, number> {
  const qualityByEncoding = new Map<string, number>();
  for (const entry of header?.split(",") ?? []) {
    const [rawEncoding, ...rawParameters] = entry.split(";");
    const encoding = rawEncoding?.trim().toLowerCase();
    if (!encoding) continue;
    let quality = 1;
    let valid = true;
    for (const rawParameter of rawParameters) {
      const [rawName, rawValue] = rawParameter.split("=");
      if (rawName?.trim().toLowerCase() !== "q") continue;
      const parsed = Number(rawValue?.trim());
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        valid = false;
        break;
      }
      quality = parsed;
    }
    if (!valid) continue;
    qualityByEncoding.set(encoding, Math.max(qualityByEncoding.get(encoding) ?? 0, quality));
  }
  return qualityByEncoding;
}
