const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");

const NativeModules = {
  "better-sqlite3": "better_sqlite3.node",
};
const SchemaCompilerLibraryFiles = ["lib.d.ts", "lib.es5.d.ts", "lib.es2022.full.d.ts"];

module.exports = async function injectStagedElectronNativeModules(context) {
  const workspaceRoot = process.cwd();
  const electronVersion = require(path.join(workspaceRoot, "node_modules", "electron", "package.json")).version;
  const stageRoot = path.join(
    workspaceRoot,
    ".cache",
    "electron-native",
    `electron-${electronVersion}-${process.arch}`,
  );

  assertSchemaCompilerLibraryFiles(context);

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

function assertSchemaCompilerLibraryFiles(context) {
  const resourcesRoot = path.join(context.appOutDir, "resources");
  const archivePath = path.join(resourcesRoot, "app.asar");
  const unpackedLibraryRoot = path.join(resourcesRoot, "app.asar.unpacked", "node_modules", "typescript", "lib");
  const missingFiles = SchemaCompilerLibraryFiles.filter((fileName) => {
    if (fs.existsSync(path.join(unpackedLibraryRoot, fileName))) {
      return false;
    }

    try {
      asar.statFile(archivePath, path.join("node_modules", "typescript", "lib", fileName));
      return false;
    } catch {
      return true;
    }
  });
  if (missingFiles.length > 0) {
    throw new Error(`Packaged TypeScript schema compiler libraries are missing: ${missingFiles.join(", ")}`);
  }
}
