import { createHash } from "node:crypto";
import path from "node:path";
import { lookup } from "mime-types";
import { fileTypeFromBuffer } from "file-type";
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
      const sample = Buffer.alloc(Math.min(stat.size, 4_100));
      const { bytesRead } = await opened.handle.read(sample, 0, sample.byteLength, 0);
      return {
        filePath: opened.target.absolutePath,
        name: path.basename(opened.target.addressedPath),
        mime:
          normalizeMime((await fileTypeFromBuffer(sample.subarray(0, bytesRead)))?.mime) ??
          normalizeMime(lookup(opened.target.addressedPath) || undefined) ??
          "application/octet-stream",
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
    const asset = await this.artifactManifestIndex.resolveAsset({
      artifactRoot,
      workspaceRoot: this.workspaceRoot,
      resourceUri,
    });
    if (!asset) return undefined;
    const directory = path.resolve(this.workspaceRoot, asset.relativeDir);
    if (!isPathWithin(artifactRoot, directory)) return undefined;
    const filePath = path.resolve(directory, asset.relativePath);
    if (!isPathWithin(directory, filePath)) return undefined;

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

  private config(): AgentSystemConfig {
    return typeof this.options.config === "function" ? this.options.config() : this.options.config;
  }
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
