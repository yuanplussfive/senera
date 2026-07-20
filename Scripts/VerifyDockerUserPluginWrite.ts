import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const workspaceRoot = path.resolve(process.env.SENERA_WORKSPACE_ROOT?.trim() || "/data");
const pluginRoot = path.join(workspaceRoot, "Plugins");
const probeDirectory = path.join(pluginRoot, `.senera-write-probe-${process.pid}`);
const probePath = path.join(probeDirectory, "PluginConfig.toml");

try {
  fs.mkdirSync(probeDirectory, { recursive: true });
  fs.writeFileSync(probePath, "enabled = true\n", "utf8");
  assert.equal(fs.readFileSync(probePath, "utf8"), "enabled = true\n");
  console.log("Docker user plugin write verification passed.");
} finally {
  fs.rmSync(probeDirectory, { recursive: true, force: true });
}
