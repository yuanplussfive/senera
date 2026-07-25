import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  AgentSandboxDistributionContractSchema,
  readAgentSandboxDistributionContract,
  resolveAgentSandboxBundleLocation,
} from "../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";

const workspaceRoot = process.cwd();
const contract = readAgentSandboxDistributionContract();
const rootPackage = readJson(path.join(workspaceRoot, "package.json"));
const lockfile = readJson(path.join(workspaceRoot, "package-lock.json"));
const releaseWorkflow = fs.readFileSync(path.join(workspaceRoot, ".github", "workflows", "release.yml"), "utf8");
const bundleAction = fs.readFileSync(
  path.join(workspaceRoot, ".github", "actions", "build-sandbox-bundle", "action.yml"),
  "utf8",
);

assert.equal(readDependencyVersion(rootPackage, "microsandbox"), contract.microsandboxVersion);
assert.equal(readLockfileRootDependencyVersion(lockfile, "microsandbox"), contract.microsandboxVersion);
assert.equal(readLockfilePackageVersion(lockfile, "node_modules/microsandbox"), contract.microsandboxVersion);

for (const [architecture, target] of Object.entries(contract.targets)) {
  assert.match(target.sourceImage, /^[^\s@]+@sha256:[a-f0-9]{64}$/u, `${architecture} image must be immutable.`);
  assert.ok(target.runtimeImage.includes(contract.archiveVersion), `${architecture} runtime image must be versioned.`);
  assert.match(target.configDigest, /^sha256:[a-f0-9]{64}$/u, `${architecture} config digest must be immutable.`);
  assert.ok(target.runtimeImage.includes(architecture), `${architecture} runtime image must identify its target.`);
  assert.ok(target.probe.command.length > 0, `${architecture} runtime probe must declare a command.`);
  assert.equal(target.archive.format, "oci");
  assert.equal(target.archive.mediaType, "application/vnd.oci.image.layout.v1.tar");
  assert.equal(target.archive.compression, "gzip");
  assert.equal(target.archive.compressedMediaType, "application/gzip");
  assert.ok(target.archive.assetName.endsWith(".oci.tar.gz"));
  assert.equal(path.basename(target.archive.assetName), target.archive.assetName);
  const location = resolveAgentSandboxBundleLocation(contract, architecture);
  assert.equal(location.archiveFileName, target.archive.assetName);
  assert.equal(location.manifestFileName, contract.bundle.manifestFileName);
}

assert.equal(
  AgentSandboxDistributionContractSchema.safeParse({ ...contract, undeclared: true }).success,
  false,
  "Sandbox distribution contracts must reject undeclared fields.",
);
for (const invalidDevicePath of ["dev/kvm", "/", "/dev//kvm", "/dev/../kvm", "/dev/kvm\0suffix"]) {
  const invalidContract = {
    ...contract,
    hostRequirements: {
      ...contract.hostRequirements,
      microsandbox: {
        ...contract.hostRequirements.microsandbox,
        linux: {
          ...contract.hostRequirements.microsandbox.linux,
          devices: [{ path: invalidDevicePath, access: ["read", "write"] }],
        },
      },
    },
  };
  assert.equal(
    AgentSandboxDistributionContractSchema.safeParse(invalidContract).success,
    false,
    `Sandbox distribution contract accepted invalid device path: ${JSON.stringify(invalidDevicePath)}`,
  );
}
for (const fragment of [
  "sandbox-archive:",
  "./.github/actions/build-sandbox-bundle",
  "sandbox_archive_artifact_name",
  "sandbox_archive_manifest_artifact_name",
  "actions/download-artifact",
  "needs.sandbox-archive.result == 'success'",
]) {
  assert.ok(
    releaseWorkflow.includes(fragment),
    `Product release workflow is missing sandbox distribution step: ${fragment}`,
  );
}
for (const fragment of ["test -c /dev/kvm", "npm run build", "node Dist/Build/BuildSandboxImageArchive.js"]) {
  assert.ok(bundleAction.includes(fragment), `Sandbox Bundle build action is missing: ${fragment}`);
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
