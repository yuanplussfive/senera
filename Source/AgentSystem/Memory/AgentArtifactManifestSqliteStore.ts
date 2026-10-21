import fs from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";
import { walkStream, type Entry as WalkEntry } from "@nodelib/fs.walk";
import { createOpaqueId } from "../Core/AgentIds.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { isMissingFileError } from "../Core/AgentFs.js";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import { SeneraWorkspaceBoundary } from "../Execution/SeneraWorkspaceBoundary.js";
import { normalizeAgentArtifactUri, toWorkspaceRelativePath } from "../Artifacts/AgentArtifactLocator.js";
import { normalizeAgentResourceUri } from "../Resources/AgentResourceUri.js";
import type { ArtifactManifestRecord } from "./AgentArtifactMemoryTypes.js";
import { readArtifactManifest, type ArtifactManifestFileFingerprint } from "./AgentArtifactManifestReader.js";
import { AgentArtifactManifestIndexContract } from "./AgentArtifactManifestSqlSchema.js";

interface ManifestRow {
  readonly artifact_id: string;
  readonly artifact_uri: string;
  readonly manifest_path: string;
  readonly relative_dir: string;
  readonly fingerprint_size: number;
  readonly fingerprint_mtime_ms: number;
  readonly fingerprint_ctime_ms: number;
  readonly fingerprint_ino: number;
  readonly status: "valid" | "invalid";
  readonly error_message: string | null;
  readonly checkpoint_id: string | null;
  readonly checkpoint_captured_at: string | null;
}

interface AssetRow {
  readonly artifact_id: string;
  readonly manifest_path: string;
  readonly relative_dir: string;
  readonly file_name: string;
  readonly media_type: string;
  readonly relative_path: string;
  readonly byte_length: number;
  readonly sha256: string;
}

export interface IndexedManifestAsset {
  readonly artifactId: string;
  readonly manifestPath: string;
  readonly relativeDir: string;
  readonly resourceUri: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly relativePath: string;
  readonly byteLength: number;
  readonly sha256: string;
}

interface CheckpointRow extends ManifestRow {
  readonly checkpoint_id: string;
  readonly checkpoint_captured_at: string;
}

export class AgentArtifactManifestSqliteStore {
  private readonly kernel: AgentSqliteDatabaseKernel;
  private readonly db: Database.Database;
  private readonly upsertManifest: Database.Statement;
  private readonly deleteManifest: Database.Statement;
  private readonly upsertInvalid: Database.Statement;
  private readonly deleteInvalid: Database.Statement;
  private readonly upsertAsset: Database.Statement;
  private readonly deleteAssets: Database.Statement;
  private readonly touchManifest: Database.Statement;
  private readonly touchInvalid: Database.Statement;

  constructor(databasePath: string) {
    this.kernel = new AgentSqliteDatabaseKernel({
      databasePath,
      contract: AgentArtifactManifestIndexContract,
      extensions: [],
    });
    this.db = this.kernel.connection;
    this.upsertManifest = this.db.prepare(`
      INSERT INTO artifact_manifest_index (
        artifact_root, artifact_id, artifact_uri, manifest_path, relative_dir,
        fingerprint_size, fingerprint_mtime_ms, fingerprint_ctime_ms, fingerprint_ino,
        status, error_message, checkpoint_id, checkpoint_captured_at, scan_generation
      ) VALUES (@artifact_root, @artifact_id, @artifact_uri, @manifest_path, @relative_dir,
        @fingerprint_size, @fingerprint_mtime_ms, @fingerprint_ctime_ms, @fingerprint_ino,
        'valid', NULL, @checkpoint_id, @checkpoint_captured_at, @scan_generation)
      ON CONFLICT(artifact_root, artifact_id) DO UPDATE SET
        artifact_uri = excluded.artifact_uri,
        manifest_path = excluded.manifest_path,
        relative_dir = excluded.relative_dir,
        fingerprint_size = excluded.fingerprint_size,
        fingerprint_mtime_ms = excluded.fingerprint_mtime_ms,
        fingerprint_ctime_ms = excluded.fingerprint_ctime_ms,
        fingerprint_ino = excluded.fingerprint_ino,
        status = 'valid',
        error_message = NULL,
        checkpoint_id = excluded.checkpoint_id,
        checkpoint_captured_at = excluded.checkpoint_captured_at,
        scan_generation = excluded.scan_generation
    `);
    this.deleteManifest = this.db.prepare(
      "DELETE FROM artifact_manifest_index WHERE artifact_root = @artifact_root AND (artifact_id = @artifact_id OR manifest_path = @manifest_path)",
    );
    this.upsertInvalid = this.db.prepare(`
      INSERT INTO artifact_manifest_invalid (
        artifact_root, manifest_path, fingerprint_size, fingerprint_mtime_ms,
        fingerprint_ctime_ms, fingerprint_ino, error_message, scan_generation
      ) VALUES (@artifact_root, @manifest_path, @fingerprint_size, @fingerprint_mtime_ms,
        @fingerprint_ctime_ms, @fingerprint_ino, @error_message, @scan_generation)
      ON CONFLICT(artifact_root, manifest_path) DO UPDATE SET
        fingerprint_size = excluded.fingerprint_size,
        fingerprint_mtime_ms = excluded.fingerprint_mtime_ms,
        fingerprint_ctime_ms = excluded.fingerprint_ctime_ms,
        fingerprint_ino = excluded.fingerprint_ino,
        error_message = excluded.error_message,
        scan_generation = excluded.scan_generation
    `);
    this.deleteInvalid = this.db.prepare(
      "DELETE FROM artifact_manifest_invalid WHERE artifact_root = @artifact_root AND manifest_path = @manifest_path",
    );
    this.upsertAsset = this.db.prepare(`
      INSERT INTO artifact_manifest_assets (
        artifact_root, resource_uri, artifact_id, file_name, media_type,
        relative_path, byte_length, sha256
      ) VALUES (@artifact_root, @resource_uri, @artifact_id, @file_name, @media_type,
        @relative_path, @byte_length, @sha256)
      ON CONFLICT(artifact_root, resource_uri) DO UPDATE SET
        artifact_id = excluded.artifact_id,
        file_name = excluded.file_name,
        media_type = excluded.media_type,
        relative_path = excluded.relative_path,
        byte_length = excluded.byte_length,
        sha256 = excluded.sha256
    `);
    this.deleteAssets = this.db.prepare(
      "DELETE FROM artifact_manifest_assets WHERE artifact_root = @artifact_root AND artifact_id = @artifact_id",
    );
    this.touchManifest = this.db.prepare(
      "UPDATE artifact_manifest_index SET scan_generation = @scan_generation WHERE artifact_root = @artifact_root AND manifest_path = @manifest_path",
    );
    this.touchInvalid = this.db.prepare(
      "UPDATE artifact_manifest_invalid SET scan_generation = @scan_generation WHERE artifact_root = @artifact_root AND manifest_path = @manifest_path",
    );
  }

  async synchronize(artifactRoot: string, workspaceRoot: string): Promise<void> {
    const root = path.resolve(artifactRoot);
    const boundary = new SeneraWorkspaceBoundary({ workspaceRoot, linkPolicy: "deny" });
    const generation = createOpaqueId("artifact-manifest-scan");
    try {
      await consumeManifestFiles(root, async (manifestPath) => {
        await this.indexManifest(manifestPath, root, workspaceRoot, boundary, generation);
      });
      this.db.transaction(() => {
        this.db
          .prepare(
            "DELETE FROM artifact_manifest_assets WHERE artifact_root = @artifact_root AND artifact_id NOT IN (SELECT artifact_id FROM artifact_manifest_index WHERE artifact_root = @artifact_root AND scan_generation = @scan_generation)",
          )
          .run({ artifact_root: root, scan_generation: generation });
        this.db
          .prepare(
            "DELETE FROM artifact_manifest_index WHERE artifact_root = @artifact_root AND scan_generation <> @scan_generation",
          )
          .run({ artifact_root: root, scan_generation: generation });
        this.db
          .prepare(
            "DELETE FROM artifact_manifest_invalid WHERE artifact_root = @artifact_root AND scan_generation <> @scan_generation",
          )
          .run({ artifact_root: root, scan_generation: generation });
      })();
    } catch (error) {
      throw new Error(`Artifact manifest index synchronization failed: ${errorMessage(error)}`, { cause: error });
    }
  }

  async loadManifests(
    artifactRoot: string,
    workspaceRoot: string,
    artifactIds: readonly string[],
  ): Promise<ReadonlyMap<string, ArtifactManifestRecord>> {
    const root = path.resolve(artifactRoot);
    const boundary = new SeneraWorkspaceBoundary({ workspaceRoot, linkPolicy: "deny" });
    const output = new Map<string, ArtifactManifestRecord>();
    const ids = [...new Set(artifactIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) return output;
    const statement = this.db.prepare<unknown[], ManifestRow>(
      "SELECT artifact_id, artifact_uri, manifest_path, relative_dir, fingerprint_size, fingerprint_mtime_ms, fingerprint_ctime_ms, fingerprint_ino, status, error_message, checkpoint_id, checkpoint_captured_at FROM artifact_manifest_index WHERE artifact_root = ? AND artifact_id = ?",
    );
    for (const artifactId of ids) {
      const row = statement.get(root, artifactId);
      if (!row || row.status !== "valid") continue;
      let indexed: Awaited<ReturnType<typeof readArtifactManifest>>;
      try {
        indexed = await readArtifactManifest(row.manifest_path, workspaceRoot, root, boundary);
      } catch (error) {
        if (isMissingFileError(error)) continue;
        throw error;
      }
      if (!indexed.manifest || !sameFingerprint(row, indexed.fingerprint)) continue;
      output.set(artifactId, indexed.manifest);
    }
    return output;
  }

  findAsset(artifactRoot: string, resourceUri: string): IndexedManifestAsset | undefined {
    const row = this.db
      .prepare<unknown[], AssetRow>(
        `SELECT a.artifact_id, m.manifest_path, m.relative_dir, a.file_name, a.media_type,
                a.relative_path, a.byte_length, a.sha256
           FROM artifact_manifest_assets a
           JOIN artifact_manifest_index m
             ON m.artifact_root = a.artifact_root AND m.artifact_id = a.artifact_id
          WHERE a.artifact_root = ? AND a.resource_uri = ? AND m.status = 'valid'`,
      )
      .get(path.resolve(artifactRoot), resourceUri);
    if (!row) return undefined;
    return {
      artifactId: row.artifact_id,
      manifestPath: row.manifest_path,
      relativeDir: row.relative_dir,
      resourceUri,
      fileName: row.file_name,
      mediaType: row.media_type,
      relativePath: row.relative_path,
      byteLength: row.byte_length,
      sha256: row.sha256,
    };
  }

  async isManifestCurrent(artifactRoot: string, asset: IndexedManifestAsset): Promise<boolean> {
    const row = this.db
      .prepare<unknown[], ManifestRow>(
        "SELECT artifact_id, artifact_uri, manifest_path, relative_dir, fingerprint_size, fingerprint_mtime_ms, fingerprint_ctime_ms, fingerprint_ino, status, error_message, checkpoint_id, checkpoint_captured_at FROM artifact_manifest_index WHERE artifact_root = ? AND artifact_id = ?",
      )
      .get(path.resolve(artifactRoot), asset.artifactId);
    if (!row || row.status !== "valid" || row.manifest_path !== asset.manifestPath) return false;
    try {
      return sameFingerprint(row, await fingerprintPath(row.manifest_path));
    } catch (error) {
      if (isMissingFileError(error)) return false;
      throw error;
    }
  }

  findCheckpoint(
    artifactRoot: string,
    input: { readonly artifactId?: string; readonly checkpointId?: string } = {},
  ): { artifactId: string; manifestPath: string; relativeDir: string } | undefined {
    const row = this.db
      .prepare<unknown[], CheckpointRow>(
        `SELECT artifact_id, artifact_uri, manifest_path, relative_dir, fingerprint_size,
                fingerprint_mtime_ms, fingerprint_ctime_ms, fingerprint_ino, status,
                error_message, checkpoint_id, checkpoint_captured_at
           FROM artifact_manifest_index
          WHERE artifact_root = ? AND status = 'valid'
            AND checkpoint_id IS NOT NULL
            AND (? IS NULL OR artifact_id = ?)
            AND (? IS NULL OR checkpoint_id = ?)
          ORDER BY checkpoint_captured_at DESC, artifact_id ASC
          LIMIT 1`,
      )
      .get(
        path.resolve(artifactRoot),
        input.artifactId ?? null,
        input.artifactId ?? null,
        input.checkpointId ?? null,
        input.checkpointId ?? null,
      );
    return row
      ? { artifactId: row.artifact_id, manifestPath: row.manifest_path, relativeDir: row.relative_dir }
      : undefined;
  }

  close(): void {
    this.kernel.close();
  }

  private async indexManifest(
    manifestPath: string,
    artifactRoot: string,
    workspaceRoot: string,
    boundary: SeneraWorkspaceBoundary,
    generation: string,
  ): Promise<void> {
    const fingerprint = await fingerprintPath(manifestPath);
    const existing = this.db
      .prepare<
        unknown[],
        {
          readonly artifact_id: string;
          readonly fingerprint_size: number;
          readonly fingerprint_mtime_ms: number;
          readonly fingerprint_ctime_ms: number;
          readonly fingerprint_ino: number;
        }
      >(
        "SELECT artifact_id, fingerprint_size, fingerprint_mtime_ms, fingerprint_ctime_ms, fingerprint_ino FROM artifact_manifest_index WHERE artifact_root = ? AND manifest_path = ?",
      )
      .get(artifactRoot, manifestPath);
    const invalid = this.db
      .prepare<
        unknown[],
        {
          readonly fingerprint_size: number;
          readonly fingerprint_mtime_ms: number;
          readonly fingerprint_ctime_ms: number;
          readonly fingerprint_ino: number;
        }
      >(
        "SELECT fingerprint_size, fingerprint_mtime_ms, fingerprint_ctime_ms, fingerprint_ino FROM artifact_manifest_invalid WHERE artifact_root = ? AND manifest_path = ?",
      )
      .get(artifactRoot, manifestPath);
    if (existing && sameFingerprint(existing, fingerprint)) {
      this.touchManifest.run({ artifact_root: artifactRoot, manifest_path: manifestPath, scan_generation: generation });
      return;
    }
    if (invalid && sameFingerprint(invalid, fingerprint)) {
      this.touchInvalid.run({ artifact_root: artifactRoot, manifest_path: manifestPath, scan_generation: generation });
      return;
    }

    const indexed = await readArtifactManifest(manifestPath, workspaceRoot, artifactRoot, boundary);
    if (!indexed.manifest) {
      this.deleteManifest.run({
        artifact_root: artifactRoot,
        artifact_id: existing?.artifact_id ?? "",
        manifest_path: manifestPath,
      });
      this.upsertInvalid.run({
        artifact_root: artifactRoot,
        manifest_path: manifestPath,
        ...fingerprintParameters(fingerprint),
        error_message: "Artifact manifest is invalid or incompatible.",
        scan_generation: generation,
      });
      return;
    }
    const manifest = indexed.manifest;
    const metadata = readManifestIndexMetadata(manifest, workspaceRoot, manifestPath);
    const previous = this.db
      .prepare<unknown[], { readonly manifest_path: string; readonly scan_generation: string }>(
        "SELECT manifest_path, scan_generation FROM artifact_manifest_index WHERE artifact_root = ? AND artifact_id = ?",
      )
      .get(artifactRoot, manifest.artifactId);
    if (previous && previous.manifest_path !== manifestPath) {
      throw new Error(
        `Duplicate Artifact manifest for ${manifest.artifactId}: ${manifestPath} conflicts with ${previous.manifest_path}.`,
      );
    }

    const write = this.db.transaction(() => {
      this.deleteManifest.run({
        artifact_root: artifactRoot,
        artifact_id: manifest.artifactId,
        manifest_path: manifestPath,
      });
      this.deleteInvalid.run({ artifact_root: artifactRoot, manifest_path: manifestPath });
      this.upsertManifest.run({
        artifact_root: artifactRoot,
        artifact_id: manifest.artifactId,
        artifact_uri: normalizeAgentArtifactUri(manifest.artifactUri) ?? manifest.artifactUri,
        manifest_path: manifestPath,
        relative_dir: metadata.relativeDir,
        ...fingerprintParameters(fingerprint),
        checkpoint_id: metadata.checkpointId,
        checkpoint_captured_at: metadata.checkpointCapturedAt,
        scan_generation: generation,
      });
      this.deleteAssets.run({ artifact_root: artifactRoot, artifact_id: manifest.artifactId });
      for (const asset of metadata.assets) {
        this.upsertAsset.run({
          artifact_root: artifactRoot,
          artifact_id: manifest.artifactId,
          resource_uri: asset.resourceUri,
          file_name: asset.fileName,
          media_type: asset.mediaType,
          relative_path: asset.relativePath,
          byte_length: asset.byteLength,
          sha256: asset.sha256,
        });
      }
    });
    write();
  }
}

async function consumeManifestFiles(root: string, consume: (manifestPath: string) => Promise<void>): Promise<void> {
  try {
    await fs.stat(root);
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }
  const stream = walkStream(root, {
    entryFilter: (entry) => entry.dirent.isFile() && entry.name === "manifest.json",
  });
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let ended = false;
    let active = 0;
    const settleSuccess = (): void => {
      if (!ended || active !== 0 || settled) return;
      settled = true;
      resolve();
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      stream.destroy();
      reject(error);
    };
    stream.on("data", (entry: WalkEntry) => {
      active += 1;
      stream.pause();
      void consume(entry.path).then(
        () => {
          active -= 1;
          stream.resume();
          settleSuccess();
        },
        (error: unknown) => fail(error),
      );
    });
    stream.once("error", fail);
    stream.once("end", () => {
      ended = true;
      settleSuccess();
    });
  });
}

async function fingerprintPath(filePath: string): Promise<ArtifactManifestFileFingerprint> {
  const stat = await fs.stat(filePath);
  return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino };
}

function sameFingerprint(
  left: Pick<ManifestRow, "fingerprint_size" | "fingerprint_mtime_ms" | "fingerprint_ctime_ms" | "fingerprint_ino">,
  right: ArtifactManifestFileFingerprint,
): boolean {
  return (
    left.fingerprint_size === right.size &&
    left.fingerprint_mtime_ms === right.mtimeMs &&
    left.fingerprint_ctime_ms === right.ctimeMs &&
    left.fingerprint_ino === right.ino
  );
}

function fingerprintParameters(fingerprint: ArtifactManifestFileFingerprint): Record<string, number> {
  return {
    fingerprint_size: fingerprint.size,
    fingerprint_mtime_ms: fingerprint.mtimeMs,
    fingerprint_ctime_ms: fingerprint.ctimeMs,
    fingerprint_ino: fingerprint.ino,
  };
}

function readManifestIndexMetadata(
  manifest: ArtifactManifestRecord,
  workspaceRoot: string,
  manifestPath: string,
): {
  relativeDir: string;
  checkpointId: string | null;
  checkpointCapturedAt: string | null;
  assets: readonly Omit<IndexedManifestAsset, "artifactId" | "manifestPath" | "relativeDir">[];
} {
  const value = manifest as ArtifactManifestRecord & {
    readonly relativeDir?: unknown;
    readonly assets?: unknown;
    readonly workspace?: unknown;
  };
  const relativeDir =
    typeof value.relativeDir === "string" && value.relativeDir.trim().length > 0
      ? value.relativeDir
      : toWorkspaceRelativePath(workspaceRoot, path.dirname(manifestPath));
  const workspace = isRecord(value.workspace) ? value.workspace : undefined;
  const checkpoint = workspace && isRecord(workspace.checkpoint) ? workspace.checkpoint : undefined;
  const checkpointId = typeof checkpoint?.id === "string" ? checkpoint.id : null;
  const checkpointCapturedAt = typeof checkpoint?.capturedAt === "string" ? checkpoint.capturedAt : null;
  const assets = Array.isArray(value.assets) ? value.assets.flatMap(readAsset) : [];
  return { relativeDir, checkpointId, checkpointCapturedAt, assets };
}

function readAsset(value: unknown): Array<Omit<IndexedManifestAsset, "artifactId" | "manifestPath" | "relativeDir">> {
  if (!isRecord(value)) return [];
  const resourceUri = typeof value.resourceUri === "string" ? normalizeAgentResourceUri(value.resourceUri) : undefined;
  const fileName = typeof value.fileName === "string" ? value.fileName.trim() : "";
  const mediaType = typeof value.mediaType === "string" ? value.mediaType.trim() : "";
  const relativePath = typeof value.relativePath === "string" ? value.relativePath.trim() : "";
  const byteLength = typeof value.byteLength === "number" ? value.byteLength : undefined;
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
  )
    return [];
  return [{ resourceUri, fileName, mediaType, relativePath, byteLength, sha256 }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
