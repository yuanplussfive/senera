import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import { removeAgentPathWithRetry } from "../Core/AgentFs.js";
import { normalizeAgentResourceUri, parseAgentResourceId } from "../Resources/AgentResourceUri.js";
import { AgentUploadFileNames, resolveAgentUploadDir, resolveAgentUploadFile } from "./AgentUploadLocator.js";
import { AgentUploadIntegrityError } from "./AgentUploadErrors.js";
import { AgentUploadManifestSchema, type AgentUploadManifest, type AgentResolvedUpload } from "./AgentUploadTypes.js";

export interface AgentUploadMaintenanceResult {
  retainedBytes: number;
  removedBytes: number;
  removedUploads: number;
}

/** Reads the canonical manifest and validates its identity before resolving any stored file. */
export async function resolveStoredUpload(
  uploadRoot: string,
  resourceUri: string,
): Promise<AgentResolvedUpload | undefined> {
  const normalizedUri = normalizeAgentResourceUri(resourceUri);
  if (!normalizedUri) return undefined;
  const resourceId = parseAgentResourceId(normalizedUri);
  if (!resourceId) return undefined;
  const uploadDir = resolveAgentUploadDir(uploadRoot, resourceId);
  const manifest = AgentUploadManifestSchema.parse(
    parseJsonText(await fsp.readFile(path.join(uploadDir, AgentUploadFileNames.Manifest), "utf8"), "Upload manifest"),
  );
  if (manifest.resourceUri !== normalizedUri || manifest.resourceId !== resourceId) return undefined;
  return { manifest, uploadDir, filePath: resolveAgentUploadFile(uploadRoot, resourceId, manifest.storage.fileName) };
}

export function serializeUploadManifest(manifest: AgentUploadManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function verifyUploadFileIntegrity(filePath: string, manifest: AgentUploadManifest): Promise<void> {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) throw new AgentUploadIntegrityError(manifest.resourceUri, "not_a_file");
  if (stat.size !== manifest.size) throw new AgentUploadIntegrityError(manifest.resourceUri, "size_mismatch");
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  if (hash.digest("hex") !== manifest.sha256) {
    throw new AgentUploadIntegrityError(manifest.resourceUri, "sha256_mismatch");
  }
}

export async function totalStoredPathBytes(paths: readonly string[]): Promise<number> {
  const byteLengths = await Promise.all(paths.map((filePath) => storedPathByteLength(filePath)));
  return byteLengths.reduce((total, byteLength) => total + byteLength, 0);
}

export async function storedPathByteLength(filePath: string): Promise<number> {
  const stat = await fsp.lstat(filePath).catch((error: unknown) => {
    if (isFileSystemError(error, "ENOENT")) return undefined;
    throw error;
  });
  if (!stat) return 0;
  if (stat.isFile()) return stat.size;
  if (stat.isDirectory()) return directorySize(filePath);
  return 0;
}

export async function removeNonFilePath(filePath: string): Promise<void> {
  const stat = await fsp.lstat(filePath).catch((error: unknown) => {
    if (isFileSystemError(error, "ENOENT")) return undefined;
    throw error;
  });
  if (stat && !stat.isFile()) await removeAgentPathWithRetry(filePath, { recursive: stat.isDirectory() });
}

export async function manifestByteLength(uploadDir: string): Promise<number> {
  const stat = await fsp.stat(path.join(uploadDir, AgentUploadFileNames.Manifest));
  return stat.size;
}

export function serializedManifestByteLength(manifest: AgentUploadManifest): number {
  return Buffer.byteLength(serializeUploadManifest(manifest), "utf8");
}

interface ScanUploadRootOptions {
  uploadRoot: string;
  activeUploadIds: ReadonlySet<string>;
  now: number;
  retentionMs: number;
  incompleteRetentionMs: number;
}

export async function scanUploadRoot(options: ScanUploadRootOptions): Promise<AgentUploadMaintenanceResult> {
  const entries = await fsp.readdir(options.uploadRoot, { withFileTypes: true }).catch((error: unknown) => {
    if (isFileSystemError(error, "ENOENT")) return [];
    throw error;
  });
  const result: AgentUploadMaintenanceResult = { retainedBytes: 0, removedBytes: 0, removedUploads: 0 };

  for (const entry of entries) {
    if (!entry.isDirectory() || options.activeUploadIds.has(entry.name)) continue;
    const uploadDir = resolveAgentUploadDir(options.uploadRoot, entry.name);
    const storedBytes = await directorySize(uploadDir);
    const manifest = await readManifest(uploadDir);
    const createdAt = manifest ? Date.parse(manifest.createdAt) : await directoryModifiedAt(uploadDir);
    const retentionMs = manifest ? options.retentionMs : options.incompleteRetentionMs;
    if (manifest?.retention !== "persistent" && Number.isFinite(createdAt) && options.now - createdAt >= retentionMs) {
      await removeAgentPathWithRetry(uploadDir, { recursive: true });
      result.removedBytes += storedBytes;
      result.removedUploads += 1;
      continue;
    }
    result.retainedBytes += storedBytes;
  }
  return result;
}

/** The manifest is the ownership index. This only returns persistent records from one known session. */
export async function findPersistentOwnedUploadUris(
  uploadRoot: string,
  input: { sessionId: string; requestIds?: readonly string[] },
): Promise<string[]> {
  const requested = input.requestIds ? new Set(input.requestIds) : undefined;
  const entries = await fsp.readdir(uploadRoot, { withFileTypes: true }).catch((error: unknown) => {
    if (isFileSystemError(error, "ENOENT")) return [];
    throw error;
  });
  const matches: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = await readManifest(resolveAgentUploadDir(uploadRoot, entry.name));
    if (
      manifest?.retention === "persistent" &&
      manifest.owner?.sessionId === input.sessionId &&
      (!requested || requested.has(manifest.owner.requestId))
    ) {
      matches.push(manifest.resourceUri);
    }
  }
  return matches;
}

async function readManifest(uploadDir: string): Promise<AgentUploadManifest | undefined> {
  return fsp
    .readFile(path.join(uploadDir, AgentUploadFileNames.Manifest), "utf8")
    .then((value) => AgentUploadManifestSchema.parse(parseJsonText(value, "Upload manifest")))
    .catch(() => undefined);
}

async function directoryModifiedAt(uploadDir: string): Promise<number> {
  return fsp
    .stat(uploadDir)
    .then((stat) => stat.mtimeMs)
    .catch(() => Date.now());
}

export async function directorySize(directory: string): Promise<number> {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return directorySize(entryPath);
      if (!entry.isFile()) return 0;
      return fsp.stat(entryPath).then((stat) => stat.size);
    }),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

function isFileSystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
