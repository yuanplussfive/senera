import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  AgentArtifactDirectoryReservations,
  AgentArtifactFileWriter,
  truncateArtifactTextByBytes,
} from "../../../Source/AgentSystem/Artifacts/AgentArtifactFileWriter.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("artifact file writer", () => {
  test("truncates UTF-8 text on code point boundaries within the byte limit", async () => {
    const workspace = createTemporaryDirectory("senera-artifact-writer");
    const filePath = path.join(workspace, "artifacts", "summary.md");
    const writer = new AgentArtifactFileWriter(workspace);

    await writer.writeText(filePath, "你好世界-extended", 20);

    const written = fs.readFileSync(filePath, "utf8");
    expect(Buffer.byteLength(written, "utf8")).toBeLessThanOrEqual(20);
    expect(written).not.toContain("�");
    expect(written).toContain("[truncated]");
    expect(Buffer.byteLength(truncateArtifactTextByBytes("你好", 4), "utf8")).toBeLessThanOrEqual(4);
  });

  test("keeps bounded JSON valid and reports its original size", async () => {
    const workspace = createTemporaryDirectory("senera-artifact-json");
    const filePath = path.join(workspace, "artifacts", "raw.json");
    const writer = new AgentArtifactFileWriter(workspace);

    await writer.writeBoundedJson(filePath, { content: "内容".repeat(200) }, 180);

    const written = fs.readFileSync(filePath, "utf8");
    expect(Buffer.byteLength(written, "utf8")).toBeLessThanOrEqual(180);
    expect(JSON.parse(written)).toMatchObject({ truncated: true, originalBytes: expect.any(Number) });
  });

  test("atomically overwrites files without leaving temporary artifacts", async () => {
    const workspace = createTemporaryDirectory("senera-artifact-overwrite");
    const artifactDir = path.join(workspace, "artifacts");
    const filePath = path.join(artifactDir, "result.txt");
    const writer = new AgentArtifactFileWriter(workspace);

    await writer.writeText(filePath, "first", 100);
    await writer.writeText(filePath, "second", 100);

    expect(fs.readFileSync(filePath, "utf8")).toBe("second");
    expect(fs.readdirSync(artifactDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("publishes a commit file exactly once", async () => {
    const workspace = createTemporaryDirectory("senera-artifact-publish");
    const manifestPath = path.join(workspace, "artifacts", "manifest.json");
    const writer = new AgentArtifactFileWriter(workspace);

    await writer.publishJson(manifestPath, { state: "committed" });

    await expect(writer.publishJson(manifestPath, { state: "replaced" })).rejects.toMatchObject({ code: "EEXIST" });
    expect(JSON.parse(fs.readFileSync(manifestPath, "utf8"))).toEqual({ state: "committed" });
  });

  test("reports whether an artifact directory was created or already reserved", async () => {
    const workspace = createTemporaryDirectory("senera-artifact-reservation");
    const artifactDirectory = path.join(workspace, "artifacts", "artifact");
    const writer = new AgentArtifactFileWriter(workspace);

    expect(await writer.reserveArtifactDirectory(artifactDirectory)).toBe(AgentArtifactDirectoryReservations.Created);
    expect(await writer.reserveArtifactDirectory(artifactDirectory)).toBe(AgentArtifactDirectoryReservations.Existing);
    expect(fs.statSync(artifactDirectory).isDirectory()).toBe(true);
  });

  test("identifies exactly one creator during concurrent artifact directory reservation", async () => {
    const workspace = createTemporaryDirectory("senera-artifact-concurrent-reservation");
    const artifactDirectory = path.join(workspace, "artifacts", "artifact");
    const writer = new AgentArtifactFileWriter(workspace);

    const reservations = await Promise.all(
      Array.from({ length: 8 }, () => writer.reserveArtifactDirectory(artifactDirectory)),
    );

    expect(
      reservations.filter((reservation) => reservation === AgentArtifactDirectoryReservations.Created),
    ).toHaveLength(1);
    expect(
      reservations.filter((reservation) => reservation === AgentArtifactDirectoryReservations.Existing),
    ).toHaveLength(7);
    expect(fs.statSync(artifactDirectory).isDirectory()).toBe(true);
  });

  test("rejects lexical and junction write escapes from the workspace", async () => {
    const workspace = createTemporaryDirectory("senera-artifact-boundary");
    const outside = createTemporaryDirectory("senera-artifact-outside");
    const writer = new AgentArtifactFileWriter(workspace);
    const linked = path.join(workspace, "linked");
    fs.symlinkSync(outside, linked, process.platform === "win32" ? "junction" : "dir");

    await expect(writer.writeText(path.join(outside, "direct.txt"), "blocked", 100)).rejects.toThrow(/工作区边界/);
    await expect(writer.writeText(path.join(linked, "linked.txt"), "blocked", 100)).rejects.toThrow(/工作区边界/);
    expect(fs.existsSync(path.join(outside, "direct.txt"))).toBe(false);
    expect(fs.existsSync(path.join(outside, "linked.txt"))).toBe(false);
  });
});

function createTemporaryDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  temporaryDirectories.push(directory);
  return directory;
}
