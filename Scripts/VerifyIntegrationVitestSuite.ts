import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { IntegrationTestPolicy } from "./TestCoveragePolicy.js";
import { resolveWorkspaceRoot } from "./WorkspaceRoot.js";

const workspaceRoot = resolveWorkspaceRoot();
const vitestBin = path.join(workspaceRoot, "node_modules", "vitest", "vitest.mjs");
const result = spawnSync(
  process.execPath,
  [vitestBin, "run", "--config", path.join(workspaceRoot, IntegrationTestPolicy.vitestConfig)],
  {
    cwd: workspaceRoot,
    encoding: "utf8",
    windowsHide: true,
  },
);

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);

assert.equal(result.status, 0, "Integration Vitest suite failed.");
assert.match(stripAnsi(result.stdout), /Tests\s+\d+\s+passed/, "Vitest did not execute the integration tests.");
console.log("Integration Vitest suite verified.");

function stripAnsi(value: string): string {
  const escape = String.fromCharCode(27);
  return value.replace(new RegExp(`${escape}\\[[0-9;]*m`, "g"), "");
}
