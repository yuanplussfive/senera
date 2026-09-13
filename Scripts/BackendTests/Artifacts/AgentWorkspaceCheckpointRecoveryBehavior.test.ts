import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  AgentWorkspaceCheckpointConflictError,
  restoreAgentWorkspaceCheckpoint,
} from "../../../Source/AgentSystem/Artifacts/AgentWorkspaceCheckpointRecovery.js";
import {
  createAgentWorkspaceContinuityCheckpoint,
  workspaceSnapshotRevision,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityLedger.js";
import { hashWorkspaceText } from "../../../Source/AgentSystem/Artifacts/AgentWorkspaceSnapshotUtils.js";
import type {
  ToolWorkspaceChange,
  ToolWorkspaceFileSnapshot,
  ToolWorkspaceSnapshot,
} from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("workspace checkpoint recovery", () => {
  test("restores captured content without deleting unrelated workspace files", async () => {
    const workspaceRoot = await createRoot("senera-workspace-recovery-");
    const before = snapshot(workspaceRoot, "old");
    const after = snapshot(workspaceRoot, "new");
    const checkpoint = createCheckpoint(before, after);
    await fs.writeFile(path.join(workspaceRoot, "unrelated.txt"), "keep", "utf8");
    await fs.writeFile(path.join(workspaceRoot, "src.txt"), "old", "utf8");

    const result = await restoreAgentWorkspaceCheckpoint({
      workspaceRoot,
      checkpoint,
      target: after,
      currentRevision: workspaceSnapshotRevision(before),
    });

    expect(result.restoredPaths).toEqual(["src.txt"]);
    await expect(fs.readFile(path.join(workspaceRoot, "src.txt"), "utf8")).resolves.toBe("new");
    await expect(fs.readFile(path.join(workspaceRoot, "unrelated.txt"), "utf8")).resolves.toBe("keep");
  });

  test("rejects a stale workspace before mutating any target", async () => {
    const workspaceRoot = await createRoot("senera-workspace-conflict-");
    const before = snapshot(workspaceRoot, "old");
    const after = snapshot(workspaceRoot, "new");
    const checkpoint = createCheckpoint(before, after);
    await fs.writeFile(path.join(workspaceRoot, "src.txt"), "changed", "utf8");

    await expect(
      restoreAgentWorkspaceCheckpoint({
        workspaceRoot,
        checkpoint,
        target: after,
        currentRevision: "sha256:stale",
      }),
    ).rejects.toBeInstanceOf(AgentWorkspaceCheckpointConflictError);
    await expect(fs.readFile(path.join(workspaceRoot, "src.txt"), "utf8")).resolves.toBe("changed");
  });

  test("requires an optimistic concurrency guard", async () => {
    const workspaceRoot = await createRoot("senera-workspace-recovery-guard-");
    const before = snapshot(workspaceRoot, "old");
    const after = snapshot(workspaceRoot, "new");
    const checkpoint = createCheckpoint(before, after);

    await expect(
      restoreAgentWorkspaceCheckpoint({
        workspaceRoot,
        checkpoint,
        target: after,
      }),
    ).rejects.toThrow("requires a live workspace revision guard");
    await expect(fs.readFile(path.join(workspaceRoot, "src.txt"), "utf8")).resolves.toBe("old");
  });

  test("rejects an uncovered target path that appeared after the checkpoint", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "senera-workspace-recovery-uncovered-"));
    temporaryRoots.push(workspaceRoot);
    await fs.writeFile(path.join(workspaceRoot, "src.txt"), "old", "utf8");
    const before = snapshot(workspaceRoot, "old");
    const newPath = path.join(workspaceRoot, "new.txt");
    const after: ToolWorkspaceSnapshot = {
      ...before,
      files: [
        ...before.files,
        {
          path: "new.txt",
          absolutePath: newPath,
          exists: true,
          kind: "file",
          size: 3,
          mtimeMs: 0,
          hash: hashWorkspaceText("new"),
          content: {
            state: "captured",
            encoding: "utf8",
            byteLength: 3,
            lineCount: 1,
            text: "new",
          },
        },
      ],
    };
    const checkpoint = createAgentWorkspaceContinuityCheckpoint({
      before,
      after,
      changes: [
        {
          path: "new.txt",
          absolutePath: newPath,
          status: "added",
          beforeKind: "missing",
          afterKind: "file",
          beforeHash: "",
          afterHash: hashWorkspaceText("new"),
          beforeSize: 0,
          afterSize: 3,
        },
      ],
    });
    await fs.writeFile(newPath, "user", "utf8");

    await expect(
      restoreAgentWorkspaceCheckpoint({
        workspaceRoot,
        checkpoint,
        target: after,
        currentSnapshot: before,
        currentRevision: workspaceSnapshotRevision(before),
      }),
    ).rejects.toThrow("was not covered by the checkpoint's current snapshot");
    await expect(fs.readFile(newPath, "utf8")).resolves.toBe("user");
  });

  test("reads archived content through the artifact root and relative locator", async () => {
    const workspaceRoot = await createRoot("senera-workspace-artifact-recovery-");
    const artifactRoot = path.join(workspaceRoot, "artifacts");
    const artifactFile = path.join(artifactRoot, "workspace", "after", "src.txt");
    await fs.mkdir(path.dirname(artifactFile), { recursive: true });
    await fs.writeFile(artifactFile, "from artifact", "utf8");
    const before = snapshot(workspaceRoot, "old");
    const after = snapshot(workspaceRoot, "from artifact", {
      artifactPath: artifactFile,
      relativeArtifactPath: "workspace/after/src.txt",
    });
    const checkpoint = createCheckpoint(before, after);
    await fs.writeFile(path.join(workspaceRoot, "src.txt"), "old", "utf8");

    await restoreAgentWorkspaceCheckpoint({
      workspaceRoot,
      artifactRoot,
      checkpoint,
      target: after,
      currentRevision: workspaceSnapshotRevision(before),
    });

    await expect(fs.readFile(path.join(workspaceRoot, "src.txt"), "utf8")).resolves.toBe("from artifact");
  });

  test("rejects tampered archived content before writing", async () => {
    const workspaceRoot = await createRoot("senera-workspace-artifact-integrity-");
    const artifactRoot = path.join(workspaceRoot, "artifacts");
    const artifactFile = path.join(artifactRoot, "workspace", "after", "src.txt");
    await fs.mkdir(path.dirname(artifactFile), { recursive: true });
    await fs.writeFile(artifactFile, "tampered", "utf8");
    const before = snapshot(workspaceRoot, "old");
    const after = snapshot(workspaceRoot, "from artifact", {
      artifactPath: artifactFile,
      relativeArtifactPath: "workspace/after/src.txt",
    });
    const checkpoint = createCheckpoint(before, after);
    await fs.writeFile(path.join(workspaceRoot, "src.txt"), "old", "utf8");

    await expect(
      restoreAgentWorkspaceCheckpoint({
        workspaceRoot,
        artifactRoot,
        checkpoint,
        target: after,
        currentRevision: workspaceSnapshotRevision(before),
      }),
    ).rejects.toBeInstanceOf(AgentWorkspaceCheckpointConflictError);
    await expect(fs.readFile(path.join(workspaceRoot, "src.txt"), "utf8")).resolves.toBe("old");
  });

  test("restores directory/file type changes in dependency order", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "senera-workspace-recovery-type-change-"));
    temporaryRoots.push(workspaceRoot);
    const nodePath = path.join(workspaceRoot, "node");
    const childPath = path.join(nodePath, "child.txt");
    await fs.mkdir(nodePath, { recursive: true });
    await fs.writeFile(childPath, "after", "utf8");

    const before: ToolWorkspaceSnapshot = {
      capturedAt: "2026-09-12T00:00:00.000Z",
      files: [fileSnapshotAt(workspaceRoot, "node", "before"), missingSnapshotAt(workspaceRoot, "node/child.txt")],
    };
    const after: ToolWorkspaceSnapshot = {
      capturedAt: "2026-09-12T00:00:00.000Z",
      files: [directorySnapshotAt(workspaceRoot, "node"), fileSnapshotAt(workspaceRoot, "node/child.txt", "after")],
    };
    const changes: ToolWorkspaceChange[] = [
      {
        path: "node",
        absolutePath: nodePath,
        status: "type_changed",
        beforeKind: "file",
        afterKind: "directory",
        beforeHash: before.files[0]!.hash,
        afterHash: after.files[0]!.hash,
        beforeSize: before.files[0]!.size,
        afterSize: after.files[0]!.size,
      },
      {
        path: "node/child.txt",
        absolutePath: childPath,
        status: "added",
        beforeKind: "missing",
        afterKind: "file",
        beforeHash: "",
        afterHash: after.files[1]!.hash,
        beforeSize: 0,
        afterSize: after.files[1]!.size,
      },
    ];
    const checkpoint = createAgentWorkspaceContinuityCheckpoint({ before, after, changes });

    const result = await restoreAgentWorkspaceCheckpoint({
      workspaceRoot,
      checkpoint,
      target: before,
      currentRevision: workspaceSnapshotRevision(after),
      targetKind: "before",
    });

    expect(result.restoredPaths).toEqual(["node/child.txt", "node"]);
    await expect(fs.readFile(nodePath, "utf8")).resolves.toBe("before");

    const forwardResult = await restoreAgentWorkspaceCheckpoint({
      workspaceRoot,
      checkpoint,
      target: after,
      currentSnapshot: before,
      currentRevision: workspaceSnapshotRevision(before),
      targetKind: "after",
    });
    expect(forwardResult.restoredPaths).toEqual(["node", "node/child.txt"]);
    await expect(fs.readFile(childPath, "utf8")).resolves.toBe("after");
  });

  test("rolls back earlier writes when a later path cannot be restored", async () => {
    const workspaceRoot = await createRoot("senera-workspace-recovery-rollback-");
    const blockedPath = path.join(workspaceRoot, "z-block");
    await fs.mkdir(blockedPath, { recursive: true });
    await fs.writeFile(path.join(blockedPath, "keep.txt"), "keep", "utf8");

    const before: ToolWorkspaceSnapshot = {
      capturedAt: "2026-09-12T00:00:00.000Z",
      files: [fileSnapshotAt(workspaceRoot, "src.txt", "old"), directorySnapshotAt(workspaceRoot, "z-block")],
    };
    const after: ToolWorkspaceSnapshot = {
      capturedAt: "2026-09-12T00:00:01.000Z",
      files: [fileSnapshotAt(workspaceRoot, "src.txt", "new"), fileSnapshotAt(workspaceRoot, "z-block", "new")],
    };
    const checkpoint = createAgentWorkspaceContinuityCheckpoint({
      before,
      after,
      changes: [
        {
          path: "src.txt",
          absolutePath: path.join(workspaceRoot, "src.txt"),
          status: "modified",
          beforeKind: "file",
          afterKind: "file",
          beforeHash: before.files[0]!.hash,
          afterHash: after.files[0]!.hash,
          beforeSize: before.files[0]!.size,
          afterSize: after.files[0]!.size,
        },
        {
          path: "z-block",
          absolutePath: blockedPath,
          status: "type_changed",
          beforeKind: "directory",
          afterKind: "file",
          beforeHash: before.files[1]!.hash,
          afterHash: after.files[1]!.hash,
          beforeSize: before.files[1]!.size,
          afterSize: after.files[1]!.size,
        },
      ],
    });

    await expect(
      restoreAgentWorkspaceCheckpoint({
        workspaceRoot,
        checkpoint,
        target: after,
        currentRevision: workspaceSnapshotRevision(before),
      }),
    ).rejects.toThrow("non-empty workspace directory");
    await expect(fs.readFile(path.join(workspaceRoot, "src.txt"), "utf8")).resolves.toBe("old");
    await expect(fs.readFile(path.join(blockedPath, "keep.txt"), "utf8")).resolves.toBe("keep");
  });
});

async function createRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  await fs.writeFile(path.join(root, "src.txt"), "old", "utf8");
  return root;
}

function snapshot(
  workspaceRoot: string,
  content: string,
  contentOverride: { artifactPath: string; relativeArtifactPath: string } | undefined = undefined,
): ToolWorkspaceSnapshot {
  const file = fileSnapshot(workspaceRoot, content, contentOverride);
  return { capturedAt: "2026-09-12T00:00:00.000Z", files: [file] };
}

function fileSnapshot(
  workspaceRoot: string,
  content: string,
  contentOverride: { artifactPath: string; relativeArtifactPath: string } | undefined,
): ToolWorkspaceFileSnapshot {
  const bytes = Buffer.byteLength(content, "utf8");
  return {
    path: "src.txt",
    absolutePath: path.join(workspaceRoot, "src.txt"),
    exists: true,
    kind: "file",
    size: bytes,
    mtimeMs: 0,
    hash: hashWorkspaceText(content),
    content: {
      state: "captured",
      encoding: "utf8",
      byteLength: bytes,
      lineCount: 1,
      ...(contentOverride ? contentOverride : { text: content }),
    },
  };
}

function fileSnapshotAt(workspaceRoot: string, relativePath: string, content: string): ToolWorkspaceFileSnapshot {
  const bytes = Buffer.byteLength(content, "utf8");
  return {
    path: relativePath,
    absolutePath: path.join(workspaceRoot, relativePath),
    exists: true,
    kind: "file",
    size: bytes,
    mtimeMs: 0,
    hash: hashWorkspaceText(content),
    content: { state: "captured", encoding: "utf8", byteLength: bytes, lineCount: 1, text: content },
  };
}

function missingSnapshotAt(workspaceRoot: string, relativePath: string): ToolWorkspaceFileSnapshot {
  return {
    path: relativePath,
    absolutePath: path.join(workspaceRoot, relativePath),
    exists: false,
    kind: "missing",
    size: 0,
    mtimeMs: 0,
    hash: "",
    content: { state: "omitted", reason: "missing", byteLength: 0 },
  };
}

function directorySnapshotAt(workspaceRoot: string, relativePath: string): ToolWorkspaceFileSnapshot {
  return {
    path: relativePath,
    absolutePath: path.join(workspaceRoot, relativePath),
    exists: true,
    kind: "directory",
    size: 0,
    mtimeMs: 0,
    hash: hashWorkspaceText("directory:0:0"),
    content: { state: "omitted", reason: "directory", byteLength: 0 },
  };
}

function createCheckpoint(before: ToolWorkspaceSnapshot, after: ToolWorkspaceSnapshot) {
  const left = before.files[0]!;
  const right = after.files[0]!;
  const change: ToolWorkspaceChange = {
    path: "src.txt",
    absolutePath: right.absolutePath,
    status: "modified",
    beforeKind: left.kind,
    afterKind: right.kind,
    beforeHash: left.hash,
    afterHash: right.hash,
    beforeSize: left.size,
    afterSize: right.size,
  };
  return createAgentWorkspaceContinuityCheckpoint({ before, after, changes: [change] });
}
