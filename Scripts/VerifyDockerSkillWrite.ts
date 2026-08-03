import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveAgentWorkspaceLayout } from "../Source/AgentSystem/Core/AgentWorkspaceLayout.js";

const workspaceRoot = path.resolve(process.env.SENERA_WORKSPACE_ROOT?.trim() || "/data");
const skillRoot = resolveAgentWorkspaceLayout(workspaceRoot).skillRoot;
const probeDirectory = path.join(skillRoot, `.senera-write-probe-${process.pid}`);
const probePath = path.join(probeDirectory, "SKILL.md");
const probeSource = [
  "---",
  "name: senera-write-probe",
  "description: Verify that the runtime user can write workspace Skills.",
  "---",
  "",
  "# Write probe",
  "",
].join("\n");

try {
  fs.mkdirSync(probeDirectory, { recursive: true });
  fs.writeFileSync(probePath, probeSource, "utf8");
  assert.equal(fs.readFileSync(probePath, "utf8"), probeSource);
  console.log("Docker workspace Skill write verification passed.");
} finally {
  fs.rmSync(probeDirectory, { recursive: true, force: true });
}
