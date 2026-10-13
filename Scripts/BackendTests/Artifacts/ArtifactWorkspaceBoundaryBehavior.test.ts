import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentArtifactFileWriter } from "../../../Source/AgentSystem/Artifacts/AgentArtifactFileWriter.js";
import { materializeAgentWorkspaceMutationReceipt } from "../../../Source/AgentSystem/Artifacts/AgentWorkspaceMutationReceipt.js";
import { AgentWorkspaceMutationReceiptProtocol } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Artifact workspace boundary", () => {
  it("rejects receipt paths that leave the workspace lexical boundary", () => {
    const { workspaceRoot } = createFixture();

    expect(() =>
      materializeAgentWorkspaceMutationReceipt({
        workspaceRoot,
        workspacePolicy: workspacePolicy(),
        receipt: {
          type: AgentWorkspaceMutationReceiptProtocol.type,
          version: AgentWorkspaceMutationReceiptProtocol.version,
          capturedAt: "2026-09-25T00:00:00.000Z",
          entries: [
            {
              path: "../outside/secret.txt",
              before: { kind: "missing" },
              after: { kind: "file", bytes: Buffer.from("outside", "utf8") },
            },
          ],
        },
      }),
    ).toThrow(/not canonical|escapes workspace/i);
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

  it("preserves an explicitly addressed nested path without traversing its parent directories", () => {
    const { workspaceRoot } = createFixture();
    const capture = materializeAgentWorkspaceMutationReceipt({
      workspaceRoot,
      workspacePolicy: workspacePolicy(),
      receipt: {
        type: AgentWorkspaceMutationReceiptProtocol.type,
        version: AgentWorkspaceMutationReceiptProtocol.version,
        capturedAt: "2026-09-25T00:00:00.000Z",
        entries: [
          {
            path: ".github/workflows/release.yml",
            before: { kind: "missing" },
            after: { kind: "file", bytes: Buffer.from("name: Release\n", "utf8") },
          },
        ],
      },
    });

    expect(capture.after.files).toEqual([
      expect.objectContaining({ path: ".github/workflows/release.yml", kind: "file" }),
    ]);
    expect(capture.after.warnings).toBeUndefined();
  });
});

function workspacePolicy() {
  return {
    Capture: "mutation-receipt" as const,
    MaxFileBytes: 1024,
    CaptureContent: "text" as const,
    PatchContextLines: 3,
  };
}

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
