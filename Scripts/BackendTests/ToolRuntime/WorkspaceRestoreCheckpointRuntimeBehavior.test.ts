import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createAgentArtifactUri } from "../../../Source/AgentSystem/Artifacts/AgentArtifactLocator.js";
import { hashWorkspaceText } from "../../../Source/AgentSystem/Artifacts/AgentWorkspaceSnapshotUtils.js";
import {
  createAgentWorkspaceContinuityCheckpoint,
  workspaceSnapshotRevision,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityLedger.js";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import type { AgentHostToolContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { restoreWorkspaceCheckpointHostTool } from "../../../Source/AgentSystem/ToolRuntime/AgentWorkspaceCheckpointRuntime.js";
import type {
  ToolWorkspaceChange,
  ToolWorkspaceFileSnapshot,
  ToolWorkspaceSnapshot,
} from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("WorkspaceRestoreCheckpoint host tool", () => {
  test("restores both sides of a published checkpoint through the Artifact manifest", async () => {
    const fixture = await createFixture();
    await fs.writeFile(path.join(fixture.workspaceRoot, "src.txt"), "old", "utf8");

    const afterResult = await restoreWorkspaceCheckpointHostTool(
      {
        artifactUri: fixture.artifactUri,
        currentRevision: fixture.beforeRevision,
        target: "after",
      },
      createContext(fixture.workspaceRoot),
    );
    expect(afterResult.response).toMatchObject({ ok: true, result: { target: "after", restoredPaths: ["src.txt"] } });
    await expect(fs.readFile(path.join(fixture.workspaceRoot, "src.txt"), "utf8")).resolves.toBe("new");

    const beforeResult = await restoreWorkspaceCheckpointHostTool(
      {
        artifactUri: fixture.artifactUri,
        currentRevision: fixture.afterRevision,
        target: "before",
      },
      createContext(fixture.workspaceRoot),
    );
    expect(beforeResult.response).toMatchObject({ ok: true, result: { target: "before", restoredPaths: ["src.txt"] } });
    await expect(fs.readFile(path.join(fixture.workspaceRoot, "src.txt"), "utf8")).resolves.toBe("old");
  });

  test("selects the newest published checkpoint by id when the Artifact URI is omitted", async () => {
    const fixture = await createFixture();
    await fs.writeFile(path.join(fixture.workspaceRoot, "src.txt"), "old", "utf8");

    const result = await restoreWorkspaceCheckpointHostTool(
      { checkpointId: fixture.checkpointId, currentRevision: fixture.beforeRevision, target: "after" },
      createContext(fixture.workspaceRoot),
    );

    expect(result.response).toMatchObject({ ok: true, result: { artifactUri: fixture.artifactUri, target: "after" } });
    await expect(fs.readFile(path.join(fixture.workspaceRoot, "src.txt"), "utf8")).resolves.toBe("new");
  });

  test("derives the concurrency revision when the legacy hint is omitted", async () => {
    const fixture = await createFixture();
    await fs.writeFile(path.join(fixture.workspaceRoot, "src.txt"), "old", "utf8");

    const result = await restoreWorkspaceCheckpointHostTool(
      { artifactUri: fixture.artifactUri, target: "after" },
      createContext(fixture.workspaceRoot),
    );

    expect(result.response).toMatchObject({ ok: true, result: { target: "after", restoredPaths: ["src.txt"] } });
    await expect(fs.readFile(path.join(fixture.workspaceRoot, "src.txt"), "utf8")).resolves.toBe("new");
  });

  test("rejects a stale revision before mutating the workspace", async () => {
    const fixture = await createFixture();
    await fs.writeFile(path.join(fixture.workspaceRoot, "src.txt"), "user-change", "utf8");

    const result = await restoreWorkspaceCheckpointHostTool(
      { artifactUri: fixture.artifactUri, currentRevision: "sha256:stale", target: "after" },
      createContext(fixture.workspaceRoot),
    );

    expect(result.response).toMatchObject({ ok: false, error: { message: expect.stringContaining("changed") } });
    await expect(fs.readFile(path.join(fixture.workspaceRoot, "src.txt"), "utf8")).resolves.toBe("user-change");
  });

  test("does not trust a matching model-supplied revision after the workspace changes", async () => {
    const fixture = await createFixture();
    await fs.writeFile(path.join(fixture.workspaceRoot, "src.txt"), "user-change", "utf8");

    const result = await restoreWorkspaceCheckpointHostTool(
      { artifactUri: fixture.artifactUri, currentRevision: fixture.beforeRevision, target: "after" },
      createContext(fixture.workspaceRoot),
    );

    expect(result.response).toMatchObject({ ok: false, error: { message: expect.stringContaining("changed") } });
    await expect(fs.readFile(path.join(fixture.workspaceRoot, "src.txt"), "utf8")).resolves.toBe("user-change");
  });

  test("rejects a tampered published snapshot before mutating the workspace", async () => {
    const fixture = await createFixture();
    await fs.writeFile(path.join(fixture.workspaceRoot, "src.txt"), "old", "utf8");
    await fs.writeFile(fixture.afterPath, JSON.stringify({ ...fixture.afterSnapshot, warnings: ["tampered"] }), "utf8");

    const result = await restoreWorkspaceCheckpointHostTool(
      { artifactUri: fixture.artifactUri, currentRevision: fixture.beforeRevision, target: "after" },
      createContext(fixture.workspaceRoot),
    );

    expect(result.response).toMatchObject({ ok: false, error: { message: expect.stringContaining("integrity") } });
    await expect(fs.readFile(path.join(fixture.workspaceRoot, "src.txt"), "utf8")).resolves.toBe("old");
  });

  test("reports invalid arguments without touching the workspace", async () => {
    const fixture = await createFixture();
    const result = await restoreWorkspaceCheckpointHostTool(
      { artifactUri: fixture.artifactUri, currentRevision: "" },
      createContext(fixture.workspaceRoot),
    );

    expect(result.response).toMatchObject({ ok: false, error: { code: "InvalidToolArguments" } });
  });
});

async function createFixture(): Promise<{
  workspaceRoot: string;
  artifactUri: string;
  checkpointId: string;
  beforeRevision: string;
  afterRevision: string;
  afterPath: string;
  afterSnapshot: ToolWorkspaceSnapshot;
}> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "senera-workspace-restore-tool-"));
  temporaryRoots.push(workspaceRoot);
  const artifactRoot = path.join(workspaceRoot, ".senera", "artifacts", "runs");
  const artifactDirectory = path.join(artifactRoot, "restore-fixture");
  await fs.mkdir(artifactDirectory, { recursive: true });
  const artifactId = "art_0123456789abcdef01234567";
  const artifactUri = createAgentArtifactUri(artifactId);
  const before = snapshot(workspaceRoot, "old");
  const after = snapshot(workspaceRoot, "new");
  const change: ToolWorkspaceChange = {
    path: "src.txt",
    absolutePath: path.join(workspaceRoot, "src.txt"),
    status: "modified",
    beforeKind: "file",
    afterKind: "file",
    beforeHash: before.files[0]!.hash,
    afterHash: after.files[0]!.hash,
    beforeSize: before.files[0]!.size,
    afterSize: after.files[0]!.size,
  };
  const checkpoint = createAgentWorkspaceContinuityCheckpoint({ before, after, changes: [change], artifactUri });
  const beforePath = path.join(artifactDirectory, "workspace.before.json");
  const afterPath = path.join(artifactDirectory, "workspace.after.json");
  await Promise.all([
    fs.writeFile(beforePath, JSON.stringify(before), "utf8"),
    fs.writeFile(afterPath, JSON.stringify(after), "utf8"),
  ]);
  await fs.writeFile(
    path.join(artifactDirectory, "manifest.json"),
    JSON.stringify({
      artifactId,
      artifactUri,
      files: { workspaceBefore: beforePath, workspaceAfter: afterPath },
      workspace: {
        files: { before: beforePath, after: afterPath },
        snapshotContents: {
          before: snapshotContentIdentity(beforePath, before),
          after: snapshotContentIdentity(afterPath, after),
        },
        checkpoint,
      },
    }),
    "utf8",
  );
  return {
    workspaceRoot,
    artifactUri,
    checkpointId: checkpoint.id,
    beforeRevision: workspaceSnapshotRevision(before),
    afterRevision: workspaceSnapshotRevision(after),
    afterPath,
    afterSnapshot: after,
  };
}

function snapshotContentIdentity(file: string, snapshot: ToolWorkspaceSnapshot) {
  const content = JSON.stringify(snapshot);
  return {
    file,
    byteLength: Buffer.byteLength(content, "utf8"),
    sha256: createHash("sha256").update(content, "utf8").digest("hex"),
  };
}

function snapshot(workspaceRoot: string, text: string): ToolWorkspaceSnapshot {
  const bytes = Buffer.byteLength(text, "utf8");
  const file: ToolWorkspaceFileSnapshot = {
    path: "src.txt",
    absolutePath: path.join(workspaceRoot, "src.txt"),
    exists: true,
    kind: "file",
    size: bytes,
    mtimeMs: 0,
    hash: hashWorkspaceText(text),
    content: { state: "captured", encoding: "utf8", byteLength: bytes, lineCount: 1, text },
  };
  return { capturedAt: "2026-09-12T00:00:00.000Z", files: [file] };
}

function createContext(workspaceRoot: string): AgentHostToolContext {
  return {
    workspaceRoot,
    tool: { name: "WorkspaceRestoreCheckpoint", runtime: { Lifecycle: "Immediate", ProtocolVersion: 2 } },
    config: {},
    registry: { getTool: () => undefined },
    executionEnv: new SeneraLocalExecutionEnv({ workspaceRoot }),
  } as unknown as AgentHostToolContext;
}
