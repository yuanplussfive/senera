import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  AgentSandboxDistributionContractSchema,
  AgentSandboxRuntimeImageLabels,
  readAgentSandboxDistributionContract,
} from "../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";

const workspaceRoot = process.cwd();
const contract = readAgentSandboxDistributionContract();
const releaseWorkflow = fs.readFileSync(path.join(workspaceRoot, ".github", "workflows", "release.yml"), "utf8");
const sandboxDockerfile = fs.readFileSync(path.join(workspaceRoot, "Dockerfile.sandbox"), "utf8");
const compose = fs.readFileSync(path.join(workspaceRoot, "compose.yaml"), "utf8");
const requiredToolProbes = [
  "bash",
  "git",
  "node",
  "npm",
  "python",
  "pip",
  "rg",
  "jq",
  "curl",
  "ssh",
  "terminal-sidecar",
];

assert.equal(contract.formatVersion, 6);
assert.equal(
  AgentSandboxDistributionContractSchema.safeParse({ ...contract, undeclared: true }).success,
  false,
  "Sandbox distribution contracts must reject undeclared fields.",
);
for (const [architecture, target] of Object.entries(contract.targets)) {
  assert.match(target.sourceImage, /^[^\s@]+@sha256:[a-f0-9]{64}$/u, `${architecture} source image must be immutable.`);
  assert.ok(
    target.runtimeImage.includes(contract.version),
    `${architecture} local image must carry the distribution version.`,
  );
  assert.ok(target.runtimeImage.includes(architecture), `${architecture} local image must identify its target.`);
  assert.ok(
    target.registryImage.includes(`sandbox-runtime-${contract.version}`),
    `${architecture} registry image must carry the distribution version.`,
  );
  assert.deepEqual(
    target.probes.map((probe) => probe.id),
    requiredToolProbes,
    `${architecture} must declare every supported command-line tool probe in execution order.`,
  );
  assert.equal(new Set(target.probes.map((probe) => probe.id)).size, target.probes.length);
  for (const probe of target.probes) {
    assert.ok(probe.command.length > 0, `${architecture}/${probe.id} must declare a command.`);
  }
}

for (const fragment of [
  "ARG SENERA_SANDBOX_SOURCE_IMAGE",
  "ARG SENERA_SANDBOX_DISTRIBUTION_ID",
  "ARG SENERA_SANDBOX_DISTRIBUTION_VERSION",
  "ARG SENERA_SANDBOX_TARGET",
  ...Object.values(AgentSandboxRuntimeImageLabels),
  "COPY Packages/TerminalSidecar /opt/senera-terminal-sidecar",
  "npm install --prefix /opt/senera-terminal-sidecar",
]) {
  assert.ok(sandboxDockerfile.includes(fragment), `Docker sandbox runtime image contract is missing: ${fragment}`);
}
for (const fragment of [
  "sandbox-runtime-build:",
  "file: ./Dockerfile.sandbox",
  "SENERA_SANDBOX_SOURCE_IMAGE=${{ needs.metadata.outputs.sandbox_runtime_source_image }}",
  "SENERA_SANDBOX_DISTRIBUTION_ID=${{ needs.metadata.outputs.sandbox_runtime_distribution_id }}",
  "SENERA_SANDBOX_DISTRIBUTION_VERSION=${{ needs.metadata.outputs.sandbox_runtime_version_tag }}",
  "SENERA_SANDBOX_TARGET=${{ needs.metadata.outputs.sandbox_runtime_target }}",
  "type=raw,value=sandbox-runtime-sha-${{ needs.metadata.outputs.source_sha }}",
]) {
  assert.ok(releaseWorkflow.includes(fragment), `Docker sandbox runtime release is missing: ${fragment}`);
}
assert.ok(
  Object.values(contract.targets).some((target) => compose.includes(target.registryImage)),
  "Compose must pin a registry image declared by the sandbox distribution contract.",
);
console.log("Sandbox distribution contract verified.");
