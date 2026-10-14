import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveAgentBrowserController } from "../Source/AgentSystem/Browser/AgentBrowserControllerResolver.js";

const controller = resolveAgentBrowserController();
assert.ok(fs.existsSync(controller), `agent-browser controller is missing: ${controller}`);
const controllerStats = fs.statSync(controller);
assert.ok(controllerStats.size > 1_000_000, `agent-browser controller is unexpectedly small: ${controller}`);
if (process.platform !== "win32") {
  assert.ok((controllerStats.mode & 0o111) !== 0, `agent-browser controller is not executable: ${controller}`);
}
process.stdout.write(`agent-browser controller verified: ${controller}\n`);
