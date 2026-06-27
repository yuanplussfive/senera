import fs from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const sourceRoot = path.join(workspaceRoot, "Source");
const distSourceRoot = path.join(workspaceRoot, "Dist", "Source");

const runtimeAssets = discoverRuntimeAssets(sourceRoot);

for (const sourcePath of runtimeAssets) {
  const relativePath = path.relative(sourceRoot, sourcePath);
  const targetPath = path.join(distSourceRoot, relativePath);
  copyFile(sourcePath, targetPath);
}

console.log(`Runtime assets copied: ${runtimeAssets.length}`);

function discoverRuntimeAssets(root: string): string[] {
  return walkFiles(root)
    .filter((file) => path.extname(file) === ".json")
    .sort((left, right) => left.localeCompare(right));
}

function walkFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? walkFiles(entryPath)
      : [entryPath];
  });
}

function copyFile(sourcePath: string, targetPath: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}
