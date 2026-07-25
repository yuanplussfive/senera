import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import * as tar from "tar-stream";
import { z } from "zod";

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const DescriptorSchema = z
  .object({
    mediaType: z.string().trim().min(1),
    digest: DigestSchema,
    size: z.number().int().positive(),
    annotations: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();
const OciIndexSchema = z
  .object({
    schemaVersion: z.literal(2),
    manifests: z.array(DescriptorSchema).min(1),
  })
  .passthrough();
const OciImageManifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    mediaType: z.literal("application/vnd.oci.image.manifest.v1+json"),
    config: DescriptorSchema.extend({
      mediaType: z.literal("application/vnd.oci.image.config.v1+json"),
    }),
  })
  .passthrough();

const IndexFileName = "index.json";
const ReferenceAnnotation = "org.opencontainers.image.ref.name";
const OciManifestMediaType = "application/vnd.oci.image.manifest.v1+json";
const MaximumMetadataEntries = 64;

export interface AgentOciArchiveIdentityInput {
  archivePath: string;
  reference: string;
  maxMetadataBytes: number;
}

export async function readAgentOciArchiveConfigDigest(input: AgentOciArchiveIdentityInput): Promise<string> {
  if (!Number.isSafeInteger(input.maxMetadataBytes) || input.maxMetadataBytes <= 0) {
    throw new Error("OCI archive metadata limit must be a positive safe integer.");
  }
  const metadata = await readOciMetadataEntries(input.archivePath, input.maxMetadataBytes);
  const index = OciIndexSchema.parse(parseJson(requireMetadataEntry(metadata, IndexFileName), IndexFileName));
  const manifests = index.manifests.filter(
    (descriptor) =>
      descriptor.mediaType === OciManifestMediaType &&
      descriptor.annotations?.[ReferenceAnnotation] === input.reference,
  );
  if (manifests.length !== 1) {
    throw new Error(`OCI archive must contain exactly one manifest for ${input.reference}; found ${manifests.length}.`);
  }
  const manifestDescriptor = manifests[0]!;
  const manifestPath = digestBlobPath(manifestDescriptor.digest);
  const manifestContent = requireMetadataEntry(metadata, manifestPath);
  assertDescriptorContent(manifestDescriptor, manifestContent, manifestPath);
  const manifest = OciImageManifestSchema.parse(parseJson(manifestContent, manifestPath));
  const configPath = digestBlobPath(manifest.config.digest);
  assertDescriptorContent(manifest.config, requireMetadataEntry(metadata, configPath), configPath);
  return manifest.config.digest;
}

async function readOciMetadataEntries(archivePath: string, maxMetadataBytes: number): Promise<Map<string, Buffer>> {
  const extract = tar.extract();
  const extraction = pipeline(createReadStream(archivePath), extract);
  const entries = new Map<string, Buffer>();
  try {
    for await (const entry of extract) {
      const name = normalizeArchivePath(entry.header.name);
      const declaredSize = entry.header.size ?? 0;
      const isMetadata =
        entry.header.type === "file" &&
        (name === IndexFileName || (isDigestBlobPath(name) && declaredSize <= maxMetadataBytes));
      if (!isMetadata) {
        for await (const _chunk of entry) {
          // Drain non-metadata entries without retaining image layers in memory.
        }
        continue;
      }
      if (entries.size >= MaximumMetadataEntries) {
        throw new Error(`OCI archive exceeds the metadata entry limit of ${MaximumMetadataEntries}.`);
      }
      if (entries.has(name)) throw new Error(`OCI archive contains a duplicate metadata entry: ${name}.`);
      const content = await readEntryWithLimit(entry, maxMetadataBytes, name);
      if (content.byteLength !== declaredSize) {
        throw new Error(`OCI archive entry size does not match its header: ${name}.`);
      }
      entries.set(name, content);
    }
    await extraction;
    return entries;
  } catch (error) {
    extract.destroy();
    await extraction.catch(() => undefined);
    throw error;
  }
}

async function readEntryWithLimit(
  entry: NodeJS.ReadableStream & AsyncIterable<Buffer | string>,
  maxBytes: number,
  name: string,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const value of entry) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    totalBytes += chunk.byteLength;
    if (totalBytes > maxBytes) throw new Error(`OCI archive metadata entry exceeds ${maxBytes} bytes: ${name}.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, totalBytes);
}

function requireMetadataEntry(entries: ReadonlyMap<string, Buffer>, name: string): Buffer {
  const entry = entries.get(name);
  if (!entry) throw new Error(`OCI archive is missing required metadata entry: ${name}.`);
  return entry;
}

function assertDescriptorContent(descriptor: z.infer<typeof DescriptorSchema>, content: Buffer, name: string): void {
  if (content.byteLength !== descriptor.size) {
    throw new Error(`OCI descriptor size does not match archive entry ${name}.`);
  }
  const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (digest !== descriptor.digest) throw new Error(`OCI descriptor digest does not match archive entry ${name}.`);
}

function digestBlobPath(digest: string): string {
  return `blobs/sha256/${digest.slice("sha256:".length)}`;
}

function isDigestBlobPath(value: string): boolean {
  return /^blobs\/sha256\/[a-f0-9]{64}$/u.test(value);
}

function normalizeArchivePath(value: string): string {
  const withoutPrefix = value.startsWith("./") ? value.slice(2) : value;
  if (
    !withoutPrefix ||
    withoutPrefix.includes("\\") ||
    withoutPrefix.startsWith("/") ||
    withoutPrefix.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`OCI archive contains an unsafe entry path: ${value}.`);
  }
  return withoutPrefix;
}

function parseJson(content: Buffer, name: string): unknown {
  try {
    return JSON.parse(content.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(`OCI archive metadata is not valid JSON: ${name}.`, { cause: error });
  }
}
