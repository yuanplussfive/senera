import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentWorkspaceChangeCapture } from "../../../Source/AgentSystem/Artifacts/AgentWorkspaceChangeCapture.js";
import type { ToolArtifactPolicyManifest } from "../../../Source/AgentSystem/Types/AgentToolContractTypes.js";
import {
  AgentWorkspaceMutationReceiptProtocol,
  type AgentWorkspaceMutationReceipt,
  type AgentWorkspaceMutationReceiptImage,
} from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("AgentWorkspaceChangeCapture", () => {
  test("does not infer workspace changes from write permission or filesystem activity", async () => {
    const workspaceRoot = await createWorkspace();
    const capture = new AgentWorkspaceChangeCapture({ workspaceRoot });

    await fs.writeFile(path.join(workspaceRoot, "untracked.txt"), "not a declared mutation\n", "utf8");

    expect(capture.capture({ policy: undefined })).toBeUndefined();
  });

  test("materializes exact nested receipt paths without scanning ancestors or rereading later disk state", async () => {
    const workspaceRoot = await createWorkspace();
    const modifiedPath = ".github/actions/verify.yml";
    const filePath = path.join(workspaceRoot, ...modifiedPath.split("/"));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "name: before\n", "utf8");

    const capture = new AgentWorkspaceChangeCapture({ workspaceRoot });
    await fs.writeFile(filePath, "name: unrelated later write\n", "utf8");

    const completed = capture.capture({
      policy: receiptPolicy(),
      mutationReceipt: mutationReceipt([
        {
          path: modifiedPath,
          before: textImage("name: before\n"),
          after: textImage("name: committed receipt\non: push\n"),
        },
        {
          path: ".github/codeql/config.yml",
          before: { kind: "missing" },
          after: textImage("queries: security-and-quality\n"),
        },
        {
          path: ".github/workflows/release.yml",
          before: { kind: "missing" },
          after: textImage("name: Release\n"),
        },
        {
          path: ".tmp/dsh-npm-study/runtime/package.json",
          before: { kind: "missing" },
          after: textImage('{"private":true}\n'),
        },
      ]),
    });

    expect(completed).toMatchObject({
      type: "senera.workspace_change_set.v1",
      version: 1,
      source: "mutation-receipt",
      coverage: "exact",
    });
    expect(completed?.after.warnings).toBeUndefined();
    expect(completed?.after.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: modifiedPath,
          content: expect.objectContaining({ text: "name: committed receipt\non: push\n" }),
        }),
        expect.objectContaining({ path: ".github/codeql/config.yml" }),
        expect.objectContaining({ path: ".github/workflows/release.yml" }),
        expect.objectContaining({ path: ".tmp/dsh-npm-study/runtime/package.json" }),
      ]),
    );
    expect(completed?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: modifiedPath, status: "modified", addedLines: 2, removedLines: 1 }),
        expect.objectContaining({ path: ".github/codeql/config.yml", status: "added" }),
        expect.objectContaining({ path: ".github/workflows/release.yml", status: "added" }),
        expect.objectContaining({ path: ".tmp/dsh-npm-study/runtime/package.json", status: "added" }),
      ]),
    );
  });

  test("derives add, delete, and modification records from transaction images", async () => {
    const capture = new AgentWorkspaceChangeCapture({ workspaceRoot: await createWorkspace() });

    const completed = capture.capture({
      policy: receiptPolicy(),
      mutationReceipt: mutationReceipt([
        { path: "docs/obsolete.md", before: textImage("old\n"), after: { kind: "missing" } },
        { path: "src/new.ts", before: { kind: "missing" }, after: textImage("export const ready = true;\n") },
        {
          path: "src/value.ts",
          before: textImage("export const value = 1;\n"),
          after: textImage("export const value = 2;\n"),
        },
      ]),
    });

    expect(completed?.changes).toEqual([
      expect.objectContaining({ path: "docs/obsolete.md", status: "deleted", removedLines: 1 }),
      expect.objectContaining({ path: "src/new.ts", status: "added", addedLines: 1 }),
      expect.objectContaining({ path: "src/value.ts", status: "modified", addedLines: 1, removedLines: 1 }),
    ]);
    expect(completed?.checkpoint?.changedPaths).toEqual(["docs/obsolete.md", "src/new.ts", "src/value.ts"]);
  });

  test("requires a receipt instead of returning an observer-derived degraded result", async () => {
    const capture = new AgentWorkspaceChangeCapture({ workspaceRoot: await createWorkspace() });

    expect(() => capture.capture({ policy: receiptPolicy() })).toThrow(/mutation receipt is missing or invalid/i);
  });

  test("retains exact identities when preview content reaches the declared bound", async () => {
    const capture = new AgentWorkspaceChangeCapture({ workspaceRoot: await createWorkspace() });
    const after = "this text exceeds the preview limit\n";

    const completed = capture.capture({
      policy: receiptPolicy({ maxFileBytes: 4 }),
      mutationReceipt: mutationReceipt([{ path: "large.txt", before: { kind: "missing" }, after: textImage(after) }]),
    });

    expect(completed?.changes).toEqual([expect.objectContaining({ path: "large.txt", status: "added" })]);
    expect(completed?.after.files[0]?.hash).toMatch(/^sha256:/);
    expect(completed?.after.files[0]?.content).toEqual({
      state: "omitted",
      reason: "size_limit",
      byteLength: Buffer.byteLength(after),
    });
  });

  test("rejects paths that are not canonical workspace-relative receipt entries", async () => {
    const capture = new AgentWorkspaceChangeCapture({ workspaceRoot: await createWorkspace() });

    expect(() =>
      capture.capture({
        policy: receiptPolicy(),
        mutationReceipt: mutationReceipt([
          { path: "../outside.txt", before: { kind: "missing" }, after: textImage("nope\n") },
        ]),
      }),
    ).toThrow(/not canonical|escapes workspace/i);
  });
});

function receiptPolicy(input: { readonly maxFileBytes?: number } = {}): ToolArtifactPolicyManifest {
  return {
    Workspace: {
      Capture: "mutation-receipt",
      MaxFileBytes: input.maxFileBytes ?? 262_144,
      CaptureContent: "text",
      PatchContextLines: 3,
    },
  };
}

function mutationReceipt(
  entries: readonly AgentWorkspaceMutationReceipt["entries"][number][],
): AgentWorkspaceMutationReceipt {
  return {
    type: AgentWorkspaceMutationReceiptProtocol.type,
    version: AgentWorkspaceMutationReceiptProtocol.version,
    capturedAt: "2026-09-25T00:00:00.000Z",
    entries,
  };
}

function textImage(text: string): AgentWorkspaceMutationReceiptImage {
  return { kind: "file", bytes: Buffer.from(text, "utf8") };
}

async function createWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-workspace-capture-"));
  temporaryRoots.push(root);
  return root;
}
