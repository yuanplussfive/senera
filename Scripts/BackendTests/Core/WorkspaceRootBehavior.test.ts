import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { resolveWorkspaceRoot } from "../../WorkspaceRoot.js";

const workspaceRoot = fs.realpathSync.native(path.resolve(import.meta.dirname, "../../.."));

describe("workspace root resolution", () => {
  test("resolves the same canonical root from repository files and nested directories", () => {
    expect(resolveWorkspaceRoot(workspaceRoot)).toBe(workspaceRoot);
    expect(resolveWorkspaceRoot(path.join(workspaceRoot, "Frontend"))).toBe(workspaceRoot);
    expect(resolveWorkspaceRoot(pathToFileURL(path.join(workspaceRoot, "vitest.config.ts")))).toBe(workspaceRoot);
    expect(resolveWorkspaceRoot()).toBe(workspaceRoot);
  });

  test("canonicalizes a filesystem alias before resolving the workspace", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-workspace-root-"));
    const aliasRoot = path.join(tempRoot, "workspace-alias");

    try {
      fs.symlinkSync(workspaceRoot, aliasRoot, process.platform === "win32" ? "junction" : "dir");
      expect(resolveWorkspaceRoot(path.join(aliasRoot, "Frontend"))).toBe(workspaceRoot);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
