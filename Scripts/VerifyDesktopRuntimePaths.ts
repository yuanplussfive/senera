import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import {
  DesktopRuntimePathResolutionError,
  resolveDesktopResourceRoot,
  resolveDesktopWorkspaceRoot,
} from "../Apps/Desktop/DesktopRuntimePathResolver.js";
import {
  isCurrentDesktopInstallationSelection,
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
import { resolveAgentWorkspaceLayout } from "../Source/AgentSystem/Core/AgentWorkspaceLayout.js";

const workspaceRoot = process.cwd();
const packageManifest = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf8")) as {
  build?: { nsis?: { include?: unknown; allowToChangeInstallationDirectory?: unknown } };
};
const installerScriptPath = path.join(workspaceRoot, "Build", "installer.nsh");
const installerScript = fs.readFileSync(installerScriptPath, "utf8");
assert.equal(packageManifest.build?.nsis?.include, "Build/installer.nsh");
assert.equal(packageManifest.build?.nsis?.allowToChangeInstallationDirectory, true);
for (const requiredInstallerContract of [
  "!macro customPageAfterChangeDir",
  "!macro customInstall",
  "installation.json",
  "SeneraWriteInstallationSelection",
  "!ifndef BUILD_UNINSTALLER",
  "SeneraHasValidInstallationSelection",
  "SeneraVerifyInstallationSelection",
]) {
  assert.ok(
    installerScript.includes(requiredInstallerContract),
    `NSIS installer contract is missing: ${requiredInstallerContract}`,
  );
}
assert.ok(!installerScript.includes("SeneraDataRoot"), "The installer must not expose a configurable data root.");
assert.ok(
  !installerScript.includes("SeneraCopySelectionToInstallAnchor"),
  "The installer must not write an install anchor.",
);
const temporaryRoot = path.join(workspaceRoot, ".cache", "desktop-path-verification");
fs.rmSync(temporaryRoot, { recursive: true, force: true });
fs.mkdirSync(temporaryRoot, { recursive: true });

const distDesktopRoot = path.join(workspaceRoot, "Dist", "Apps", "Desktop");
const packagedResourceRoot = path.join(workspaceRoot, "resources");

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

const selectionPath = resolveDesktopInstallationSelectionPath(temporaryRoot);
writeDesktopInstallationSelection(selectionPath, {
  workspaceRoot,
});
assert.deepEqual(readDesktopInstallationSelection(selectionPath), {
  version: 2,
  workspaceRoot,
});
assert.equal(isCurrentDesktopInstallationSelection(selectionPath), true);

const legacySelectionPath = path.join(temporaryRoot, "legacy-installation.json");
fs.writeFileSync(
  legacySelectionPath,
  `${JSON.stringify({ version: 1, dataRoot: path.join(temporaryRoot, "obsolete-data"), workspaceRoot }, null, 2)}\n`,
  "utf8",
);
assert.deepEqual(readDesktopInstallationSelection(legacySelectionPath), {
  version: 2,
  workspaceRoot,
});
assert.equal(isCurrentDesktopInstallationSelection(legacySelectionPath), false);

const legacyWorkspacePath = resolveDesktopWorkspaceSelectionPath(temporaryRoot);
writeDesktopWorkspaceSelection(legacyWorkspacePath, temporaryRoot);
assert.equal(readDesktopWorkspaceSelection(legacyWorkspacePath), path.resolve(temporaryRoot));
assert.equal(readLegacyDesktopWorkspaceSelection(legacyWorkspacePath, temporaryRoot), undefined);
writeDesktopWorkspaceSelection(legacyWorkspacePath, workspaceRoot);
assert.equal(readLegacyDesktopWorkspaceSelection(legacyWorkspacePath, temporaryRoot), workspaceRoot);

fs.rmSync(temporaryRoot, { recursive: true, force: true });

console.log("Desktop runtime path verification passed.");
