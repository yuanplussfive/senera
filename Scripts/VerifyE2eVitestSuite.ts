import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { E2eTestPolicy } from "./TestCoveragePolicy.js";

const result = spawnSync("npx", ["vitest", "run", "--config", E2eTestPolicy.vitestConfig], {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: process.platform === "win32",
});

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);

assert.equal(result.status, 0, "E2E Vitest suite failed.");
assert.match(stripAnsi(result.stdout), /Tests\s+2\s+passed/, "Vitest did not execute the E2E tests.");
console.log("E2E Vitest suite verified.");

function stripAnsi(value: string): string {
  const escape = String.fromCharCode(27);
  return value.replace(new RegExp(`${escape}\\[[0-9;]*m`, "g"), "");
}
