import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const workspaceRoot = resolveWorkspaceRoot();
const vitestBin = path.join(workspaceRoot, "node_modules", "vitest", "vitest.mjs");
let output = "";

await new Promise<void>((resolve, reject) => {
  const child = spawn(process.execPath, [
    vitestBin,
    "run",
    "--config",
    path.join(workspaceRoot, "vitest.config.ts"),
  ], {
    cwd: workspaceRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout?.on("data", (chunk) => {
    const text = String(chunk);
    output += text;
    process.stdout.write(text);
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    output += text;
    process.stderr.write(text);
  });
  child.on("error", reject);
  child.on("close", (code, signal) => {
    assert.equal(signal, null, `Frontend state flow tests exited with signal ${signal}.`);
    assert.equal(code, 0, `Frontend state flow tests failed with code ${code}.`);
    resolve();
  });
});

assert.match(output, /Tests\s+[1-9]\d*\s+passed/, "Vitest did not execute any frontend tests.");
console.log("Frontend Vitest state flow tests verified.");

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
