import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import {
  DesktopRuntimePathResolutionError,
  resolveDesktopApplicationRoot,
  resolveDesktopApplicationDataRoot,
  resolveDesktopResourceRoot,
  resolveDesktopWorkspaceRoot,
} from "../Apps/Desktop/DesktopRuntimePathResolver.js";

import {
  readDesktopWorkspaceSelection,
  resolveDesktopWorkspaceSelectionPath,
  writeDesktopWorkspaceSelection,
} from "../Apps/Desktop/DesktopWorkspaceSelection.js";
import { resolveAgentWorkspaceLayout } from "../Source/AgentSystem/Core/AgentWorkspaceLayout.js";

const workspaceRoot = process.cwd();
const packageManifest = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf8")) as {
  build?: { nsis?: { include?: unknown; allowToChangeInstallationDirectory?: unknown } };
};
assert.equal(packageManifest.build?.nsis?.include, undefined);
assert.equal(packageManifest.build?.nsis?.allowToChangeInstallationDirectory, true);
assert.equal(resolveDesktopWorkspaceRoot({ resourceRoot: workspaceRoot, isPackaged: true }), undefined);
const temporaryRoot = path.join(workspaceRoot, ".cache", "desktop-path-verification");
fs.rmSync(temporaryRoot, { recursive: true, force: true });
fs.mkdirSync(temporaryRoot, { recursive: true });

const distDesktopRoot = path.join(workspaceRoot, "Dist", "Apps", "Desktop");
const packagedResourceRoot = path.join(workspaceRoot, "resources");
const packagedAppRoot = path.join(packagedResourceRoot, "app.asar");

assert.equal(
  resolveDesktopApplicationRoot({
    appPath: distDesktopRoot,
    isPackaged: false,
    resourceRoot: workspaceRoot,
  }),
  workspaceRoot,
);

assert.equal(
  resolveDesktopApplicationRoot({
    appPath: packagedAppRoot,
    isPackaged: true,
    resourceRoot: packagedResourceRoot,
  }),
  packagedAppRoot,
);

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
    resourcesPath: packagedResourceRoot,
  }),
  packagedResourceRoot,
);

assert.throws(
  () =>
    resolveDesktopResourceRoot({
      appPath: path.join(packagedResourceRoot, "app.asar"),
      isPackaged: true,
      launchRoot: workspaceRoot,
    }),
  DesktopRuntimePathResolutionError,
);

assert.equal(
  resolveDesktopWorkspaceRoot({
    resourceRoot: workspaceRoot,
    persistedWorkspaceRoot: path.join(workspaceRoot, ".senera", "desktop-data"),
  }),
  path.join(workspaceRoot, ".senera", "desktop-data"),
);

assert.equal(
  resolveDesktopWorkspaceRoot({
    resourceRoot: workspaceRoot,
    configuredWorkspaceRoot: path.join(workspaceRoot, "configured-workspace"),
    persistedWorkspaceRoot: path.join(workspaceRoot, "persisted-workspace"),
  }),
  path.join(workspaceRoot, "configured-workspace"),
);

assert.equal(resolveDesktopWorkspaceRoot({ resourceRoot: workspaceRoot }), workspaceRoot);

const previousDataRoot = process.env.SENERA_DATA_ROOT;
try {
  const applicationDataRoot = path.join(temporaryRoot, "application-data");
  process.env.SENERA_DATA_ROOT = applicationDataRoot;
  assert.equal(resolveDesktopApplicationDataRoot(), applicationDataRoot);
  assert.notEqual(resolveDesktopApplicationDataRoot(), workspaceRoot);
} finally {
  if (previousDataRoot === undefined) delete process.env.SENERA_DATA_ROOT;
  else process.env.SENERA_DATA_ROOT = previousDataRoot;
}

const workspaceLayout = resolveAgentWorkspaceLayout(workspaceRoot);
assert.equal(workspaceLayout.desktopRuntimeRoot, path.join(workspaceRoot, ".senera", "desktop"));

const desktopRuntimeSource = fs.readFileSync(path.join(workspaceRoot, "Apps", "Desktop", "DesktopRuntime.ts"), "utf8");
assert.ok(
  !desktopRuntimeSource.includes('const desktopDataRoot = path.join(userDataRoot, "runtime")'),
  "Desktop runtime state must not be rooted in Electron userData.",
);
assert.ok(
  desktopRuntimeSource.includes("workspaceLayout.desktopRuntimeRoot"),
  "Desktop runtime state must use the selected workspace layout.",
);
assert.ok(
  desktopRuntimeSource.includes('app.setPath("userData", desktopDataRoot)'),
  "Electron userData must follow the selected workspace runtime root.",
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

const legacyWorkspacePath = resolveDesktopWorkspaceSelectionPath(temporaryRoot);
writeDesktopWorkspaceSelection(legacyWorkspacePath, temporaryRoot);
assert.equal(readDesktopWorkspaceSelection(legacyWorkspacePath), path.resolve(temporaryRoot));
writeDesktopWorkspaceSelection(legacyWorkspacePath, workspaceRoot);
assert.equal(readDesktopWorkspaceSelection(legacyWorkspacePath), workspaceRoot);
fs.writeFileSync(legacyWorkspacePath, "{", "utf8");
assert.throws(() => readDesktopWorkspaceSelection(legacyWorkspacePath), SyntaxError);

fs.rmSync(temporaryRoot, { recursive: true, force: true });

console.log("Desktop runtime path verification passed.");
