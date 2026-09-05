import { createHash } from "node:crypto";
import path from "node:path";
import { lookup } from "mime-types";
import { resolveArtifactsConfig } from "../Defaults/AgentAppDefaults.js";
import { isMissingFileError } from "../Core/AgentFs.js";
import { openVerifiedArtifactFile } from "../Artifacts/AgentArtifactIntegrity.js";
import { AgentArtifactManifestIndexCache } from "../Memory/AgentArtifactManifestIndexCache.js";
import { AgentResourceAccessIntents } from "../Execution/SeneraResourceAccess.js";
import { SeneraWorkspaceBoundary } from "../Execution/SeneraWorkspaceBoundary.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import { normalizeAgentResourceUri } from "./AgentResourceUri.js";

export const AgentResourceOrigins = {
  Upload: "upload",
  Artifact: "artifact",
} as const;

export type AgentResourceOrigin = (typeof AgentResourceOrigins)[keyof typeof AgentResourceOrigins];

export interface AgentResolvedResource {
  readonly resourceUri: string;
  readonly filePath: string;
  readonly name: string;
  readonly mime: string;
  readonly declaredMime?: string;
  readonly size: number;
  readonly sha256: string;
  readonly origin: AgentResourceOrigin;
}

/** A workspace file authorized for a one-shot outbound media projection. */
export interface AgentResolvedWorkspaceResource {
  readonly filePath: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly sha256: string;
}

export interface AgentResourceResolverLike {
  resolve(resourceUri: string): Promise<AgentResolvedResource | undefined>;
  /** Resolves an absolute or workspace-relative path after boundary checks. */
  resolveWorkspacePath?(filePath: string): Promise<AgentResolvedWorkspaceResource | undefined>;
}

export interface AgentResourceResolverOptions {
  readonly workspaceRoot: string;
  readonly config: AgentSystemConfig | (() => AgentSystemConfig);
  readonly uploadStore: Pick<AgentUploadStore, "resolve">;
  readonly artifactManifestIndex?: AgentArtifactManifestIndexCache;
}

/**
 * Resolves every durable Senera resource through its canonical URI. Producers
 * retain their own storage, while consumers never need to know that storage.
 */
export class AgentResourceResolver implements AgentResourceResolverLike {
  private readonly workspaceRoot: string;
  private readonly artifactManifestIndex: AgentArtifactManifestIndexCache;
  private readonly workspaceBoundary: SeneraWorkspaceBoundary;

  constructor(private readonly options: AgentResourceResolverOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.artifactManifestIndex = options.artifactManifestIndex ?? new AgentArtifactManifestIndexCache();
    this.workspaceBoundary = new SeneraWorkspaceBoundary({ workspaceRoot: this.workspaceRoot, linkPolicy: "deny" });
  }

  async resolve(resourceUri: string): Promise<AgentResolvedResource | undefined> {
    const normalizedUri = normalizeAgentResourceUri(resourceUri);
    if (!normalizedUri) return undefined;

    const upload = await this.resolveUpload(normalizedUri);
    if (upload) return upload;
    return this.resolveArtifact(normalizedUri);
  }

  async resolveWorkspacePath(filePath: string): Promise<AgentResolvedWorkspaceResource | undefined> {
    let opened: Awaited<ReturnType<SeneraWorkspaceBoundary["openFile"]>>;
    try {
      opened = await this.workspaceBoundary.openFile(filePath, AgentResourceAccessIntents.Read);
    } catch (error) {
      // Invalid, missing, outside-workspace, and link traversal references are
      // ordinary unresolved Markdown links from the channel's perspective.
      if (isMissingFileError(error)) return undefined;
      return undefined;
    }

    try {
      const stat = await opened.handle.stat();
      if (!stat.isFile()) return undefined;
      return {
        filePath: opened.target.absolutePath,
        name: path.basename(opened.target.addressedPath),
        mime: normalizeMime(lookup(opened.target.addressedPath) || undefined) ?? "application/octet-stream",
        size: stat.size,
        sha256: await sha256ForHandle(opened.handle),
      };
    } finally {
      await opened.handle.close().catch(() => undefined);
    }
  }

  private async resolveUpload(resourceUri: string): Promise<AgentResolvedResource | undefined> {
    try {
      const upload = await this.options.uploadStore.resolve(resourceUri);
      if (!upload) return undefined;
      return {
        resourceUri: upload.manifest.resourceUri,
        filePath: upload.filePath,
        name: upload.manifest.name,
        mime: upload.manifest.mime,
        ...(upload.manifest.declaredMime ? { declaredMime: upload.manifest.declaredMime } : {}),
        size: upload.manifest.size,
        sha256: upload.manifest.sha256,
        origin: AgentResourceOrigins.Upload,
      };
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }
  }

  private async resolveArtifact(resourceUri: string): Promise<AgentResolvedResource | undefined> {
    const artifactRoot = path.resolve(this.workspaceRoot, resolveArtifactsConfig(this.config()).RootDir);
    let manifests = await this.artifactManifestIndex.load({
      artifactRoot,
      workspaceRoot: this.workspaceRoot,
      requiredArtifactIds: [],
    });
    let resolved = await this.resolveArtifactFromManifests(resourceUri, artifactRoot, manifests);
    if (resolved) return resolved;

    // A tool result may have been persisted after the cached index was built.
    // Refresh only on a cache miss so ordinary reads stay O(1) after indexing.
    manifests = await this.artifactManifestIndex.load({
      artifactRoot,
      workspaceRoot: this.workspaceRoot,
      requiredArtifactIds: [],
      refresh: true,
    });
    resolved = await this.resolveArtifactFromManifests(resourceUri, artifactRoot, manifests);
    return resolved;
  }

  private async resolveArtifactFromManifests(
    resourceUri: string,
    artifactRoot: string,
    manifests: ReadonlyMap<string, unknown>,
  ): Promise<AgentResolvedResource | undefined> {
    for (const manifest of manifests.values()) {
      const asset = readArtifactAsset(manifest, resourceUri);
      if (!asset) continue;
      const directory = readArtifactDirectory(manifest, this.workspaceRoot, artifactRoot);
      if (!directory) continue;
      const filePath = path.resolve(directory, asset.relativePath);
      if (!isPathWithin(directory, filePath)) continue;

      const handle = await openVerifiedArtifactFile(this.workspaceBoundary, filePath, {
        byteLength: asset.byteLength,
        sha256: asset.sha256,
      });
      await handle.close();
      return {
        resourceUri: asset.resourceUri,
        filePath,
        name: asset.fileName,
        mime: asset.mediaType,
        size: asset.byteLength,
        sha256: asset.sha256,
        origin: AgentResourceOrigins.Artifact,
      };
    }
    return undefined;
  }

  private config(): AgentSystemConfig {
    return typeof this.options.config === "function" ? this.options.config() : this.options.config;
  }
}

interface ArtifactResourceAsset {
  readonly resourceUri: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly relativePath: string;
  readonly byteLength: number;
  readonly sha256: string;
}

function readArtifactAsset(manifest: unknown, resourceUri: string): ArtifactResourceAsset | undefined {
  if (!isRecord(manifest) || !Array.isArray(manifest.assets)) return undefined;
  for (const value of manifest.assets) {
    if (!isRecord(value)) continue;
    const candidate = readArtifactResourceAsset(value);
    if (candidate?.resourceUri === resourceUri) return candidate;
  }
  return undefined;
}

function readArtifactResourceAsset(value: Record<string, unknown>): ArtifactResourceAsset | undefined {
  const resourceUri = typeof value.resourceUri === "string" ? normalizeAgentResourceUri(value.resourceUri) : undefined;
  const fileName = typeof value.fileName === "string" ? value.fileName.trim() : "";
  const mediaType = typeof value.mediaType === "string" ? value.mediaType.trim() : "";
  const relativePath = typeof value.relativePath === "string" ? value.relativePath.trim() : "";
  const byteLength = value.byteLength;
  const sha256 = typeof value.sha256 === "string" ? value.sha256.toLowerCase() : "";
  if (
    !resourceUri ||
    !fileName ||
    !mediaType ||
    !relativePath ||
    typeof byteLength !== "number" ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    !/^[a-f0-9]{64}$/u.test(sha256)
  ) {
    return undefined;
  }
  return { resourceUri, fileName, mediaType, relativePath, byteLength, sha256 };
}

function readArtifactDirectory(manifest: unknown, workspaceRoot: string, artifactRoot: string): string | undefined {
  if (!isRecord(manifest) || typeof manifest.relativeDir !== "string" || !manifest.relativeDir.trim()) return undefined;
  const directory = path.resolve(workspaceRoot, manifest.relativeDir);
  return isPathWithin(artifactRoot, directory) ? directory : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function sha256ForHandle(
  handle: Awaited<ReturnType<SeneraWorkspaceBoundary["openFile"]>>["handle"],
): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk);
  return digest.digest("hex");
}

function normalizeMime(value: string | false | undefined): string | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized || undefined;
}
