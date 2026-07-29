import { describe, expect, test, vi } from "vitest";
import {
  DesktopNativeModuleMaintenance,
  type DesktopNativeModuleMaintenanceAdapter,
} from "../../../Build/DesktopNativeModuleMaintenance.js";

describe("desktop native module maintenance", () => {
  test("retries transient metadata locks with bounded exponential backoff", async () => {
    const removeFile = vi
      .fn<DesktopNativeModuleMaintenanceAdapter["removeFile"]>()
      .mockRejectedValueOnce(nodeError("EBUSY"))
      .mockRejectedValueOnce(nodeError("EPERM"))
      .mockResolvedValue(undefined);
    const adapter = createAdapter({ removeFile });

    await new DesktopNativeModuleMaintenance("C:/workspace", adapter).clearRebuildMetadata();

    expect(removeFile).toHaveBeenCalledTimes(3);
    expect(removeFile).toHaveBeenCalledWith(
      expect.stringMatching(/node_modules[\\/]better-sqlite3[\\/]build[\\/]Release[\\/]\.forge-meta$/u),
    );
    expect(adapter.wait).toHaveBeenNthCalledWith(1, 25);
    expect(adapter.wait).toHaveBeenNthCalledWith(2, 50);
  });

  test("does not retry non-transient filesystem failures", async () => {
    const failure = nodeError("EIO");
    const adapter = createAdapter({ removeFile: vi.fn().mockRejectedValue(failure) });

    await expect(
      new DesktopNativeModuleMaintenance("C:/workspace", adapter).clearRebuildMetadata(),
    ).rejects.toMatchObject({ cause: failure });
    expect(adapter.removeFile).toHaveBeenCalledTimes(1);
    expect(adapter.wait).not.toHaveBeenCalled();
  });

  test("keeps a Node-compatible native module and clears stale Electron metadata", async () => {
    const adapter = createAdapter();

    await new DesktopNativeModuleMaintenance("C:/workspace", adapter).ensureNodeCompatibility();

    expect(adapter.probe).toHaveBeenCalledWith("node", expect.any(Array), "C:/workspace");
    expect(adapter.run).not.toHaveBeenCalled();
    expect(adapter.removeFile).toHaveBeenCalledTimes(1);
  });

  test("restores Node compatibility after an interrupted Electron session", async () => {
    const adapter = createAdapter({ probe: vi.fn().mockResolvedValue(false) });

    await new DesktopNativeModuleMaintenance("C:/workspace", adapter).ensureNodeCompatibility();

    expect(adapter.run).toHaveBeenCalledWith("npm", ["rebuild", "better-sqlite3"], "C:/workspace");
    expect(adapter.removeFile).toHaveBeenCalledTimes(1);
  });

  test("rebuilds only declared native modules for Electron compatibility", async () => {
    const adapter = createAdapter();

    await new DesktopNativeModuleMaintenance("C:/workspace", adapter).rebuildForElectronCompatibility("42.5.0", "x64");

    expect(adapter.run).toHaveBeenCalledWith(
      "electron-rebuild",
      ["--force", "--only", "better-sqlite3", "--version", "42.5.0", "--arch", "x64"],
      "C:/workspace",
    );
  });
  test("restores every declared native module and clears rebuild metadata", async () => {
    const adapter = createAdapter();

    await new DesktopNativeModuleMaintenance("C:/workspace", adapter).restoreNodeCompatibility();

    expect(adapter.run).toHaveBeenCalledWith("npm", ["rebuild", "better-sqlite3"], "C:/workspace");
    expect(adapter.removeFile).toHaveBeenCalledTimes(1);
  });

  test("preserves both rebuild and cleanup failures", async () => {
    const rebuildFailure = new Error("rebuild failed");
    const adapter = createAdapter({
      run: vi.fn().mockRejectedValue(rebuildFailure),
      removeFile: vi.fn().mockRejectedValue(nodeError("EACCES")),
    });

    const failure = await new DesktopNativeModuleMaintenance("C:/workspace", adapter)
      .restoreNodeCompatibility()
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(2);
    expect((failure as AggregateError).errors[0]).toBe(rebuildFailure);
    expect(adapter.removeFile).toHaveBeenCalledTimes(5);
  });
});

function createAdapter(
  overrides: Partial<DesktopNativeModuleMaintenanceAdapter> = {},
): DesktopNativeModuleMaintenanceAdapter {
  return {
    removeFile: vi.fn().mockResolvedValue(undefined),
    probe: vi.fn().mockResolvedValue(true),
    run: vi.fn().mockResolvedValue(0),
    wait: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function nodeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}
