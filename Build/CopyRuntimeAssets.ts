import fs from "node:fs";
import path from "node:path";
import { buildSync } from "esbuild";
import {
  readAgentToolApprovalPolicyArtifact,
  resolveAgentToolApprovalPolicyArtifactDirectory,
} from "../Source/AgentSystem/Safety/AgentToolApprovalPolicyArtifact.js";
import { walkFiles } from "../Scripts/Support/FileWalk.js";
import { bundleDesktopServer } from "./BundleDesktopServer.js";

const workspaceRoot = process.cwd();
const sourceRoot = path.join(workspaceRoot, "Source");
const distSourceRoot = path.join(workspaceRoot, "Dist", "Source");
const desktopPreloadSource = path.join(workspaceRoot, "Apps", "Desktop", "Preload.ts");
const desktopPreloadTarget = path.join(workspaceRoot, "Dist", "Apps", "Desktop", "Preload.cjs");

readAgentToolApprovalPolicyArtifact(resolveAgentToolApprovalPolicyArtifactDirectory(sourceRoot));
const runtimeAssets = discoverRuntimeAssets(sourceRoot);

for (const sourcePath of runtimeAssets) {
  const relativePath = path.relative(sourceRoot, sourcePath);
  const targetPath = path.join(distSourceRoot, relativePath);
  copyFile(sourcePath, targetPath);
}

buildDesktopPreload(desktopPreloadSource, desktopPreloadTarget);

readAgentToolApprovalPolicyArtifact(resolveAgentToolApprovalPolicyArtifactDirectory(distSourceRoot));

const desktopServerBundle = await bundleDesktopServer();

process.stdout.write(
  `Runtime assets prepared: ${runtimeAssets.length + 1}, desktop server bundle ${
    desktopServerBundle.skipped ? "up to date" : "rebuilt"
  } (${desktopServerBundle.bytes} bytes)\n`,
);

function buildDesktopPreload(sourcePath: string, targetPath: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  buildSync({
    entryPoints: [sourcePath],
    outfile: targetPath,
    bundle: true,
    external: ["electron"],
    format: "cjs",
    platform: "node",
    target: "node24",
    logLevel: "silent",
  });
}

function discoverRuntimeAssets(root: string): string[] {
  const copiedExtensions = new Set([".cjs", ".json", ".rego", ".sql", ".wasm"]);
  return walkFiles(root)
    .filter((file) => copiedExtensions.has(path.extname(file)))
    .sort((left, right) => left.localeCompare(right));
}

function copyFile(sourcePath: string, targetPath: string): void {
  const source = fs.statSync(sourcePath);
  const target = fs.statSync(targetPath, { throwIfNoEntry: false });
  // Live starts re-run this step on every launch, so leave already-matching assets alone.
  if (target && target.size === source.size && target.mtimeMs >= source.mtimeMs) return;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}
