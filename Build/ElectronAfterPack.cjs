const fs = require("node:fs");
const path = require("node:path");

const NativeModules = {
  "better-sqlite3": (platform, architecture) => [
    `prebuilds/${platform}-${architecture}.node`,
    ...(platform === "linux" ? [`prebuilds/linuxmusl-${architecture}.node`] : []),
    "build/Release/better_sqlite3.node",
  ],
};

module.exports = async function injectStagedElectronNativeModules(context) {
  const workspaceRoot = process.cwd();
  const electronVersion = require(path.join(workspaceRoot, "node_modules", "electron", "package.json")).version;
  const stageRoot = path.join(
    workspaceRoot,
    ".cache",
    "electron-native",
    `electron-${electronVersion}-${process.arch}`,
  );

  for (const [moduleName, artifactPaths] of Object.entries(NativeModules)) {
    const moduleRoot = path.join(stageRoot, "node_modules", moduleName);
    const artifactPath = artifactPaths(process.platform, process.arch).find((candidate) =>
      fs.existsSync(path.join(moduleRoot, candidate)),
    );
    if (!artifactPath) {
      throw new Error(`Staged Electron native module is missing: ${moduleRoot}`);
    }
    const source = path.join(moduleRoot, artifactPath);
    const target = path.join(
      context.appOutDir,
      "resources",
      "app.asar.unpacked",
      "node_modules",
      moduleName,
      artifactPath,
    );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
};
