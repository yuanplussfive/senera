import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  DesktopNativeModuleMaintenance,
  type DesktopNativeModuleMaintenanceAdapter,
} from "../../../Build/DesktopNativeModuleMaintenance.js";

describe("desktop native module maintenance", () => {
  test("retries transient metadata locks with bounded exponential backoff", async () => {
    const fixture = createWorkspace();
    const removeFile = vi
      .fn<DesktopNativeModuleMaintenanceAdapter["removeFile"]>()
      .mockRejectedValueOnce(nodeError("EBUSY"))
      .mockRejectedValueOnce(nodeError("EPERM"))
      .mockResolvedValue(undefined);
    const adapter = createAdapter({ removeFile });

    try {
      await new DesktopNativeModuleMaintenance(fixture.workspaceRoot, adapter).clearRebuildMetadata();

      expect(removeFile).toHaveBeenCalledTimes(3);
      expect(removeFile).toHaveBeenCalledWith(
        expect.stringMatching(/node_modules[\\/]better-sqlite3[\\/]build[\\/]Release[\\/]\.forge-meta$/u),
      );
      expect(adapter.wait).toHaveBeenNthCalledWith(1, 25);
      expect(adapter.wait).toHaveBeenNthCalledWith(2, 50);
    } finally {
      fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
    }
  });

  test("does not retry non-transient filesystem failures", async () => {
    const fixture = createWorkspace();
    const failure = nodeError("EIO");
    const adapter = createAdapter({ removeFile: vi.fn().mockRejectedValue(failure) });

    try {
      await expect(
        new DesktopNativeModuleMaintenance(fixture.workspaceRoot, adapter).clearRebuildMetadata(),
      ).rejects.toMatchObject({ cause: failure });
      expect(adapter.removeFile).toHaveBeenCalledTimes(1);
      expect(adapter.wait).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
    }
  });

  test("restores every installed native module and clears rebuild metadata", async () => {
    const fixture = createWorkspace();
    const adapter = createAdapter();

    try {
      await new DesktopNativeModuleMaintenance(fixture.workspaceRoot, adapter).restoreNodeCompatibility();

      expect(adapter.run).toHaveBeenCalledWith("npm", ["rebuild"], fixture.moduleRoot);
      expect(adapter.removeFile).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
    }
  });

  test("preserves both rebuild and cleanup failures", async () => {
    const fixture = createWorkspace();
    const rebuildFailure = new Error("rebuild failed");
    const adapter = createAdapter({
      run: vi.fn().mockRejectedValue(rebuildFailure),
      removeFile: vi.fn().mockRejectedValue(nodeError("EACCES")),
    });

    try {
      const failure = await new DesktopNativeModuleMaintenance(fixture.workspaceRoot, adapter)
        .restoreNodeCompatibility()
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toHaveLength(2);
      expect((failure as AggregateError).errors[0]).toMatchObject({ cause: rebuildFailure });
      expect(adapter.removeFile).toHaveBeenCalledTimes(5);
    } finally {
      fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
    }
  });
});

function createWorkspace(): { workspaceRoot: string; moduleRoot: string } {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-native-maintenance-"));
  const moduleRoot = path.join(workspaceRoot, "node_modules", "better-sqlite3");
  fs.mkdirSync(moduleRoot, { recursive: true });
  fs.writeFileSync(path.join(moduleRoot, "package.json"), "{}", "utf8");
  return { workspaceRoot, moduleRoot };
}

function createAdapter(
  overrides: Partial<DesktopNativeModuleMaintenanceAdapter> = {},
): DesktopNativeModuleMaintenanceAdapter {
  return {
    removeFile: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue(0),
    wait: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function nodeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}
