import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
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
// The single-service compose.yaml does not pin a sandbox image: the deployed
// default resolves at runtime from the distribution contract's registry image
// (AgentDefaultCatalog), so the released contract version is what actually runs.
// An operator may forward an override through the empty-default interpolation.
const composeRecord = parseYaml(compose) as {
  services?: { senera?: { environment?: Record<string, unknown> } };
};
const seneraEnvironment = composeRecord.services?.senera?.environment ?? {};
const sandboxImageOverride = seneraEnvironment.SENERA_DOCKER_SANDBOX_IMAGE;
assert.ok(
  sandboxImageOverride === undefined || String(sandboxImageOverride) === "${SENERA_DOCKER_SANDBOX_IMAGE:-}",
  "Compose must not actively pin a sandbox image; it may only forward an operator override that defaults to the contract version.",
);
const defaultsCatalog = fs.readFileSync(
  path.join(workspaceRoot, "Source", "AgentSystem", "Defaults", "AgentDefaultCatalog.ts"),
  "utf8",
);
assert.ok(
  defaultsCatalog.includes("resolveAgentSandboxDistributionTarget") &&
    defaultsCatalog.includes("readAgentSandboxDistributionContract()") &&
    defaultsCatalog.includes("registryImage"),
  "The deployed default sandbox image must resolve from the distribution contract's registry image.",
);
console.log("Sandbox distribution contract verified.");
