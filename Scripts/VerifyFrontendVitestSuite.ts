import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { FrontendTestCoveragePolicy } from "./TestCoveragePolicy.js";

const workspaceRoot = resolveWorkspaceRoot();
const vitestBin = path.join(workspaceRoot, "node_modules", "vitest", "vitest.mjs");

await new Promise<void>((resolve, reject) => {
  const child = spawn(process.execPath, [
    vitestBin,
    "run",
    "--config",
    path.join(workspaceRoot, FrontendTestCoveragePolicy.vitestConfig),
  ], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
  child.on("error", reject);
  child.on("close", (code, signal) => {
    assert.equal(signal, null, `Frontend Vitest suite exited with signal ${signal}.`);
    assert.equal(code, 0, `Frontend Vitest suite failed with code ${code}.`);
    resolve();
  });
});

console.log("Frontend Vitest suite verified.");

function resolveWorkspaceRoot(): string {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, "Frontend", "src"))) {
    return cwd;
  }
  const parent = path.resolve(cwd, "..");
  if (existsSync(path.join(parent, "Frontend", "src"))) {
    return parent;
  }
  return cwd;
}
