import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentArtifactFileWriter } from "../../../Source/AgentSystem/Artifacts/AgentArtifactFileWriter.js";
import { AgentWorkspaceSnapshotBuilder } from "../../../Source/AgentSystem/Artifacts/AgentWorkspaceSnapshotBuilder.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Artifact workspace boundary", () => {
  it("does not snapshot content through an escaping directory link", async () => {
    const { workspaceRoot, outsideRoot } = createFixture();
    fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "outside", "utf8");
    createDirectoryLink(outsideRoot, path.join(workspaceRoot, "escape"));
    const builder = new AgentWorkspaceSnapshotBuilder(workspaceRoot, {
      maxFileBytes: 1024,
      maxFiles: 10,
      maxDirectoryDepth: 2,
      captureContent: "text",
    });

    await builder.capture("escape/secret.txt", 0);

    const snapshot = builder.toSnapshot();
    expect(snapshot.files).toMatchObject([{ path: "escape/secret.txt", exists: false, kind: "missing" }]);
    expect(snapshot.warnings).toContain("workspace snapshot rejected unsafe path: escape/secret.txt");
  });

  it("does not write artifacts through an escaping directory link", async () => {
    const { workspaceRoot, outsideRoot } = createFixture();
    createDirectoryLink(outsideRoot, path.join(workspaceRoot, ".senera"));
    const writer = new AgentArtifactFileWriter(workspaceRoot);

    await expect(writer.writeJson(path.join(workspaceRoot, ".senera", "artifact.json"), {})).rejects.toMatchObject({
      code: "link_not_allowed",
    });
    expect(fs.existsSync(path.join(outsideRoot, "artifact.json"))).toBe(false);
  });
});

function createFixture(): { workspaceRoot: string; outsideRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-artifact-boundary-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const outsideRoot = path.join(root, "outside");
  fs.mkdirSync(workspaceRoot);
  fs.mkdirSync(outsideRoot);
  return { workspaceRoot, outsideRoot };
}

function createDirectoryLink(target: string, linkPath: string): void {
  fs.symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}
