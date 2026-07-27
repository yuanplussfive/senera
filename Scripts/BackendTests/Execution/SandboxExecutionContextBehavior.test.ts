import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  prepareSeneraSandboxExecutionContext,
  releaseSeneraSandboxResources,
} from "../../../Source/AgentSystem/Execution/SeneraSandboxExecutionContext.js";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
} from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("Sandbox execution context behavior", () => {
  test("projects shared workspace, environment, and rootfs inputs once for every backend", async () => {
    const workspaceRoot = temporaryDirectory("sandbox-context");
    const writableRoot = path.join(workspaceRoot, ".state", "plugin");
    const context = await prepareSeneraSandboxExecutionContext({
      workspaceRoot,
      cwd: path.join(workspaceRoot, "Plugins", "Example"),
      guestWorkspaceRoot: "/workspace",
      environment: { DEFINED: "host", EMPTY: undefined },
      profile: {
        name: "plugin",
        kind: "mcp-server",
        backend: "sandbox",
        sandbox: {
          env: { DEFINED: "profile", PROFILE_ONLY: "yes" },
          rootfsCopies: [{ hostPath: workspaceRoot, guestPath: "/opt/senera" }],
          writableMounts: [{ hostPath: writableRoot, guestPath: "/workspace/.state" }],
        },
      },
    });

    expect(context.guestCwd).toBe("/workspace/Plugins/Example");
    expect(context.environment).toEqual({ DEFINED: "profile", PROFILE_ONLY: "yes" });
    expect(context.rootfsCopies).toEqual([{ hostPath: workspaceRoot, guestPath: "/opt/senera" }]);
    expect(fs.existsSync(writableRoot)).toBe(true);
    await releaseSeneraSandboxResources([context.rootfsCleanup], { backend: "test-sandbox" });
  });

  test("preserves the primary error and attempts every cleanup resource in order", async () => {
    const releases: string[] = [];
    const primaryError = new SeneraExecutionError(SeneraExecutionErrorCodes.Timeout, "execution timed out", {
      backend: "gvisor",
    });

    await expect(
      releaseSeneraSandboxResources(
        [
          {
            diagnosticKey: "sessionCleanup",
            reason: "session_cleanup_failed",
            release: () => {
              releases.push("session");
              throw new Error("session cleanup failed");
            },
          },
          {
            diagnosticKey: "rootfsCleanup",
            reason: "rootfs_cleanup_failed",
            release: () => {
              releases.push("rootfs");
              throw new Error("rootfs cleanup failed");
            },
          },
        ],
        { backend: "gvisor", primaryError },
      ),
    ).rejects.toMatchObject({
      code: SeneraExecutionErrorCodes.Timeout,
      details: {
        diagnostics: {
          sessionCleanup: { code: SeneraExecutionErrorCodes.CleanupFailed },
          rootfsCleanup: { code: SeneraExecutionErrorCodes.CleanupFailed },
        },
      },
    });
    expect(releases).toEqual(["session", "rootfs"]);
  });

  test("surfaces cleanup failure when the primary operation succeeded", async () => {
    await expect(
      releaseSeneraSandboxResources(
        [
          {
            diagnosticKey: "rootfsCleanup",
            reason: "rootfs_cleanup_failed",
            release: () => Promise.reject(new Error("rootfs cleanup failed")),
          },
        ],
        { backend: "microsandbox" },
      ),
    ).rejects.toMatchObject({
      code: SeneraExecutionErrorCodes.CleanupFailed,
      details: { backend: "microsandbox", reason: "rootfs_cleanup_failed" },
    });
  });
});

function temporaryDirectory(prefix: string): string {
  const directory = createTemporaryDirectory(prefix);
  temporaryDirectories.push(directory);
  return directory;
}
