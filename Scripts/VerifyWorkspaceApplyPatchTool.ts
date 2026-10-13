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
import { SeneraLocalExecutionEnv } from "../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";

void main();

async function main(): Promise<void> {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "senera-workspace-patch-"));
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  const outsideRoot = path.join(temporaryRoot, "outside");
  try {
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(outsideRoot, { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, "docs"), { recursive: true });
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
    const applied = await applyWorkspacePatchHostTool(
      {
        operations: [
          {
            kind: "update",
            path: "src/value.ts",
            oldStr: "return 1;",
            newStr: "return 2;",
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
          },
          {
            kind: "update",
            path: "src/moved.ts",
            oldStr: "beta",
            newStr: "gamma",
          },
          {
            kind: "delete",
            path: "docs/old.md",
          },
          {
            kind: "add",
            path: "created-dir/nested/created.ts",
            content: "export const nested = true;\n",
          },
        ],
      },
      context,
    );
    assert.equal(applied.response.ok, true, JSON.stringify(applied.response));
    const result = applied.response.result as {
      applied: boolean;
      changedPaths: string[];
      operationCount: number;
    };
    assert.equal(result.applied, true);
    assert.equal(result.operationCount, 6);
    assert.deepEqual(result.changedPaths, [
      "created-dir/nested/created.ts",
      "docs/old.md",
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
    assert.equal(
      await fs.readFile(path.join(workspaceRoot, "created-dir", "nested", "created.ts"), "utf8"),
      "export const nested = true;\n",
    );

    const invalid = await applyWorkspacePatchHostTool(
      {
        operations: [
          {
            kind: "update",
            path: "src/value.ts",
            oldStr: "not in the source",
            newStr: "replacement",
          },
        ],
      },
      context,
    );
    assert.equal(invalid.response.ok, false);

    const linkedDirectory = path.join(workspaceRoot, "linked-outside");
    await fs.symlink(outsideRoot, linkedDirectory, process.platform === "win32" ? "junction" : "dir");
    const escaped = await applyWorkspacePatchHostTool(
      {
        operations: [
          {
            kind: "add",
            path: "linked-outside/escaped.txt",
            content: "must remain inside the workspace\n",
          },
        ],
      },
      context,
    );
    assert.equal(escaped.response.ok, false);
    await assert.rejects(fs.stat(path.join(outsideRoot, "escaped.txt")));

    console.log("Workspace apply patch tool verification passed.");
  } finally {
    await fs.rm(temporaryRoot, { force: true, recursive: true });
  }
}

function createContext(workspaceRoot: string): AgentHostToolContext {
  return {
    workspaceRoot,
    tool: {
      name: "WorkspaceApplyPatch",
      runtime: { Lifecycle: "Immediate", ProtocolVersion: 2, Capabilities: { Progress: true } },
    },
    config: {},
    registry: {
      getTool: () => undefined,
    },
    executionEnv: new SeneraLocalExecutionEnv({ workspaceRoot }),
  } as unknown as AgentHostToolContext;
}
