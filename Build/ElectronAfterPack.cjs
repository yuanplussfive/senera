const fs = require("node:fs");
const path = require("node:path");

module.exports = async function injectStagedElectronNativeModules(context) {
  const workspaceRoot = process.cwd();
  const electronVersion = require(path.join(workspaceRoot, "node_modules", "electron", "package.json")).version;
  const stageRoot = path.join(
    workspaceRoot,
    ".cache",
    "electron-native",
    `electron-${electronVersion}-${process.platform}-${process.arch}`,
  );
  const manifestPath = path.join(stageRoot, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Staged Electron native module manifest is missing: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) {
    throw new Error(`Staged Electron native module manifest is invalid: ${manifestPath}`);
  }
  if (
    manifest.electronVersion !== electronVersion ||
    manifest.platform !== process.platform ||
    manifest.architecture !== process.arch
  ) {
    throw new Error(`Staged Electron native module manifest does not match this build: ${manifestPath}`);
  }

  for (const module of manifest.modules) {
    if (
      !module ||
      typeof module.relativePath !== "string" ||
      typeof module.artifactPath !== "string" ||
      path.isAbsolute(module.relativePath) ||
      path.isAbsolute(module.artifactPath) ||
      module.relativePath.split(/[\\/]/u).includes("..") ||
      module.artifactPath.split(/[\\/]/u).includes("..")
    ) {
      throw new Error(`Staged Electron native module manifest contains an invalid module entry: ${manifestPath}`);
    }
    const source = path.join(stageRoot, module.relativePath, module.artifactPath);
    if (!fs.existsSync(source)) {
      throw new Error(`Staged Electron native module is missing: ${source}`);
    }
    const target = path.join(
      context.appOutDir,
      "resources",
      "app.asar.unpacked",
      module.relativePath,
      module.artifactPath,
    );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
};
