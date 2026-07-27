import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AgentToolContractBundleLoader } from "../Source/AgentSystem/ToolContracts/AgentToolContractBundleLoader.js";
import { walkFiles } from "./Support/FileWalk.js";

const pluginRoot = path.join(process.cwd(), "System", "Plugins", "AgentShellToolPlugin");
const contractPath = path.join(pluginRoot, "ToolContracts.json");
const bundle = new AgentToolContractBundleLoader().load(pluginRoot, "./ToolContracts.json");

assert.equal(fs.existsSync(contractPath), true);
assert.ok(bundle.tools.ShellCommandTool);
assert.deepEqual(findRuntimeToolchainImports(path.join(process.cwd(), "Dist", "Source")), []);

console.log("Runtime tool contract path verification passed.");

function findRuntimeToolchainImports(runtimeRoot: string): string[] {
  assert.equal(fs.existsSync(runtimeRoot), true, `Compiled runtime output is missing: ${runtimeRoot}`);
  const forbiddenSpecifiers = ["typescript", "ts-json-schema-generator"];
  return walkFiles(runtimeRoot, { extensions: [".js"] }).flatMap((filePath) => {
    const source = fs.readFileSync(filePath, "utf8");
    return forbiddenSpecifiers
      .filter((specifier) => source.includes(`from "${specifier}`) || source.includes(`require("${specifier}`))
      .map((specifier) => `${path.relative(runtimeRoot, filePath)} imports ${specifier}`);
  });
}
