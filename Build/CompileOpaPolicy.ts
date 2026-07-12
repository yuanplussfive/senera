import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import {
  AgentToolApprovalPolicyArtifactContract,
  createAgentToolApprovalPolicyArtifactManifest,
  readAgentToolApprovalPolicyArtifact,
  readAgentToolApprovalPolicyData,
  resolveAgentToolApprovalPolicyArtifactDirectory,
  writeAgentToolApprovalPolicyArtifactManifest,
} from "../Source/AgentSystem/Safety/AgentToolApprovalPolicyArtifact.js";
import { readOpaToolchain, resolveOpaCompilerBinary } from "./OpaToolchain.js";

const workspaceRoot = process.cwd();
const toolchain = readOpaToolchain(workspaceRoot);
const policyDir = resolveAgentToolApprovalPolicyArtifactDirectory(path.join(workspaceRoot, "Source"));
const { files, entrypoints } = AgentToolApprovalPolicyArtifactContract;
const policyPaths = files.policies.map((file) => path.join(policyDir, file));
const dataPath = path.join(policyDir, files.data);
const wasmPath = path.join(policyDir, files.wasm);
const opaCommand = await resolveOpaCompilerBinary(workspaceRoot, toolchain);
const verifyOnly = readMode(process.argv.slice(2));

const tempDir = fs.mkdtempSync(path.join(workspaceRoot, ".senera-opa-policy-"));
const bundlePath = path.join(tempDir, "policy.tar.gz");
const wrappedDataPath = path.join(tempDir, "data.json");

try {
  const policyData = readAgentToolApprovalPolicyData(policyDir);
  fs.writeFileSync(
    wrappedDataPath,
    JSON.stringify({
      senera: {
        tool_approval: policyData,
      },
    }),
  );

  const result = spawnSync(
    opaCommand,
    [
      "build",
      "-t",
      "wasm",
      ...Object.values(entrypoints).flatMap((entrypoint) => ["-e", entrypoint]),
      "-o",
      toOpaCliPath(bundlePath),
      ...policyPaths.map(toOpaCliPath),
      toOpaCliPath(wrappedDataPath),
    ],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [`opa build failed with exit code ${result.status}`, result.stdout, result.stderr].filter(Boolean).join("\n"),
    );
  }

  const wasm = extractTarGzEntry(bundlePath, "policy.wasm");
  const compilerVersion = readOpaVersion();
  if (compilerVersion !== toolchain.Version) {
    throw new Error(`OPA compiler version mismatch: expected ${toolchain.Version}, got ${compilerVersion}.`);
  }
  const manifest = createAgentToolApprovalPolicyArtifactManifest({
    compilerVersion,
    policies: policyPaths.map((policyPath, index) => ({
      file: files.policies[index],
      content: fs.readFileSync(policyPath),
    })),
    data: fs.readFileSync(dataPath),
    wasm,
  });

  if (verifyOnly) {
    const committed = readAgentToolApprovalPolicyArtifact(policyDir);
    if (!committed.wasm.equals(wasm)) {
      throw new Error("OPA policy WASM is stale. Run npm run compileopapolicy with the pinned compiler.");
    }
    if (JSON.stringify(committed.manifest) !== JSON.stringify(manifest)) {
      throw new Error("OPA policy artifact manifest is stale. Run npm run compileopapolicy.");
    }
    process.stdout.write(
      `OPA policy artifact verified (${Object.values(entrypoints).join(", ")}, OPA ${compilerVersion}).\n`,
    );
  } else {
    fs.writeFileSync(wasmPath, wasm);
    writeAgentToolApprovalPolicyArtifactManifest(policyDir, manifest);
    process.stdout.write(
      `OPA policy compiled: ${path.relative(workspaceRoot, wasmPath)} (${Object.values(entrypoints).join(", ")})\n`,
    );
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function readMode(arguments_: readonly string[]): boolean {
  const supportedArguments = new Set(["--check"]);
  const unsupported = arguments_.filter((argument) => !supportedArguments.has(argument));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported OPA policy compiler arguments: ${unsupported.join(", ")}`);
  }
  return arguments_.includes("--check");
}

function readOpaVersion(): string {
  const result = spawnSync(opaCommand, ["version"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`opa version failed with exit code ${result.status}: ${result.stderr}`);
  }

  const version = /^Version:\s*(\S+)$/imu.exec(result.stdout)?.[1];
  if (!version) {
    throw new Error("opa version did not return a compiler version.");
  }
  return version;
}

function toOpaCliPath(filePath: string): string {
  return path.relative(workspaceRoot, filePath).replaceAll(path.sep, "/");
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
