import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { describe, expect, test } from "vitest";
import {
  discoverElectronNativeModuleInstances,
  nativeModuleArtifactRelativePaths,
} from "../../../Build/PrepareElectronNativeModules.js";

describe("Electron native module preparation", () => {
  test("prefers the N-API prebuild supplied by current better-sqlite3 releases", () => {
    expect(nativeModuleArtifactRelativePaths("better-sqlite3", "win32", "x64")).toEqual([
      "prebuilds/win32-x64.node",
      "build/Release/better_sqlite3.node",
    ]);
  });

  test("supports legacy node-gyp artifacts and Linux libc variants", () => {
    expect(nativeModuleArtifactRelativePaths("better-sqlite3", "linux", "arm64")).toEqual([
      "prebuilds/linux-arm64.node",
      "prebuilds/linuxmusl-arm64.node",
      "build/Release/better_sqlite3.node",
    ]);
  });

  test("discovers installed native module instances", () => {
    const emptyWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "senera-electron-native-"));
    try {
      expect(discoverElectronNativeModuleInstances(emptyWorkspace)).toEqual([]);
    } finally {
      fs.rmSync(emptyWorkspace, { recursive: true, force: true });
    }

    const discovered = discoverElectronNativeModuleInstances(process.cwd());
    expect(discovered).toEqual(
      expect.arrayContaining([expect.objectContaining({ relativePath: "node_modules/better-sqlite3" })]),
    );
    expect(
      discovered.every(
        ({ name, sourceRoot, relativePath }) =>
          name === "better-sqlite3" && path.isAbsolute(sourceRoot) && relativePath.startsWith("node_modules/"),
      ),
    ).toBe(true);
  });

  test("checks every installed native module instance, including nested dependencies", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "senera-electron-native-nested-"));
    const rootModule = path.join(workspace, "node_modules", "better-sqlite3");
    const nestedModule = path.join(workspace, "node_modules", "@memory", "sdk", "node_modules", "better-sqlite3");
    try {
      fs.mkdirSync(path.join(rootModule, "prebuilds"), { recursive: true });
      fs.mkdirSync(path.join(nestedModule, "build", "Release"), { recursive: true });
      fs.writeFileSync(path.join(rootModule, "package.json"), "{}", "utf8");
      fs.writeFileSync(path.join(nestedModule, "package.json"), "{}", "utf8");
      fs.writeFileSync(path.join(rootModule, "prebuilds", "win32-x64.node"), "root", "utf8");

      expect(discoverElectronNativeModuleInstances(workspace)).toEqual([
        expect.objectContaining({ relativePath: "node_modules/@memory/sdk/node_modules/better-sqlite3" }),
        expect.objectContaining({ relativePath: "node_modules/better-sqlite3" }),
      ]);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
