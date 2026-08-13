import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import {
  DesktopRuntimePathResolutionError,
  resolveDesktopResourceRoot,
  resolveDesktopWorkspaceRoot,
} from "../Apps/Desktop/DesktopRuntimePathResolver.js";
import {
  readDesktopInstallationSelection,
  resolveDesktopInstallationSelectionPath,
  writeDesktopInstallationSelection,
} from "../Apps/Desktop/DesktopInstallationSelection.js";
import {
  readDesktopWorkspaceSelection,
  readLegacyDesktopWorkspaceSelection,
  resolveDesktopWorkspaceSelectionPath,
  writeDesktopWorkspaceSelection,
} from "../Apps/Desktop/DesktopWorkspaceSelection.js";

const workspaceRoot = process.cwd();
const packageManifest = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf8")) as {
  build?: { nsis?: { include?: unknown } };
};
const installerScriptPath = path.join(workspaceRoot, "Build", "installer.nsh");
const installerScript = fs.readFileSync(installerScriptPath, "utf8");
assert.equal(packageManifest.build?.nsis?.include, "Build/installer.nsh");
for (const requiredInstallerContract of [
  "!macro customPageAfterChangeDir",
  "!macro customInstall",
  "installation.json",
  "SeneraWriteInstallationSelection",
  "!ifndef BUILD_UNINSTALLER",
  "SeneraHasValidInstallationSelection",
]) {
  assert.ok(
    installerScript.includes(requiredInstallerContract),
    `NSIS installer contract is missing: ${requiredInstallerContract}`,
  );
}
const temporaryRoot = path.join(workspaceRoot, ".cache", "desktop-path-verification");
fs.rmSync(temporaryRoot, { recursive: true, force: true });
fs.mkdirSync(temporaryRoot, { recursive: true });

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
    persistedWorkspaceRoot: path.join(workspaceRoot, ".senera", "desktop-data"),
  }),
  workspaceRoot,
);

assert.equal(
  resolveDesktopWorkspaceRoot({
    isPackaged: true,
    resourceRoot: workspaceRoot,
    persistedWorkspaceRoot: path.join(workspaceRoot, ".senera", "desktop-data"),
  }),
  path.join(workspaceRoot, ".senera", "desktop-data"),
);

assert.equal(
  resolveDesktopWorkspaceRoot({
    isPackaged: true,
    resourceRoot: workspaceRoot,
    configuredWorkspaceRoot: path.join(workspaceRoot, "configured-workspace"),
    persistedWorkspaceRoot: path.join(workspaceRoot, "persisted-workspace"),
  }),
  path.join(workspaceRoot, "configured-workspace"),
);

assert.equal(resolveDesktopWorkspaceRoot({ isPackaged: true, resourceRoot: workspaceRoot }), undefined);

assert.throws(
  () =>
    resolveDesktopResourceRoot({
      appPath: path.resolve(workspaceRoot, "..", "missing-app"),
      isPackaged: false,
      launchRoot: path.resolve(workspaceRoot, "..", "missing-launch"),
    }),
  DesktopRuntimePathResolutionError,
);

const selectionPath = resolveDesktopInstallationSelectionPath(temporaryRoot);
const dataRootA = path.join(temporaryRoot, "data-a");
const dataRootB = path.join(temporaryRoot, "data-b");
writeDesktopInstallationSelection(selectionPath, {
  dataRoot: dataRootA,
  workspaceRoot,
});
assert.deepEqual(readDesktopInstallationSelection(selectionPath), {
  version: 1,
  dataRoot: dataRootA,
  workspaceRoot,
});

const movedSelection = { dataRoot: dataRootB, workspaceRoot };
writeDesktopInstallationSelection(selectionPath, movedSelection);
const movedSelectionPath = resolveDesktopInstallationSelectionPath(dataRootB);
writeDesktopInstallationSelection(movedSelectionPath, movedSelection);
assert.deepEqual(readDesktopInstallationSelection(selectionPath), {
  version: 1,
  dataRoot: dataRootB,
  workspaceRoot,
});
assert.deepEqual(readDesktopInstallationSelection(movedSelectionPath), {
  version: 1,
  dataRoot: dataRootB,
  workspaceRoot,
});

const legacyWorkspacePath = resolveDesktopWorkspaceSelectionPath(temporaryRoot);
writeDesktopWorkspaceSelection(legacyWorkspacePath, temporaryRoot);
assert.equal(readDesktopWorkspaceSelection(legacyWorkspacePath), path.resolve(temporaryRoot));
assert.equal(readLegacyDesktopWorkspaceSelection(legacyWorkspacePath, temporaryRoot), undefined);
writeDesktopWorkspaceSelection(legacyWorkspacePath, workspaceRoot);
assert.equal(readLegacyDesktopWorkspaceSelection(legacyWorkspacePath, temporaryRoot), workspaceRoot);

fs.rmSync(temporaryRoot, { recursive: true, force: true });

console.log("Desktop runtime path verification passed.");
