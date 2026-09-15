import path from "node:path";
import { z } from "zod";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { assertInsideRoot, parseAgentArtifactUri } from "../Artifacts/AgentArtifactLocator.js";
import { AgentArtifactManifestIndexCache } from "../Memory/AgentArtifactManifestIndexCache.js";
import {
  WorkspaceSnapshotContentsSchema,
  type ArtifactManifestRecord,
  type ArtifactSnapshotContent,
} from "../Memory/AgentArtifactMemoryTypes.js";
import { resolveArtifactsConfig } from "../AgentDefaults.js";
import { SeneraWorkspaceBoundary } from "../Execution/SeneraWorkspaceBoundary.js";
import { AgentResourceAccessIntents } from "../Safety/AgentResourceAccessPolicy.js";
import { openVerifiedArtifactFile, type AgentArtifactContentIdentity } from "../Artifacts/AgentArtifactIntegrity.js";
import type { AgentHostToolHandler } from "./AgentToolHostCapabilityRegistry.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "./AgentToolProcessEnvelope.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessTypes.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import { AgentWorkspaceContinuityCheckpointSchema } from "../Continuity/AgentContinuityLedger.js";
import {
  readAgentWorkspaceSnapshot,
  restoreAgentWorkspaceCheckpoint,
} from "../Artifacts/AgentWorkspaceCheckpointRecovery.js";

const WorkspaceRestoreCheckpointArgumentsBaseSchema = z
  .object({
    artifactUri: z
      .string()
      .trim()
      .min(1)
      .describe("Artifact URI containing the captured workspace checkpoint.")
      .optional(),
    checkpointId: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Optional durable checkpoint id. When artifactUri is omitted, the host selects the newest matching Artifact.",
      )
      .optional(),
    currentRevision: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Legacy optional revision hint. The host derives the expected revision from the checkpoint and verifies the live workspace itself.",
      )
      .optional(),
    target: z
      .enum(["before", "after"])
      .default("after")
      .describe("Snapshot side to materialize. after resumes the captured change; before restores its base."),
  })
  .strict();

export const WorkspaceRestoreCheckpointArgumentsSchema = z.union([
  WorkspaceRestoreCheckpointArgumentsBaseSchema.extend({
    artifactUri: z.string().trim().min(1).describe("Artifact URI containing the captured workspace checkpoint."),
  }),
  WorkspaceRestoreCheckpointArgumentsBaseSchema.extend({
    checkpointId: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Optional durable checkpoint id. When artifactUri is omitted, the host selects the newest matching Artifact.",
      ),
  }),
]);

export type WorkspaceRestoreCheckpointArguments = z.infer<typeof WorkspaceRestoreCheckpointArgumentsSchema>;

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

const ManifestIndexes = new AgentArtifactManifestIndexCache();

export const restoreWorkspaceCheckpointHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = WorkspaceRestoreCheckpointArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return checkpointFailure({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: `${context.tool.name} arguments are invalid.`,
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        issues: parsed.error.issues,
        toolName: context.tool.name,
      },
      diagnostics: parsed.error.issues.map((issue) => ({
        message: issue.message,
        pointer: `/${issue.path.join("/")}`,
        path: issue.path.map((entry) => (typeof entry === "number" ? entry : String(entry))),
      })),
    });
  }

  try {
    throwIfAborted(context.signal);
    const artifactRoot = await resolveArtifactRoot(
      context.workspaceRoot,
      resolveArtifactsConfig(context.config).RootDir,
    );
    const requestedArtifactId = parsed.data.artifactUri ? parseAgentArtifactUri(parsed.data.artifactUri) : undefined;
    if (parsed.data.artifactUri && !requestedArtifactId) {
      throw new Error("artifactUri is not a valid Senera Artifact URI.");
    }
    const manifests = await ManifestIndexes.load({
      artifactRoot,
      workspaceRoot: context.workspaceRoot,
      requiredArtifactIds: requestedArtifactId ? [requestedArtifactId] : [],
    });
    const selected = selectWorkspaceCheckpointManifest(manifests, {
      artifactId: requestedArtifactId,
      checkpointId: parsed.data.checkpointId,
    });
    if (!selected) {
      throw new Error(
        parsed.data.artifactUri
          ? `Artifact manifest was not found: ${parsed.data.artifactUri}`
          : `No published workspace checkpoint matched: ${parsed.data.checkpointId}`,
      );
    }
    const { manifest, artifactId } = selected;
    const workspace = readWorkspaceManifest(manifest.workspace);
    const checkpoint = workspace.checkpoint;
    if (parsed.data.checkpointId && checkpoint.id !== parsed.data.checkpointId) {
      throw new Error(`Workspace checkpoint was not found: ${parsed.data.checkpointId}`);
    }
    if (checkpoint.artifactUri && parseAgentArtifactUri(checkpoint.artifactUri) !== artifactId) {
      throw new Error("The workspace checkpoint artifactUri does not match the requested Artifact.");
    }
    const targetSnapshotPath = parsed.data.target === "before" ? workspace.files.before : workspace.files.after;
    const currentSnapshotPath = parsed.data.target === "before" ? workspace.files.after : workspace.files.before;
    const [snapshot, currentSnapshot] = await Promise.all([
      readSnapshotFile(
        targetSnapshotPath,
        artifactRoot,
        parsed.data.target === "before" ? workspace.snapshotContents.before : workspace.snapshotContents.after,
        context.signal,
      ),
      readSnapshotFile(
        currentSnapshotPath,
        artifactRoot,
        parsed.data.target === "before" ? workspace.snapshotContents.after : workspace.snapshotContents.before,
        context.signal,
      ),
    ]);
    const result = await restoreAgentWorkspaceCheckpoint({
      workspaceRoot: context.workspaceRoot,
      artifactRoot,
      checkpoint,
      target: snapshot,
      ...(parsed.data.currentRevision ? { currentRevision: parsed.data.currentRevision } : {}),
      currentSnapshot,
      targetKind: parsed.data.target,
      signal: context.signal,
    });
    return toolProcessSuccessResult({
      text: `Workspace checkpoint ${checkpoint.id} restored the ${parsed.data.target} snapshot over ${result.restoredPaths.length} path(s).`,
      artifactUri: manifest.artifactUri,
      checkpoint,
      target: parsed.data.target,
      ...result,
    });
  } catch (error) {
    return checkpointFailure({
      code: AgentExecutionErrorCodes.ToolExecutionError,
      message: errorMessage(error),
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        toolName: context.tool.name,
        ...(parsed.data.artifactUri ? { artifactUri: parsed.data.artifactUri } : {}),
        ...(parsed.data.checkpointId ? { checkpointId: parsed.data.checkpointId } : {}),
      },
    });
  }
};

function readWorkspaceManifest(value: unknown): z.infer<typeof WorkspaceArtifactManifestSchema> {
  return WorkspaceArtifactManifestSchema.parse(value);
}

function selectWorkspaceCheckpointManifest(
  manifests: ReadonlyMap<string, ArtifactManifestRecord>,
  input: { readonly artifactId?: string; readonly checkpointId?: string },
): { readonly artifactId: string; readonly manifest: ArtifactManifestRecord } | undefined {
  const candidates = [...manifests.entries()].flatMap(([artifactId, manifest]) => {
    if (input.artifactId && artifactId !== input.artifactId) return [];
    // Most Artifact manifests are not workspace checkpoints. Only manifests
    // that declare a workspace payload participate; a declared-but-malformed
    // payload is corruption and must not silently fall back to an older one.
    if (!isCheckpointWorkspacePayload(manifest.workspace)) return [];
    const workspace = readWorkspaceManifest(manifest.workspace);
    if (input.checkpointId && workspace.checkpoint.id !== input.checkpointId) return [];
    return [{ artifactId, manifest, capturedAt: workspace.checkpoint.capturedAt }];
  });
  candidates.sort(
    (left, right) =>
      compareCheckpointTime(right.capturedAt, left.capturedAt) || left.artifactId.localeCompare(right.artifactId),
  );
  const selected = candidates[0];
  return selected ? { artifactId: selected.artifactId, manifest: selected.manifest } : undefined;
}

function isCheckpointWorkspacePayload(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "checkpoint" in value;
}

function compareCheckpointTime(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) return leftMs - rightMs;
  return left.localeCompare(right);
}

async function readSnapshotFile(
  filePath: string,
  artifactRoot: string,
  identity: AgentArtifactContentIdentity & ArtifactSnapshotContent,
  signal: AbortSignal | undefined,
) {
  throwIfAborted(signal);
  const boundary = new SeneraWorkspaceBoundary({ workspaceRoot: artifactRoot, linkPolicy: "deny" });
  const resolved = await boundary.resolve(filePath, AgentResourceAccessIntents.Read);
  const declared = await boundary.resolve(identity.file, AgentResourceAccessIntents.Read);
  if (declared.absolutePath !== resolved.absolutePath) {
    throw new Error(`Workspace snapshot integrity metadata points to a different file: ${filePath}`);
  }
  const verified = await openVerifiedArtifactFile(boundary, resolved.absolutePath, identity, signal);
  try {
    const value = JSON.parse(await verified.readFile({ encoding: "utf8" })) as unknown;
    throwIfAborted(signal);
    return readAgentWorkspaceSnapshot(value);
  } finally {
    await verified.close().catch(() => undefined);
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

function checkpointFailure(
  error: NonNullable<AgentToolProcessRunResult["response"]["error"]>,
): AgentToolProcessRunResult {
  return toolProcessFailureResult(error);
}
