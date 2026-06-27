import fs from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();

const assets = [
  {
    source: path.join("Source", "AgentSystem", "Config", "AgentSystemConfig.form.json"),
    target: path.join("Dist", "Source", "AgentSystem", "Config", "AgentSystemConfig.form.json"),
  },
  {
    source: path.join("Source", "AgentSystem", "Defaults", "AgentDefaultModelProviderEndpoints.json"),
    target: path.join("Dist", "Source", "AgentSystem", "Defaults", "AgentDefaultModelProviderEndpoints.json"),
  },
];

for (const asset of assets) {
  const sourcePath = path.join(workspaceRoot, asset.source);
  const targetPath = path.join(workspaceRoot, asset.target);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

console.log(`Runtime assets copied: ${assets.length}`);
