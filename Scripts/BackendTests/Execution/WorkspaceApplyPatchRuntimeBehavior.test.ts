import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import type { SeneraExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import { applyWorkspacePatchHostTool } from "../../../Source/AgentSystem/ToolRuntime/AgentWorkspaceApplyPatchRuntime.js";
import type { AgentHostToolContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("Workspace apply patch runtime behavior", () => {
  test("replaces a whole file when its expected SHA-256 still matches", async () => {
    const workspaceRoot = createWorkspace();
    const target = path.join(workspaceRoot, "value.txt");
    await fs.writeFile(target, "before\n", "utf8");

    const result = await applyWorkspacePatchHostTool(
      {
        operations: [
          {
            kind: "replace",
            path: "value.txt",
            content: "after\n",
            expectedSha256: digest("before\n"),
          },
        ],
      },
      context(workspaceRoot),
    );

    expect(result.response.ok).toBe(true);
    expect(await fs.readFile(target, "utf8")).toBe("after\n");
  });

  test("rejects a stale expected SHA-256 without changing the file", async () => {
    const workspaceRoot = createWorkspace();
    const target = path.join(workspaceRoot, "value.txt");
    await fs.writeFile(target, "current\n", "utf8");

    const result = await applyWorkspacePatchHostTool(
      {
        operations: [
          {
            kind: "replace",
            path: "value.txt",
            content: "after\n",
            expectedSha256: digest("stale\n"),
          },
        ],
      },
      context(workspaceRoot),
    );

    expect(result.response.ok).toBe(false);
    expect(await fs.readFile(target, "utf8")).toBe("current\n");
  });

  test("revalidates planned source files immediately before committing", async () => {
    const workspaceRoot = createWorkspace();
    const target = path.join(workspaceRoot, "value.txt");
    await fs.writeFile(target, "before\n", "utf8");
    const base = new SeneraLocalExecutionEnv({ workspaceRoot });
    let mutated = false;
    const executionEnv = new Proxy(base, {
      get(instance, property, receiver) {
        if (property === "readTextFile") {
          return async (...args: Parameters<SeneraExecutionEnv["readTextFile"]>) => {
            const result = await instance.readTextFile(...args);
            if (!mutated) {
              mutated = true;
              await fs.writeFile(target, "concurrent\n", "utf8");
            }
            return result;
          };
        }
        const value = Reflect.get(instance, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(instance) : value;
      },
    });

    const result = await applyWorkspacePatchHostTool(
      {
        operations: [
          {
            kind: "update",
            path: "value.txt",
            patch: "@@ -1,1 +1,1 @@\n-before\n+after",
          },
        ],
      },
      context(workspaceRoot, executionEnv),
    );

    expect(result.response.ok).toBe(false);
    expect(await fs.readFile(target, "utf8")).toBe("concurrent\n");
  });

  test("binds the rollback snapshot to the validated file revision", async () => {
    const workspaceRoot = createWorkspace();
    const target = path.join(workspaceRoot, "value.txt");
    await fs.writeFile(target, "before\n", "utf8");
    const base = new SeneraLocalExecutionEnv({ workspaceRoot });
    let binaryReadCount = 0;
    const executionEnv = new Proxy(base, {
      get(instance, property, receiver) {
        if (property === "readBinaryFile") {
          return async (...args: Parameters<SeneraExecutionEnv["readBinaryFile"]>) => {
            const result = await instance.readBinaryFile(...args);
            binaryReadCount += 1;
            if (binaryReadCount === 2) await fs.writeFile(target, "between-validation-and-snapshot\n", "utf8");
            return result;
          };
        }
        const value = Reflect.get(instance, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(instance) : value;
      },
    });

    const result = await applyWorkspacePatchHostTool(
      {
        operations: [{ kind: "replace", path: "value.txt", content: "after\n" }],
      },
      context(workspaceRoot, executionEnv),
    );

    expect(result.response.ok).toBe(false);
    expect(await fs.readFile(target, "utf8")).toBe("between-validation-and-snapshot\n");
  });

  test("rolls back earlier files when a later write fails", async () => {
    const workspaceRoot = createWorkspace();
    const first = path.join(workspaceRoot, "first.txt");
    const second = path.join(workspaceRoot, "second.txt");
    await fs.writeFile(first, "first-before\n", "utf8");
    await fs.writeFile(second, "second-before\n", "utf8");
    const base = new SeneraLocalExecutionEnv({ workspaceRoot });
    let writeCount = 0;
    const executionEnv = new Proxy(base, {
      get(instance, property, receiver) {
        if (property === "writeFile") {
          return async (...args: Parameters<SeneraExecutionEnv["writeFile"]>) => {
            writeCount += 1;
            if (writeCount === 2) return { ok: false, error: new Error("injected write failure") } as never;
            return instance.writeFile(...args);
          };
        }
        const value = Reflect.get(instance, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(instance) : value;
      },
    });

    const result = await applyWorkspacePatchHostTool(
      {
        operations: [
          { kind: "replace", path: "first.txt", content: "first-after\n" },
          { kind: "replace", path: "second.txt", content: "second-after\n" },
        ],
      },
      context(workspaceRoot, executionEnv),
    );

    expect(result.response.ok).toBe(false);
    expect(await fs.readFile(first, "utf8")).toBe("first-before\n");
    expect(await fs.readFile(second, "utf8")).toBe("second-before\n");
  });
});

function createWorkspace(): string {
  const workspace = createTemporaryDirectory("senera-workspace-patch");
  temporaryDirectories.push(workspace);
  return workspace;
}

function context(workspaceRoot: string, executionEnv = new SeneraLocalExecutionEnv({ workspaceRoot })) {
  return {
    workspaceRoot,
    executionEnv,
    tool: {
      name: "WorkspaceApplyPatch",
      runtime: { Lifecycle: "Immediate", ProtocolVersion: 2, Capabilities: { Progress: true } },
    },
    config: { ModelProviders: [] },
    registry: { getTool: () => undefined },
  } as unknown as AgentHostToolContext;
}

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
