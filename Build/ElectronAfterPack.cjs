const fs = require("node:fs");
const path = require("node:path");

const NativeModules = {
  "better-sqlite3": "better_sqlite3.node",
};

module.exports = async function injectStagedElectronNativeModules(context) {
  const workspaceRoot = process.cwd();
  const electronVersion = require(path.join(workspaceRoot, "node_modules", "electron", "package.json")).version;
  const stageRoot = path.join(workspaceRoot, ".cache", "electron-native", `electron-${electronVersion}-${process.arch}`);

  for (const [moduleName, binaryName] of Object.entries(NativeModules)) {
    const source = path.join(stageRoot, "node_modules", moduleName, "build", "Release", binaryName);
    const target = path.join(
      context.appOutDir,
      "resources",
      "app.asar.unpacked",
      "node_modules",
      moduleName,
      "build",
      "Release",
      binaryName,
    );
    if (!fs.existsSync(source)) throw new Error(`Staged Electron native module is missing: ${source}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
};
