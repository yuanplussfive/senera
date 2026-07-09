import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";

const workspaceRoot = process.cwd();
const policyDir = path.join(workspaceRoot, "Source", "AgentSystem", "Safety");
const regoPath = path.join(policyDir, "AgentToolApprovalPolicy.rego");
const dataPath = path.join(policyDir, "AgentToolApprovalPolicy.data.json");
const wasmPath = path.join(policyDir, "AgentToolApprovalPolicy.wasm");
const entrypoint = "senera/tool/decision";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "senera-opa-policy-"));
const bundlePath = path.join(tempDir, "policy.tar.gz");
const wrappedDataPath = path.join(tempDir, "data.json");

try {
  fs.writeFileSync(
    wrappedDataPath,
    JSON.stringify({
      senera: {
        tool_approval: JSON.parse(fs.readFileSync(dataPath, "utf8")) as unknown,
      },
    }),
  );

  const result = spawnSync("opa", [
    "build",
    "-t",
    "wasm",
    "-e",
    entrypoint,
    "-o",
    bundlePath,
    regoPath,
    wrappedDataPath,
  ], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error([
      `opa build failed with exit code ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"));
  }

  fs.writeFileSync(wasmPath, extractTarGzEntry(bundlePath, "policy.wasm"));
  process.stdout.write(`OPA policy compiled: ${path.relative(workspaceRoot, wasmPath)}\n`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function extractTarGzEntry(bundlePath: string, entryName: string): Buffer {
  const tar = zlib.gunzipSync(fs.readFileSync(bundlePath));
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const name = readTarString(tar, offset, 100);
    if (!name) {
      break;
    }

    const size = Number.parseInt(readTarString(tar, offset + 124, 12).trim() || "0", 8);
    const contentOffset = offset + 512;
    if (name === entryName || name.endsWith(`/${entryName}`)) {
      return tar.subarray(contentOffset, contentOffset + size);
    }

    offset = contentOffset + Math.ceil(size / 512) * 512;
  }

  throw new Error(`OPA bundle does not contain ${entryName}.`);
}

function readTarString(buffer: Buffer, offset: number, length: number): string {
  return buffer
    .subarray(offset, offset + length)
    .toString("utf8")
    .replace(/\0.*$/u, "");
}
