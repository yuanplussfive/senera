import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  AgentSandboxRuntimeImageLabels,
  readAgentSandboxDistributionContract,
} from "../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";

const workspaceRoot = process.cwd();
const read = (relativePath: string): string => fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8");
const dockerfile = read("Dockerfile");
const sandboxDockerfile = read("Dockerfile.sandbox");
const aptPackages = read("Build/SandboxRuntimeAptPackages.txt").split(/\r?\n/u).filter(Boolean);
const dockerignore = read(".dockerignore");
const dockerEntrypoint = read("Apps/DockerEntrypoint.sh");
const dockerServer = read("Apps/DockerServer.ts");
const sandboxWorker = read("Apps/SandboxWorker.ts");
const dockerRuntime = read("Source/AgentSystem/Sandbox/DockerEngine/AgentDockerEngineRuntime.ts");
const workerProtocol = read("Source/AgentSystem/Sandbox/Worker/AgentSandboxWorkerProtocol.ts");
const readme = read("README.md");
const operations = read("docs/Operations.md");
const releaseWorkflow = read(".github/workflows/release.yml");
const providerRegistry = readRecord(parseYaml(read("Source/AgentSystem/Sandbox/ProviderRegistry/contract.json")));
const dockerEnginePolicy = readRecord(parseYaml(read("Source/AgentSystem/Sandbox/DockerEngine/contract.json")));
const compose = readRecord(parseYaml(read("compose.yaml"), { merge: true }));
const distribution = readAgentSandboxDistributionContract();

assert.match(
  dockerfile,
  /ARG NODE_IMAGE=[^\s]+@sha256:[a-f0-9]{64}/u,
  "Application Dockerfile must pin its Node base image by digest.",
);
for (const ignoredPath of [".cache", ".senera", ".uploads", "coverage", "Release/*", "node_modules"]) {
  assert.ok(dockerignore.split(/\r?\n/u).includes(ignoredPath), `.dockerignore must exclude ${ignoredPath}.`);
}
assert.ok(
  dockerfile.includes("npm rebuild better-sqlite3 --build-from-source") &&
    dockerfile.includes("node Dist/Scripts/VerifyDockerNativeSqlite.js"),
  "Application image must rebuild and verify its native SQLite addon.",
);
assert.ok(
  dockerfile.includes("RUN install -d -o node -g node /data") && !dockerfile.includes("chown -R node:node /data"),
  "Application image must create its data root before declaring the volume.",
);
assert.ok(
  dockerfile.includes('ENTRYPOINT ["senera-container-entrypoint"]') &&
    dockerEntrypoint.includes("exec setpriv") &&
    dockerEntrypoint.includes("--clear-groups"),
  "Application startup must cross the audited privilege-drop boundary.",
);

for (const label of Object.values(AgentSandboxRuntimeImageLabels)) {
  assert.ok(sandboxDockerfile.includes(label), `Sandbox image must declare identity label ${label}.`);
}
for (const buildArgument of [
  "SENERA_SANDBOX_SOURCE_IMAGE",
  "SENERA_SANDBOX_DISTRIBUTION_ID",
  "SENERA_SANDBOX_DISTRIBUTION_VERSION",
  "SENERA_SANDBOX_TARGET",
]) {
  assert.ok(sandboxDockerfile.includes(`ARG ${buildArgument}`), `Sandbox image is missing ${buildArgument}.`);
}
for (const packageName of ["bash", "git", "jq", "openssh-client", "python3", "python3-pip", "ripgrep", "curl"]) {
  assert.ok(aptPackages.includes(packageName), `Sandbox toolchain package list is missing ${packageName}.`);
}

const candidates = readArray(providerRegistry.candidates).map((candidate) => readRecord(candidate).provider);
assert.deepEqual(candidates, ["gvisor", "docker-engine"]);
const containerPolicy = readRecord(dockerEnginePolicy.container);
assert.equal(containerPolicy.readOnlyRootFilesystem, true);
assert.deepEqual(containerPolicy.dropCapabilities, ["ALL"]);
assert.ok(readArray(containerPolicy.securityOptions).includes("no-new-privileges:true"));

assert.ok(
  dockerRuntime.includes("assertImageIdentity") &&
    dockerRuntime.includes("AgentSandboxRuntimeImageLabels") &&
    dockerRuntime.includes("pullPolicy") &&
    dockerRuntime.includes("runToolchainProbes"),
  "Docker runtime must verify image identity, honor pull policy, and probe the declared toolchain.",
);
assert.ok(
  dockerRuntime.includes('GIT_CONFIG_KEY_0: "safe.directory"') &&
    dockerRuntime.includes("contract.guest.workspaceRoot"),
  "Docker container creation must trust only the contract workspace for Git safe.directory.",
);
assert.ok(
  !/requestId:\s*NonEmptyString,\s*image:/u.test(workerProtocol) && !dockerRuntime.includes("request.image"),
  "Execution requests must not choose the deployment runtime image.",
);
assert.ok(
  sandboxWorker.includes("resolveAgentDockerEngineSandboxProvider") &&
    sandboxWorker.includes("SENERA_DOCKER_SANDBOX_IMAGE") &&
    sandboxWorker.includes("SENERA_DOCKER_SANDBOX_PULL_POLICY"),
  "Worker must resolve one Engine provider and own image preparation.",
);
assert.ok(
  dockerServer.includes("resolveDockerSandboxProvider") &&
    dockerServer.includes("prepareAgentDockerEngineRuntime") &&
    dockerServer.includes("sandboxRuntimePrepared: true") &&
    dockerServer.includes("SENERA_SANDBOX_WORKER_ENDPOINT"),
  "Container server must negotiate and prepare the isolated Worker before serving requests.",
);

const services = readRecord(compose.services);
const application = readRecord(services.senera);
const worker = readRecord(services["sandbox-worker"]);
const runtimeImage = readRecord(services["sandbox-runtime"]);
assert.ok(readArray(application.volumes).every((mount) => !String(mount).includes("docker.sock")));
assert.ok(readArray(worker.volumes).some((mount) => String(mount).includes("docker.sock:/run/docker-engine.sock")));
assert.equal(worker.network_mode, "none");
assert.equal(worker.read_only, true);
assert.deepEqual(worker.cap_drop, ["ALL"]);
assert.ok(readArray(worker.security_opt).includes("no-new-privileges:true"));
assert.equal(runtimeImage.network_mode, "none");
assert.equal(runtimeImage.read_only, true);
const workerEnvironment = readRecord(worker.environment);
assert.equal(workerEnvironment.SENERA_DOCKER_SANDBOX_PROVIDER, "auto");
assert.equal(workerEnvironment.SENERA_DOCKER_SANDBOX_PULL_POLICY, "never");
assert.ok(String(workerEnvironment.SENERA_DOCKER_SANDBOX_IMAGE).includes(`sandbox-runtime-${distribution.version}`));

assert.ok(
  releaseWorkflow.includes("sandbox-runtime-build:") &&
    releaseWorkflow.includes("file: ./Dockerfile.sandbox") &&
    releaseWorkflow.includes("setup-gvisor"),
  "Release verification must build the runtime image and exercise its optional gVisor path.",
);
assert.equal(fs.existsSync(path.join(workspaceRoot, "compose.kvm.yaml")), false);
assertDockerStartupDocumented(readme, "README.md");
assertDockerStartupDocumented(operations, "docs/Operations.md");

console.log("Docker runtime sandbox policy verified.");

function assertDockerStartupDocumented(document: string, label: string): void {
  const configure = document.indexOf("SENERA_ADMIN_LOGIN_NAME");
  const startup = document.indexOf("docker compose up -d --pull always");
  assert.ok(configure >= 0, `${label} must document Compose administrator bootstrap values.`);
  assert.ok(startup > configure, `${label} must document startup after administrator configuration.`);
  assert.ok(!document.includes("compose.kvm.yaml"), `${label} must not document retired deployment overlays.`);
}

function readRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function readArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}
