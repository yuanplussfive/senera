import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  nativeModuleArtifactRelativePaths,
  workspaceHasElectronNativeArtifacts,
} from "../../../Build/PrepareElectronNativeModules.js";

describe("Electron native module preparation", () => {
  test("prefers the N-API prebuild supplied by current better-sqlite3 releases", () => {
    expect(nativeModuleArtifactRelativePaths("better-sqlite3", "win32", "x64")).toEqual([
      "prebuilds/win32-x64.node",
      "build/Release/better_sqlite3.node",
    ]);
  });

  test("keeps the legacy node-gyp location as a fallback and supports Linux libc variants", () => {
    expect(nativeModuleArtifactRelativePaths("better-sqlite3", "linux", "arm64")).toEqual([
      "prebuilds/linux-arm64.node",
      "prebuilds/linuxmusl-arm64.node",
      "build/Release/better_sqlite3.node",
    ]);
  });

  test("detects when the workspace already has N-API prebuilds", () => {
    const emptyWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "senera-electron-native-"));
    try {
      expect(workspaceHasElectronNativeArtifacts(emptyWorkspace)).toBe(false);
    } finally {
      fs.rmSync(emptyWorkspace, { recursive: true, force: true });
    }

    expect(workspaceHasElectronNativeArtifacts(process.cwd())).toBe(true);
  });
});
