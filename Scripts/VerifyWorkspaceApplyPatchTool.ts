import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AgentHostCapabilityNames,
  createDefaultHostCapabilityRegistry,
} from "../Source/AgentSystem/AgentDefaultHostCapabilities.js";
import { applyWorkspacePatchHostTool } from "../Source/AgentSystem/ToolRuntime/AgentWorkspaceApplyPatchRuntime.js";
import type { AgentHostToolContext } from "../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";

void main();

async function main(): Promise<void> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "senera-workspace-patch-"));
  try {
    await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, "docs"), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, "empty-delete"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, "src", "value.ts"),
      "export function value() {\n  return 1;\n}\n",
      "utf8",
    );
    await fs.writeFile(path.join(workspaceRoot, "docs", "old.md"), "old\n", "utf8");
    await fs.writeFile(path.join(workspaceRoot, "src", "move-me.ts"), "alpha\nbeta\n", "utf8");

    const registry = createDefaultHostCapabilityRegistry();
    assert.equal(registry.get(AgentHostCapabilityNames.WorkspaceApplyPatch), applyWorkspacePatchHostTool);

    const context = createContext(workspaceRoot);
    const dryRun = await applyWorkspacePatchHostTool(
      {
        dryRun: true,
        operations: [
          {
            kind: "update",
            path: "src/value.ts",
            patch: ["@@ -1,3 +1,3 @@", " export function value() {", "-  return 1;", "+  return 2;", " }"].join("\n"),
          },
        ],
      },
      context,
    );
    assert.equal(dryRun.response.ok, true);
    assert.equal(
      await fs.readFile(path.join(workspaceRoot, "src", "value.ts"), "utf8"),
      "export function value() {\n  return 1;\n}\n",
    );

    const applied = await applyWorkspacePatchHostTool(
      {
        operations: [
          {
            kind: "update",
            path: "src/value.ts",
            patch: ["@@ -1,3 +1,3 @@", " export function value() {", "-  return 1;", "+  return 2;", " }"].join("\n"),
          },
          {
            kind: "add",
            path: "src/new.ts",
            content: "export const created = true;\n",
          },
          {
            kind: "move",
            source: "src/move-me.ts",
            destination: "src/moved.ts",
            patch: ["@@ -1,2 +1,2 @@", " alpha", "-beta", "+gamma"].join("\n"),
          },
          {
            kind: "delete",
            path: "docs/old.md",
          },
          {
            kind: "createDirectory",
            path: "created-dir",
          },
          {
            kind: "deleteDirectory",
            path: "empty-delete",
          },
        ],
      },
      context,
    );
    assert.equal(applied.response.ok, true);
    const result = applied.response.result as {
      applied: boolean;
      changedPaths: string[];
      operationCount: number;
    };
    assert.equal(result.applied, true);
    assert.equal(result.operationCount, 6);
    assert.deepEqual(result.changedPaths, [
      "created-dir",
      "docs/old.md",
      "empty-delete",
      "src/move-me.ts",
      "src/moved.ts",
      "src/new.ts",
      "src/value.ts",
    ]);
    assert.equal(
      await fs.readFile(path.join(workspaceRoot, "src", "value.ts"), "utf8"),
      "export function value() {\n  return 2;\n}\n",
    );
    assert.equal(
      await fs.readFile(path.join(workspaceRoot, "src", "new.ts"), "utf8"),
      "export const created = true;\n",
    );
    assert.equal(await fs.readFile(path.join(workspaceRoot, "src", "moved.ts"), "utf8"), "alpha\ngamma\n");
    await assert.rejects(fs.stat(path.join(workspaceRoot, "src", "move-me.ts")));
    await assert.rejects(fs.stat(path.join(workspaceRoot, "docs", "old.md")));
    assert.equal((await fs.stat(path.join(workspaceRoot, "created-dir"))).isDirectory(), true);

    const invalid = await applyWorkspacePatchHostTool(
      {
        operations: [
          {
            kind: "update",
            path: "src/value.ts",
            patch: "--- a/src/value.ts\n+++ b/src/value.ts\n@@ -1,1 +1,1 @@\n-export\n+export",
          },
        ],
      },
      context,
    );
    assert.equal(invalid.response.ok, false);

    console.log("Workspace apply patch tool verification passed.");
  } finally {
    await fs.rm(workspaceRoot, { force: true, recursive: true });
  }
}

function createContext(workspaceRoot: string): AgentHostToolContext {
  return {
    workspaceRoot,
    tool: {
      name: "WorkspaceApplyPatch",
    },
    config: {},
    registry: {
      getTool: () => undefined,
    },
    executionEnv: {},
  } as unknown as AgentHostToolContext;
}
