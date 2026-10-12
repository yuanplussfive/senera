import { isUtf8 } from "node:buffer";
import path from "node:path";
import { z } from "zod";
import { createAgentWorkspaceContinuityCheckpoint } from "../Continuity/AgentContinuityLedger.js";
import { sha256Hex } from "../Core/AgentHash.js";
import type { ToolArtifactWorkspaceManifest } from "../Types/AgentToolContractTypes.js";
import {
  AgentWorkspaceChangeSetProtocol,
  AgentWorkspaceMutationReceiptProtocol,
  type AgentWorkspaceMutationReceipt,
  type AgentWorkspaceMutationReceiptEntry,
  type AgentWorkspaceMutationReceiptImage,
  type ToolWorkspaceCaptureResult,
  type ToolWorkspaceFileContentSnapshot,
  type ToolWorkspaceFileSnapshot,
  type ToolWorkspaceSnapshot,
} from "../Types/ToolRuntimeTypes.js";
import { assertInsideRoot } from "./AgentArtifactLocator.js";
import { compareWorkspaceSnapshots } from "./AgentWorkspaceSnapshotDiff.js";
import {
  countLines,
  isProbablyBinary,
  missingWorkspaceSnapshot,
  normalizeWorkspaceRelativePath,
} from "./AgentWorkspaceSnapshotUtils.js";

const WorkspaceMutationImageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("missing") }).strict(),
  z.object({ kind: z.literal("directory") }).strict(),
  z.object({ kind: z.literal("file"), bytes: z.instanceof(Uint8Array) }).strict(),
]);

const WorkspaceMutationReceiptSchema = z
  .object({
    type: z.literal(AgentWorkspaceMutationReceiptProtocol.type),
    version: z.literal(AgentWorkspaceMutationReceiptProtocol.version),
    capturedAt: z.string().min(1),
    entries: z.array(
      z
        .object({
          path: z.string().min(1),
          before: WorkspaceMutationImageSchema,
          after: WorkspaceMutationImageSchema,
        })
        .strict(),
    ),
  })
  .strict();

interface WorkspaceReceiptOptions {
  readonly maxFileBytes: number;
  readonly captureContent: "none" | "text";
}

/**
 * Converts writer-owned transaction images into the bounded, durable ChangeSet
 * stored with a tool Artifact. This path never reads the workspace or Git.
 */
export function materializeAgentWorkspaceMutationReceipt(input: {
  readonly receipt: AgentWorkspaceMutationReceipt | undefined;
  readonly workspaceRoot: string;
  readonly workspacePolicy: ToolArtifactWorkspaceManifest;
}): ToolWorkspaceCaptureResult {
  const receipt = readWorkspaceMutationReceipt(input.receipt);
  const options = resolveWorkspaceReceiptOptions(input.workspacePolicy);
  const before = createSnapshot(receipt, input.workspaceRoot, options, "before");
  const after = createSnapshot(receipt, input.workspaceRoot, options, "after");
  const changes = compareWorkspaceSnapshots(before, after);

  return {
    type: AgentWorkspaceChangeSetProtocol.type,
    version: AgentWorkspaceChangeSetProtocol.version,
    source: "mutation-receipt",
    coverage: "exact",
    before,
    after,
    changes,
    checkpoint: createAgentWorkspaceContinuityCheckpoint({ before, after, changes }),
  };
}

function readWorkspaceMutationReceipt(value: AgentWorkspaceMutationReceipt | undefined): AgentWorkspaceMutationReceipt {
  const parsed = WorkspaceMutationReceiptSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Workspace mutation receipt is missing or invalid: ${parsed.error.issues[0]?.message ?? "unknown error"}.`,
    );
  }

  const entries = parsed.data.entries as readonly AgentWorkspaceMutationReceiptEntry[];
  const paths = new Set<string>();
  for (const entry of entries) {
    if (paths.has(entry.path)) throw new Error(`Workspace mutation receipt contains duplicate path: ${entry.path}.`);
    paths.add(entry.path);
  }

  return {
    type: parsed.data.type,
    version: parsed.data.version,
    capturedAt: parsed.data.capturedAt,
    entries,
  };
}

function resolveWorkspaceReceiptOptions(workspace: ToolArtifactWorkspaceManifest): WorkspaceReceiptOptions {
  return {
    maxFileBytes: workspace.MaxFileBytes,
    captureContent: workspace.CaptureContent,
  };
}

function createSnapshot(
  receipt: AgentWorkspaceMutationReceipt,
  workspaceRoot: string,
  options: WorkspaceReceiptOptions,
  side: "before" | "after",
): ToolWorkspaceSnapshot {
  return {
    capturedAt: receipt.capturedAt,
    status: "complete",
    files: receipt.entries
      .map((entry) => createFileSnapshot(workspaceRoot, entry.path, entry[side], options))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function createFileSnapshot(
  workspaceRoot: string,
  value: string,
  image: AgentWorkspaceMutationReceiptImage,
  options: WorkspaceReceiptOptions,
): ToolWorkspaceFileSnapshot {
  if (value.includes("\0")) {
    throw new Error("Workspace mutation receipt path contains a NUL character.");
  }
  const relativePath = normalizeWorkspaceRelativePath(value);
  if (!relativePath || relativePath === "." || relativePath !== value) {
    throw new Error(`Workspace mutation receipt path is not canonical: ${JSON.stringify(value)}.`);
  }
  const absolutePath = assertInsideRoot(
    workspaceRoot,
    path.resolve(workspaceRoot, relativePath),
    `workspace mutation receipt path escapes workspace: ${relativePath}`,
  );

  switch (image.kind) {
    case "missing":
      return missingWorkspaceSnapshot(relativePath, absolutePath);
    case "directory":
      return directorySnapshot(relativePath, absolutePath);
    case "file":
      return fileSnapshot(relativePath, absolutePath, image.bytes, options);
  }
}

function directorySnapshot(relativePath: string, absolutePath: string): ToolWorkspaceFileSnapshot {
  return {
    path: relativePath,
    absolutePath,
    exists: true,
    kind: "directory",
    size: 0,
    // Receipts describe a transaction image, not a later filesystem stat.
    mtimeMs: 0,
    hash: `sha256:${sha256Hex("directory")}`,
    content: { state: "omitted", reason: "directory", byteLength: 0 },
  };
}

function fileSnapshot(
  relativePath: string,
  absolutePath: string,
  bytes: Uint8Array,
  options: WorkspaceReceiptOptions,
): ToolWorkspaceFileSnapshot {
  const buffer = Buffer.from(bytes);
  return {
    path: relativePath,
    absolutePath,
    exists: true,
    kind: "file",
    size: buffer.byteLength,
    mtimeMs: 0,
    hash: `sha256:${sha256Hex(buffer)}`,
    content: captureReceiptFileContent(buffer, options),
  };
}

function captureReceiptFileContent(buffer: Buffer, options: WorkspaceReceiptOptions): ToolWorkspaceFileContentSnapshot {
  if (options.captureContent === "none") {
    return { state: "omitted", reason: "not_requested", byteLength: buffer.byteLength };
  }
  if (buffer.byteLength > options.maxFileBytes) {
    return { state: "omitted", reason: "size_limit", byteLength: buffer.byteLength };
  }
  if (!isUtf8(buffer) || isProbablyBinary(buffer)) {
    return { state: "omitted", reason: "binary", byteLength: buffer.byteLength };
  }

  const text = buffer.toString("utf8");
  return {
    state: "captured",
    encoding: "utf8",
    byteLength: buffer.byteLength,
    lineCount: countLines(text),
    text,
  };
}
