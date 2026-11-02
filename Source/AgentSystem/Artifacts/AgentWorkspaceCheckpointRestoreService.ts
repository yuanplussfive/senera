import path from "node:path";
import { z } from "zod";
import { resolveArtifactsConfig } from "../AgentDefaults.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { AgentCancellationError, throwIfAborted } from "../Core/AgentCancellation.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { assertInsideRoot, parseAgentArtifactUri } from "./AgentArtifactLocator.js";
import { openVerifiedArtifactFile, type AgentArtifactContentIdentity } from "./AgentArtifactIntegrity.js";
import {
  readAgentWorkspaceSnapshot,
  restoreAgentWorkspaceCheckpoint,
  AgentWorkspaceCheckpointConflictError,
  type AgentWorkspaceCheckpointRestoreResult,
} from "./AgentWorkspaceCheckpointRecovery.js";
import {
  AgentWorkspaceContinuityCheckpointSchema,
  workspaceSnapshotRevision,
} from "../Continuity/AgentContinuityLedger.js";
import { missingWorkspaceSnapshot } from "./AgentWorkspaceSnapshotUtils.js";
import type { ToolWorkspaceFileSnapshot, ToolWorkspaceSnapshot } from "../Types/ToolRuntimeTypes.js";
import { SeneraWorkspaceBoundary } from "../Execution/SeneraWorkspaceBoundary.js";
import { AgentArtifactManifestIndexCache } from "../Memory/AgentArtifactManifestIndexCache.js";
import { WorkspaceSnapshotContentsSchema, type ArtifactSnapshotContent } from "../Memory/AgentArtifactMemoryTypes.js";
import { AgentResourceAccessIntents } from "../Safety/AgentResourceAccessPolicy.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";

const WorkspaceArtifactManifestSchema = z
  .object({
    files: z
      .object({
        before: z.string().trim().min(1),
        after: z.string().trim().min(1),
      })
      .passthrough(),
    snapshotContents: WorkspaceSnapshotContentsSchema,
    checkpoint: AgentWorkspaceContinuityCheckpointSchema,
  })
  .passthrough();

export interface AgentWorkspaceCheckpointRestoreRequest {
  readonly artifactUri?: string;
  readonly checkpointId?: string;
  readonly currentRevision?: string;
  readonly target: "before" | "after";
  readonly signal?: AbortSignal;
}

export interface AgentWorkspaceCheckpointRestoreOperation extends AgentWorkspaceCheckpointRestoreResult {
  readonly artifactUri: string;
  readonly checkpoint: z.infer<typeof AgentWorkspaceContinuityCheckpointSchema>;
  readonly target: "before" | "after";
}

/** The Artifact or checkpoint identity does not resolve to a published transaction. */
export class AgentWorkspaceCheckpointNotFoundError extends AgentBaseError {}

/** A published checkpoint's manifest or verified snapshot is not usable. */
export class AgentWorkspaceCheckpointArtifactError extends AgentBaseError {}

/**
 * Resolves a published workspace checkpoint and restores it through the same
 * verified Artifact path regardless of whether the request came from a Tool
 * or a user-confirmed workspace action.
 */
export class AgentWorkspaceCheckpointRestoreService {
  constructor(
    private readonly options: {
      readonly workspaceRoot: string;
      readonly config: AgentSystemConfig;
      readonly manifestIndex: AgentArtifactManifestIndexCache;
    },
  ) {}

  async restore(input: AgentWorkspaceCheckpointRestoreRequest): Promise<AgentWorkspaceCheckpointRestoreOperation> {
    const published = await this.readCheckpoint(input);
    const result = await restoreAgentWorkspaceCheckpoint({
      workspaceRoot: this.options.workspaceRoot,
      artifactRoot: published.artifactRoot,
      checkpoint: published.checkpoint,
      target: input.target === "before" ? published.before : published.after,
      currentSnapshot: input.target === "before" ? published.after : published.before,
      ...(input.currentRevision ? { currentRevision: input.currentRevision } : {}),
      targetKind: input.target,
      signal: input.signal,
    });
    return { ...result, artifactUri: published.artifactUri, checkpoint: published.checkpoint, target: input.target };
  }

  /** Compose verified transactions before writing, so a later conflict cannot leave a partial turn undo. */
  async undoMany(references: readonly { artifactUri: string; checkpointId: string }[]) {
    if (references.length === 0)
      throw new AgentWorkspaceCheckpointNotFoundError("No workspace checkpoints were supplied.");
    const published = await Promise.all(references.map((reference) => this.readCheckpoint(reference)));
    const before = new Map<string, ToolWorkspaceFileSnapshot>();
    const after = new Map<string, ToolWorkspaceFileSnapshot>();
    for (const transaction of published) {
      const beforeFiles = new Map(transaction.before.files.map((file) => [file.path, file]));
      const afterFiles = new Map(transaction.after.files.map((file) => [file.path, file]));
      for (const filePath of transaction.checkpoint.changedPaths) {
        if (!beforeFiles.has(filePath) && !afterFiles.has(filePath)) {
          throw new AgentWorkspaceCheckpointArtifactError(`Checkpoint does not capture ${filePath}.`);
        }
        const absent = missingWorkspaceSnapshot(filePath, path.resolve(this.options.workspaceRoot, filePath));
        const original = beforeFiles.get(filePath) ?? absent;
        const current = afterFiles.get(filePath) ?? absent;
        const previous = after.get(filePath);
        if (previous && revisionOfFiles([previous]) !== revisionOfFiles([original])) {
          throw new AgentWorkspaceCheckpointConflictError(
            `Workspace checkpoint chain is discontinuous at ${filePath}.`,
          );
        }
        if (!before.has(filePath)) before.set(filePath, original);
        after.set(filePath, current);
      }
    }
    const target: ToolWorkspaceSnapshot = { files: [...before.values()], capturedAt: published[0]!.before.capturedAt };
    const currentSnapshot: ToolWorkspaceSnapshot = {
      files: [...after.values()],
      capturedAt: published.at(-1)!.after.capturedAt,
    };
    const checkpoint = {
      ...published.at(-1)!.checkpoint,
      baseRevision: workspaceSnapshotRevision(target),
      revision: workspaceSnapshotRevision(currentSnapshot),
      changedPaths: [...before.keys()],
    };
    const result = await restoreAgentWorkspaceCheckpoint({
      workspaceRoot: this.options.workspaceRoot,
      artifactRoot: published[0]!.artifactRoot,
      checkpoint,
      target,
      currentSnapshot,
      targetKind: "before",
      requireComplete: true,
    });
    return { ...result, checkpointIds: published.map((entry) => entry.checkpoint.id) };
  }

  private async readCheckpoint(
    input: Pick<AgentWorkspaceCheckpointRestoreRequest, "artifactUri" | "checkpointId" | "signal">,
  ) {
    throwIfAborted(input.signal);
    const artifactRoot = await resolveArtifactRoot(
      this.options.workspaceRoot,
      resolveArtifactsConfig(this.options.config).RootDir,
    );
    const requestedArtifactId = input.artifactUri ? parseAgentArtifactUri(input.artifactUri) : undefined;
    if (input.artifactUri && !requestedArtifactId) {
      throw new AgentWorkspaceCheckpointNotFoundError("The requested workspace checkpoint Artifact was not found.");
    }
    const indexedCheckpoint = await this.options.manifestIndex.findCheckpoint({
      artifactRoot,
      workspaceRoot: this.options.workspaceRoot,
      artifactId: requestedArtifactId,
      checkpointId: input.checkpointId,
    });
    if (!indexedCheckpoint) {
      throw new AgentWorkspaceCheckpointNotFoundError("The requested workspace checkpoint was not found.");
    }
    const manifests = await this.options.manifestIndex.load({
      artifactRoot,
      workspaceRoot: this.options.workspaceRoot,
      requiredArtifactIds: [indexedCheckpoint.artifactId],
    });
    const manifest = manifests.get(indexedCheckpoint.artifactId);
    if (!manifest) throw new AgentWorkspaceCheckpointNotFoundError("The requested workspace checkpoint was not found.");

    const workspace = readWorkspaceManifest(manifest.workspace);
    const checkpoint = workspace.checkpoint;
    if (input.checkpointId && checkpoint.id !== input.checkpointId) {
      throw new AgentWorkspaceCheckpointNotFoundError("The requested workspace checkpoint was not found.");
    }
    if (checkpoint.artifactUri && parseAgentArtifactUri(checkpoint.artifactUri) !== indexedCheckpoint.artifactId) {
      throw new AgentWorkspaceCheckpointArtifactError(
        "The published workspace checkpoint does not match its Artifact.",
      );
    }

    const [before, after] = await Promise.all([
      readSnapshotFile(workspace.files.before, artifactRoot, workspace.snapshotContents.before, input.signal),
      readSnapshotFile(workspace.files.after, artifactRoot, workspace.snapshotContents.after, input.signal),
    ]);
    if (
      workspaceSnapshotRevision(before) !== checkpoint.baseRevision ||
      workspaceSnapshotRevision(after) !== checkpoint.revision
    ) {
      throw new AgentWorkspaceCheckpointArtifactError("Workspace snapshots do not match their checkpoint revisions.");
    }
    return { artifactRoot, artifactUri: manifest.artifactUri, checkpoint, before, after };
  }
}

function revisionOfFiles(files: ToolWorkspaceFileSnapshot[]): string {
  return workspaceSnapshotRevision({ files, capturedAt: "" });
}

function readWorkspaceManifest(value: unknown): z.infer<typeof WorkspaceArtifactManifestSchema> {
  const parsed = WorkspaceArtifactManifestSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new AgentWorkspaceCheckpointArtifactError("The published workspace checkpoint manifest is invalid.", {
    cause: parsed.error,
  });
}

async function readSnapshotFile(
  filePath: string,
  artifactRoot: string,
  identity: AgentArtifactContentIdentity & ArtifactSnapshotContent,
  signal: AbortSignal | undefined,
) {
  try {
    throwIfAborted(signal);
    const boundary = new SeneraWorkspaceBoundary({ workspaceRoot: artifactRoot, linkPolicy: "deny" });
    const resolved = await boundary.resolve(filePath, AgentResourceAccessIntents.Read);
    const declared = await boundary.resolve(identity.file, AgentResourceAccessIntents.Read);
    if (declared.absolutePath !== resolved.absolutePath) {
      throw new AgentWorkspaceCheckpointArtifactError(
        "Workspace snapshot integrity metadata points to a different file.",
      );
    }
    const verified = await openVerifiedArtifactFile(boundary, resolved.absolutePath, identity, signal);
    try {
      const value = JSON.parse(await verified.readFile({ encoding: "utf8" })) as unknown;
      throwIfAborted(signal);
      const snapshot = readAgentWorkspaceSnapshot(value);
      // Content paths in each snapshot are relative to its owning Artifact, not
      // the global Artifact root. Preserve that ownership when composing a turn.
      return {
        ...snapshot,
        files: snapshot.files.map((entry) => {
          if (entry.content?.state !== "captured" || !entry.content.relativeArtifactPath) return entry;
          const artifactPath = assertInsideRoot(
            path.dirname(resolved.absolutePath),
            path.resolve(path.dirname(resolved.absolutePath), entry.content.relativeArtifactPath),
            `Workspace snapshot content escapes its Artifact: ${entry.path}`,
          );
          const { relativeArtifactPath: _relative, ...content } = entry.content;
          return { ...entry, content: { ...content, artifactPath } };
        }),
      };
    } finally {
      await verified.close().catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof AgentWorkspaceCheckpointArtifactError || error instanceof AgentCancellationError) throw error;
    throw new AgentWorkspaceCheckpointArtifactError(
      "The published workspace checkpoint snapshot failed integrity verification.",
      {
        cause: error instanceof Error ? error : new Error(errorMessage(error)),
      },
    );
  }
}

async function resolveArtifactRoot(workspaceRoot: string, rootDir: string): Promise<string> {
  const lexicalRoot = assertInsideRoot(
    workspaceRoot,
    path.resolve(workspaceRoot, rootDir),
    `Artifact root is outside the workspace: ${rootDir}`,
  );
  const resolved = await new SeneraWorkspaceBoundary({ workspaceRoot, linkPolicy: "deny" }).resolve(
    lexicalRoot,
    AgentResourceAccessIntents.Read,
  );
  return resolved.absolutePath;
}
