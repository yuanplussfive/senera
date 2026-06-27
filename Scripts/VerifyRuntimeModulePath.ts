import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { toRuntimeModulePath } from "../Source/AgentSystem/AgentPath.js";
import { AgentSchemaValidator } from "../Source/AgentSystem/AgentSchemaValidator.js";

const workspaceRoot = process.cwd();
const desktopRuntimeSchemaPath = path.join(
  os.homedir(),
  "AppData",
  "Roaming",
  "Senera",
  "runtime",
  "System",
  "Plugins",
  "AgentDecisionPlugin",
  "Schemas",
  "ToolCallsDecisionSchema.ts",
);
const expectedModulePath = path.join(
  workspaceRoot,
  "Dist",
  "System",
  "Plugins",
  "AgentDecisionPlugin",
  "Schemas",
  "ToolCallsDecisionSchema.js",
);

assert.equal(toRuntimeModulePath(desktopRuntimeSchemaPath), expectedModulePath);

void main();

async function main(): Promise<void> {
  await new AgentSchemaValidator().validate(desktopRuntimeSchemaPath, {
    tool_call: [{
      name: "ToolSearchTool",
      arguments: {
        query: "runtime module path",
      },
    }],
  });

  console.log("Runtime module path verification passed.");
}
