import fs from "node:fs";
import path from "node:path";
import {
  readAgentToolApprovalPolicyArtifact,
  resolveAgentToolApprovalPolicyArtifactDirectory,
} from "../Source/AgentSystem/Safety/AgentToolApprovalPolicyArtifact.js";

const workspaceRoot = process.cwd();
const sourceRoot = path.join(workspaceRoot, "Source");
const distSourceRoot = path.join(workspaceRoot, "Dist", "Source");

readAgentToolApprovalPolicyArtifact(resolveAgentToolApprovalPolicyArtifactDirectory(sourceRoot));
const runtimeAssets = discoverRuntimeAssets(sourceRoot);

for (const sourcePath of runtimeAssets) {
  const relativePath = path.relative(sourceRoot, sourcePath);
  const targetPath = path.join(distSourceRoot, relativePath);
  copyFile(sourcePath, targetPath);
}

readAgentToolApprovalPolicyArtifact(resolveAgentToolApprovalPolicyArtifactDirectory(distSourceRoot));

process.stdout.write(`Runtime assets copied: ${runtimeAssets.length}\n`);

function discoverRuntimeAssets(root: string): string[] {
  const copiedExtensions = new Set([".json", ".rego", ".wasm"]);
  return walkFiles(root)
    .filter((file) => copiedExtensions.has(path.extname(file)))
    .sort((left, right) => left.localeCompare(right));
}

function walkFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(entryPath) : [entryPath];
  });
}

function copyFile(sourcePath: string, targetPath: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}
