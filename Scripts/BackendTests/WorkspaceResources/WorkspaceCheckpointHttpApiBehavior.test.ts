import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createAgentArtifactUri } from "../../../Source/AgentSystem/Artifacts/AgentArtifactLocator.js";
import { hashWorkspaceText } from "../../../Source/AgentSystem/Artifacts/AgentWorkspaceSnapshotUtils.js";
import { createAgentWorkspaceContinuityCheckpoint } from "../../../Source/AgentSystem/Continuity/AgentContinuityLedger.js";
import { AgentWorkspaceCheckpointHttpApi } from "../../../Source/AgentSystem/WorkspaceResources/AgentWorkspaceCheckpointHttpApi.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type {
  ToolWorkspaceChange,
  ToolWorkspaceFileSnapshot,
  ToolWorkspaceSnapshot,
} from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";

const roots: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("workspace checkpoint undo HTTP API", () => {
  test("restores only the published before snapshot", async () => {
    const fixture = await createFixture();
    await fs.writeFile(fixture.sourcePath, "after", "utf8");
    const response = await undo(fixture);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      result: { checkpointId: fixture.checkpointId, restoredPaths: ["src.txt"] },
    });
    await expect(fs.readFile(fixture.sourcePath, "utf8")).resolves.toBe("before");
  });

  test("rejects a later workspace edit rather than overwriting it", async () => {
    const fixture = await createFixture();
    await fs.writeFile(fixture.sourcePath, "later edit", "utf8");
    const response = await undo(fixture);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "workspace_changed" } });
    await expect(fs.readFile(fixture.sourcePath, "utf8")).resolves.toBe("later edit");
  });

  test("does not accept an arbitrary Artifact locator", async () => {
    const fixture = await createFixture();
    const response = await fetch(fixture.undoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checkpoints: [{ artifactUri: "file:///outside/manifest.json", checkpointId: fixture.checkpointId }],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  });

  test("rejects a tampered snapshot before it mutates the workspace", async () => {
    const fixture = await createFixture();
    await fs.writeFile(fixture.sourcePath, "after", "utf8");
    await fs.writeFile(fixture.beforeSnapshotPath, JSON.stringify({ files: [], capturedAt: "tampered" }), "utf8");
    const response = await undo(fixture);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "checkpoint_artifact_invalid" } });
    await expect(fs.readFile(fixture.sourcePath, "utf8")).resolves.toBe("after");
  });

  test("composes successive edits to the same file into one turn undo", async () => {
    const fixture = await createFixture();
    const second = await publishCheckpoint(
      fixture.workspaceRoot,
      "art_1123456789abcdef01234567",
      snapshot(fixture.workspaceRoot, "after"),
      snapshot(fixture.workspaceRoot, "final"),
    );
    await fs.writeFile(fixture.sourcePath, "final");
    const response = await undoBatch(fixture.undoUrl, [fixture, second]);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { restoredPaths: ["src.txt"], skippedPaths: [] } });
    await expect(fs.readFile(fixture.sourcePath, "utf8")).resolves.toBe("before");
  });

  test("validates all files before changing any file in a turn", async () => {
    const fixture = await createFixture();
    const second = await publishCheckpoint(
      fixture.workspaceRoot,
      "art_1123456789abcdef01234567",
      snapshot(fixture.workspaceRoot, "original", "other.txt"),
      snapshot(fixture.workspaceRoot, "changed", "other.txt"),
    );
    await fs.writeFile(fixture.sourcePath, "after");
    await fs.writeFile(path.join(fixture.workspaceRoot, "other.txt"), "later user edit");
    const response = await undoBatch(fixture.undoUrl, [fixture, second]);
    expect(response.status).toBe(409);
    await expect(fs.readFile(fixture.sourcePath, "utf8")).resolves.toBe("after");
    await fs.writeFile(path.join(fixture.workspaceRoot, "other.txt"), "changed");
    expect((await undoBatch(fixture.undoUrl, [fixture, second])).status).toBe(200);
    await expect(fs.readFile(fixture.sourcePath, "utf8")).resolves.toBe("before");
    await expect(fs.readFile(path.join(fixture.workspaceRoot, "other.txt"), "utf8")).resolves.toBe("original");
  });

  test("restores published binary content relative to each owning Artifact", async () => {
    const fixture = await createFixture();
    const original = Buffer.from([0, 255, 128, 7]);
    const changed = Buffer.from([1, 0, 3]);
    const binarySnapshot = (bytes: Buffer): ToolWorkspaceSnapshot => ({
      capturedAt: new Date().toISOString(),
      files: [
        {
          path: "image.png",
          absolutePath: path.join(fixture.workspaceRoot, "image.png"),
          exists: true,
          kind: "file",
          size: bytes.length,
          mtimeMs: 0,
          hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
          content: {
            state: "captured",
            encoding: "base64",
            byteLength: bytes.length,
            lineCount: 0,
            relativeArtifactPath: "workspace/before/image.png",
          },
        },
      ],
    });
    const before = binarySnapshot(original);
    const after = binarySnapshot(changed);
    after.files[0]!.content = {
      state: "captured",
      encoding: "base64",
      byteLength: changed.length,
      lineCount: 0,
      text: changed.toString("base64"),
    };
    const artifactId = "art_3123456789abcdef01234567";
    const second = await publishCheckpoint(fixture.workspaceRoot, artifactId, before, after);
    const contentDirectory = path.join(fixture.workspaceRoot, ".senera/artifacts/runs", artifactId, "workspace/before");
    await fs.mkdir(contentDirectory, { recursive: true });
    await fs.writeFile(path.join(contentDirectory, "image.png"), original);
    await fs.writeFile(fixture.sourcePath, "after");
    await fs.writeFile(path.join(fixture.workspaceRoot, "image.png"), changed);
    expect((await undoBatch(fixture.undoUrl, [fixture, second])).status).toBe(200);
    expect(await fs.readFile(path.join(fixture.workspaceRoot, "image.png"))).toEqual(original);
    expect(await fs.readFile(fixture.sourcePath, "utf8")).toBe("before");
  });

  test("rejects an interrupted checkpoint chain and missing original content without partial writes", async () => {
    const fixture = await createFixture();
    const second = await publishCheckpoint(
      fixture.workspaceRoot,
      "art_1123456789abcdef01234567",
      snapshot(fixture.workspaceRoot, "unrecorded edit"),
      snapshot(fixture.workspaceRoot, "final"),
    );
    await fs.writeFile(fixture.sourcePath, "final");
    expect((await undoBatch(fixture.undoUrl, [fixture, second])).status).toBe(409);
    await expect(fs.readFile(fixture.sourcePath, "utf8")).resolves.toBe("final");
    const unavailable = snapshot(fixture.workspaceRoot, "original", "other.txt");
    unavailable.files[0]!.content = { state: "omitted", reason: "binary" };
    const third = await publishCheckpoint(
      fixture.workspaceRoot,
      "art_2123456789abcdef01234567",
      unavailable,
      snapshot(fixture.workspaceRoot, "changed", "other.txt"),
    );
    await fs.writeFile(fixture.sourcePath, "after");
    await fs.writeFile(path.join(fixture.workspaceRoot, "other.txt"), "changed");
    expect((await undoBatch(fixture.undoUrl, [fixture, third])).status).toBe(409);
    await expect(fs.readFile(fixture.sourcePath, "utf8")).resolves.toBe("after");
  });
});

function undoBatch(url: string, checkpoints: readonly { artifactUri: string; checkpointId: string }[]) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      checkpoints: checkpoints.map(({ artifactUri, checkpointId }) => ({ artifactUri, checkpointId })),
    }),
  });
}

async function createFixture(): Promise<{
  readonly workspaceRoot: string;
  readonly artifactUri: string;
  readonly beforeSnapshotPath: string;
  readonly checkpointId: string;
  readonly sourcePath: string;
  readonly undoUrl: string;
}> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "senera-checkpoint-undo-http-"));
  roots.push(workspaceRoot);
  const before = snapshot(workspaceRoot, "before");
  const after = snapshot(workspaceRoot, "after");
  const published = await publishCheckpoint(workspaceRoot, "art_0123456789abcdef01234567", before, after);
  const api = new AgentWorkspaceCheckpointHttpApi({
    workspaceRoot,
    configSnapshot: () => ({}) as AgentSystemConfig,
    maxRequestBytes: 1024 * 1024,
  });
  const server = http.createServer((request, response) => void api.handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to start checkpoint undo test server.");
  return {
    ...published,
    workspaceRoot,
    sourcePath: path.join(workspaceRoot, "src.txt"),
    undoUrl: `http://127.0.0.1:${address.port}/api/workspace/checkpoints/undo`,
  };
}

async function publishCheckpoint(
  workspaceRoot: string,
  artifactId: string,
  before: ToolWorkspaceSnapshot,
  after: ToolWorkspaceSnapshot,
) {
  const artifactUri = createAgentArtifactUri(artifactId);
  const artifactDirectory = path.join(workspaceRoot, ".senera", "artifacts", "runs", artifactId);
  await fs.mkdir(artifactDirectory, { recursive: true });
  const changes: ToolWorkspaceChange[] = after.files.map((file, index) => ({
    path: file.path,
    absolutePath: path.join(workspaceRoot, file.path),
    status: "modified",
    beforeKind: "file",
    afterKind: "file",
    beforeHash: before.files[index]!.hash,
    afterHash: file.hash,
    beforeSize: before.files[index]!.size,
    afterSize: file.size,
  }));
  const checkpoint = createAgentWorkspaceContinuityCheckpoint({ before, after, changes, artifactUri });
  const beforeSnapshotPath = path.join(artifactDirectory, "workspace.before.json");
  const afterSnapshotPath = path.join(artifactDirectory, "workspace.after.json");
  await Promise.all([
    fs.writeFile(beforeSnapshotPath, JSON.stringify(before), "utf8"),
    fs.writeFile(afterSnapshotPath, JSON.stringify(after), "utf8"),
  ]);
  await fs.writeFile(
    path.join(artifactDirectory, "manifest.json"),
    JSON.stringify({
      artifactId,
      artifactUri,
      files: { workspaceBefore: beforeSnapshotPath, workspaceAfter: afterSnapshotPath },
      workspace: {
        files: { before: beforeSnapshotPath, after: afterSnapshotPath },
        snapshotContents: {
          before: snapshotIdentity(beforeSnapshotPath, before),
          after: snapshotIdentity(afterSnapshotPath, after),
        },
        checkpoint,
      },
    }),
    "utf8",
  );
  return {
    artifactUri,
    beforeSnapshotPath,
    checkpointId: checkpoint.id,
  };
}

function snapshot(workspaceRoot: string, text: string, fileName = "src.txt"): ToolWorkspaceSnapshot {
  const byteLength = Buffer.byteLength(text, "utf8");
  const file: ToolWorkspaceFileSnapshot = {
    path: fileName,
    absolutePath: path.join(workspaceRoot, fileName),
    exists: true,
    kind: "file",
    size: byteLength,
    mtimeMs: 0,
    hash: hashWorkspaceText(text),
    content: { state: "captured", encoding: "utf8", byteLength, lineCount: 1, text },
  };
  return { capturedAt: "2026-10-24T00:00:00.000Z", files: [file] };
}

function snapshotIdentity(file: string, snapshot: ToolWorkspaceSnapshot) {
  const content = JSON.stringify(snapshot);
  return {
    file,
    byteLength: Buffer.byteLength(content, "utf8"),
    sha256: createHash("sha256").update(content, "utf8").digest("hex"),
  };
}

function undo(fixture: {
  readonly undoUrl: string;
  readonly artifactUri: string;
  readonly checkpointId: string;
}): Promise<Response> {
  return fetch(fixture.undoUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checkpoints: [{ artifactUri: fixture.artifactUri, checkpointId: fixture.checkpointId }] }),
  });
}
