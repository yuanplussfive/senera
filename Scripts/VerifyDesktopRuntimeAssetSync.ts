import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { syncDesktopRuntimeDirectory } from "../Apps/Desktop/DesktopRuntimeAssetSync.js";

const tempRoot = path.join(process.cwd(), ".senera", "tmp", "verify-desktop-runtime-sync");
fs.mkdirSync(tempRoot, { recursive: true });
const workspaceRoot = fs.mkdtempSync(path.join(tempRoot, "run-"));

try {
  const sourceRoot = path.join(workspaceRoot, "source");
  const targetRoot = path.join(workspaceRoot, "target");

  writeText(path.join(sourceRoot, "AgentDecisionPlugin", "docs", "ToolCalls.md"), "current docs");
  writeText(path.join(sourceRoot, "WeatherToolPlugin", "PluginManifest.json"), "{}");
  writeText(path.join(targetRoot, "AgentDecisionPlugin", "PluginManifest.json"), "{\"DecisionActions\":[]}");
  writeText(path.join(targetRoot, "AgentDecisionPlugin", "PluginConfig.toml"), "enabled = true");
  writeText(path.join(targetRoot, "AgentDecisionPlugin", "docs", "Old.md"), "old docs");
  writeText(path.join(targetRoot, "RemovedPlugin", "PluginManifest.json"), "{}");
  writeText(path.join(targetRoot, "WeatherToolPlugin", "stale.txt"), "stale");

  syncDesktopRuntimeDirectory(sourceRoot, targetRoot, {
    preserveFileNames: ["PluginConfig.toml"],
    pruneExtraneous: true,
  });

  assert.equal(exists(path.join(targetRoot, "AgentDecisionPlugin", "PluginManifest.json")), false);
  assert.equal(readText(path.join(targetRoot, "AgentDecisionPlugin", "PluginConfig.toml")), "enabled = true");
  assert.equal(readText(path.join(targetRoot, "AgentDecisionPlugin", "docs", "ToolCalls.md")), "current docs");
  assert.equal(exists(path.join(targetRoot, "AgentDecisionPlugin", "docs", "Old.md")), false);
  assert.equal(exists(path.join(targetRoot, "RemovedPlugin")), false);
  assert.equal(exists(path.join(targetRoot, "WeatherToolPlugin", "stale.txt")), false);

  const packageSourceRoot = path.join(workspaceRoot, "package-source");
  const packageTargetRoot = path.join(workspaceRoot, "package-target");
  writeText(path.join(packageSourceRoot, "package.json"), "{}");
  writeText(path.join(packageTargetRoot, "generated.cache"), "keep");

  syncDesktopRuntimeDirectory(packageSourceRoot, packageTargetRoot);

  assert.equal(readText(path.join(packageTargetRoot, "generated.cache")), "keep");

  console.log("Desktop runtime asset sync verification passed.");
} finally {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
}

function writeText(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}
