import assert from "node:assert/strict";
import path from "node:path";
import {
  DesktopRuntimePathResolutionError,
  resolveDesktopResourceRoot,
  resolveDesktopWorkspaceRoot,
} from "../Apps/Desktop/DesktopRuntimePathResolver.js";

const workspaceRoot = process.cwd();
const distDesktopRoot = path.join(workspaceRoot, "Dist", "Apps", "Desktop");

assert.equal(
  resolveDesktopResourceRoot({
    appPath: distDesktopRoot,
    isPackaged: false,
    launchRoot: workspaceRoot,
  }),
  workspaceRoot,
);

assert.equal(
  resolveDesktopResourceRoot({
    appPath: distDesktopRoot,
    isPackaged: false,
    launchRoot: path.dirname(process.execPath),
  }),
  workspaceRoot,
);

assert.equal(
  resolveDesktopResourceRoot({
    appPath: distDesktopRoot,
    isPackaged: true,
    launchRoot: workspaceRoot,
  }),
  distDesktopRoot,
);

assert.equal(
  resolveDesktopWorkspaceRoot({
    isPackaged: false,
    resourceRoot: workspaceRoot,
    userDataRoot: path.join(workspaceRoot, ".senera", "desktop-data"),
  }),
  workspaceRoot,
);

assert.equal(
  resolveDesktopWorkspaceRoot({
    isPackaged: true,
    resourceRoot: workspaceRoot,
    userDataRoot: path.join(workspaceRoot, ".senera", "desktop-data"),
  }),
  path.join(workspaceRoot, ".senera", "desktop-data"),
);

assert.throws(
  () =>
    resolveDesktopResourceRoot({
      appPath: path.resolve(workspaceRoot, "..", "missing-app"),
      isPackaged: false,
      launchRoot: path.resolve(workspaceRoot, "..", "missing-launch"),
    }),
  DesktopRuntimePathResolutionError,
);

console.log("Desktop runtime path verification passed.");
