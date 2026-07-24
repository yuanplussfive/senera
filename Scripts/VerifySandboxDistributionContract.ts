import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  AgentSandboxDistributionContractSchema,
  readAgentSandboxDistributionContract,
  resolveAgentSandboxReleaseLocation,
} from "../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";

const workspaceRoot = process.cwd();
const contract = readAgentSandboxDistributionContract();
const rootPackage = readJson(path.join(workspaceRoot, "package.json"));
const lockfile = readJson(path.join(workspaceRoot, "package-lock.json"));
const releaseWorkflow = fs.readFileSync(path.join(workspaceRoot, ".github", "workflows", "release.yml"), "utf8");

assert.equal(readDependencyVersion(rootPackage, "microsandbox"), contract.microsandboxVersion);
assert.equal(readLockfileRootDependencyVersion(lockfile, "microsandbox"), contract.microsandboxVersion);
assert.equal(readLockfilePackageVersion(lockfile, "node_modules/microsandbox"), contract.microsandboxVersion);

for (const [architecture, target] of Object.entries(contract.targets)) {
  assert.match(target.sourceImage, /^[^\s@]+@sha256:[a-f0-9]{64}$/u, `${architecture} image must be immutable.`);
  assert.equal(path.basename(target.bundleAssetName), target.bundleAssetName);
  const location = resolveAgentSandboxReleaseLocation(contract, "1.2.3", architecture);
  assert.equal(location.releaseTag, "v1.2.3");
  assert.ok(location.bundleUrl.endsWith(`/${encodeURIComponent(target.bundleAssetName)}`));
}

assert.equal(
  AgentSandboxDistributionContractSchema.safeParse({ ...contract, undeclared: true }).success,
  false,
  "Sandbox distribution contracts must reject undeclared fields.",
);
for (const fragment of [
  "sandbox-bundle:",
  "node Dist/Build/BuildSandboxBundle.js",
  "sandbox_bundle_artifact_name",
  "sandbox_bundle_manifest_artifact_name",
  "gh release upload",
  "needs.sandbox-bundle.result == 'success'",
]) {
  assert.ok(
    releaseWorkflow.includes(fragment),
    `Product release workflow is missing sandbox distribution step: ${fragment}`,
  );
}

console.log("Sandbox distribution contract verified.");

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
}

function readDependencyVersion(value: unknown, dependency: string): unknown {
  return readRecord(readRecord(value).dependencies)[dependency];
}

function readLockfileRootDependencyVersion(value: unknown, dependency: string): unknown {
  const packages = readRecord(readRecord(value).packages);
  const rootPackage = readRecord(packages[""]);
  return readRecord(rootPackage.dependencies)[dependency];
}

function readLockfilePackageVersion(value: unknown, packagePath: string): unknown {
  return readRecord(readRecord(readRecord(value).packages)[packagePath]).version;
}

function readRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
