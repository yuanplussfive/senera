import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { applyWorkspacePatchHostTool } from "../../../Source/AgentSystem/ToolRuntime/AgentWorkspaceApplyPatchRuntime.js";
import type { AgentHostToolContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    removeDirectory(temporaryDirectories.pop()!);
  }
});

describe("Workspace apply patch security", () => {
  test("applies a normal file addition inside the workspace", async () => {
    const workspaceRoot = createWorkspace();
    const result = await applyWorkspacePatchHostTool(
      { operations: [{ kind: "add", path: "src/new.ts", content: "export const value = 1;\n" }] },
      createContext(workspaceRoot),
    );

    expect(result.response.ok).toBe(true);
    await expect(fs.readFile(path.join(workspaceRoot, "src", "new.ts"), "utf8")).resolves.toBe(
      "export const value = 1;\n",
    );
  });

  test("rejects lexical paths outside the workspace", async () => {
    const workspaceRoot = createWorkspace();
    const result = await applyWorkspacePatchHostTool(
      { operations: [{ kind: "add", path: "../escaped.txt", content: "blocked\n" }] },
      createContext(workspaceRoot),
    );

    expect(result.response.ok).toBe(false);
    await expect(fs.stat(path.resolve(workspaceRoot, "..", "escaped.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects writes through a symbolic link or directory junction", async () => {
    const workspaceRoot = createWorkspace();
    const outsideRoot = path.join(path.dirname(workspaceRoot), `${path.basename(workspaceRoot)}-outside`);
    temporaryDirectories.push(outsideRoot);
    await fs.mkdir(outsideRoot, { recursive: true });
    await fs.symlink(
      outsideRoot,
      path.join(workspaceRoot, "linked-outside"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = await applyWorkspacePatchHostTool(
      { operations: [{ kind: "add", path: "linked-outside/escaped.txt", content: "blocked\n" }] },
      createContext(workspaceRoot),
    );

    expect(result.response.ok).toBe(false);
    await expect(fs.stat(path.join(outsideRoot, "escaped.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function createWorkspace(): string {
  const workspaceRoot = createTemporaryDirectory("senera-workspace-patch");
  temporaryDirectories.push(workspaceRoot);
  return workspaceRoot;
}

function createContext(workspaceRoot: string): AgentHostToolContext {
  return {
    workspaceRoot,
    tool: { name: "WorkspaceApplyPatch" },
    config: {},
    registry: { getTool: () => undefined },
    executionEnv: {},
  } as unknown as AgentHostToolContext;
}
