import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { moduleDirPath, toRuntimeModulePath } from "../Source/AgentSystem/Core/AgentPath.js";

const runtimeAppRoot = path.resolve(moduleDirPath(import.meta.url), "..", "..");
const desktopRuntimeSchemaPath = path.join(
  os.homedir(),
  "AppData",
  "Roaming",
  "Senera",
  "runtime",
  "System",
  "Plugins",
  "AgentShellToolPlugin",
  "ToolSignature.ts",
);
const expectedModulePath = path.join(
  runtimeAppRoot,
  "Dist",
  "System",
  "Plugins",
  "AgentShellToolPlugin",
  "ToolSignature.js",
);

assert.equal(toRuntimeModulePath(desktopRuntimeSchemaPath), expectedModulePath);
assert.equal(fs.existsSync(expectedModulePath), true);

console.log("Runtime module path verification passed.");
