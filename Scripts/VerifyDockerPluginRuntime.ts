import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { syncRuntimeDirectory } from "../Apps/RuntimeAssetSync.js";

const workspaceRoot = process.cwd();
const dockerfile = fs.readFileSync(path.join(workspaceRoot, "Dockerfile"), "utf8");
const dockerServer = fs.readFileSync(path.join(workspaceRoot, "Apps", "DockerServer.ts"), "utf8");
const tempParent = path.join(workspaceRoot, ".senera", "tmp");
fs.mkdirSync(tempParent, { recursive: true });
const tempRoot = fs.mkdtempSync(path.join(tempParent, "verify-docker-plugin-"));

try {
  assert.match(dockerServer, /DockerUserPluginRoot\s*=\s*path\.join\(WorkspaceRoot, "Plugins"\)/);
  assert.match(dockerServer, /syncRuntimeDirectory\(BundledDockerUserPluginRoot, DockerUserPluginRoot/);
  assert.match(dockerfile, /mkdir -p \/data\/Plugins/);
  assert.match(dockerfile, /chown -R node:node \/data/);

  const bundledRoot = path.join(tempRoot, "bundled");
  const persistentRoot = path.join(tempRoot, "persistent");
  writeText(path.join(bundledRoot, "WeatherToolPlugin", "PluginManifest.json"), '{"version":2}');
  writeText(path.join(bundledRoot, "WeatherToolPlugin", "PluginConfig.toml"), "enabled = false\n");
  writeText(path.join(bundledRoot, "WeatherToolPlugin", "runtime.js"), "current");
  writeText(path.join(persistentRoot, "WeatherToolPlugin", "PluginConfig.toml"), "enabled = true\n");
  writeText(path.join(persistentRoot, "CustomPlugin", "PluginManifest.json"), '{"custom":true}');

  syncRuntimeDirectory(bundledRoot, persistentRoot, {
    preserveFileNames: ["PluginConfig.toml"],
  });

  assert.equal(readText(path.join(persistentRoot, "WeatherToolPlugin", "PluginConfig.toml")), "enabled = true\n");
  assert.equal(readText(path.join(persistentRoot, "WeatherToolPlugin", "PluginManifest.json")), '{"version":2}');
  assert.equal(readText(path.join(persistentRoot, "WeatherToolPlugin", "runtime.js")), "current");
  assert.equal(readText(path.join(persistentRoot, "CustomPlugin", "PluginManifest.json")), '{"custom":true}');

  console.log("Docker user plugin runtime verification passed.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function writeText(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}
