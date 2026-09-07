import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { AgentSandboxRuntimeImageLabels } from "../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";

const workspaceRoot = process.cwd();
const read = (relativePath: string): string => fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8");
const dockerfile = read("Dockerfile");
const sandboxDockerfile = read("Dockerfile.sandbox");
const aptPackages = read("Build/SandboxRuntimeAptPackages.txt").split(/\r?\n/u).filter(Boolean);
const dockerignore = read(".dockerignore");
const composeSource = read("compose.yaml");
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
const browserDriver = read("Source/AgentSystem/Browser/AgentPlaywrightBrowserDriver.ts");

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
assert.ok(
  dockerEntrypoint.includes("SENERA_CONTAINER_RUNTIME_USER:-") &&
    dockerEntrypoint.includes('= "root"') &&
    dockerEntrypoint.includes('exec "$@"'),
  "The container entrypoint must gate the single-service root path behind an explicit environment variable.",
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
  dockerRuntime.includes('GIT_CONFIG_KEY_0: "safe.directory"') && dockerRuntime.includes("this.workspace.guestRoot"),
  "Docker container creation must trust only the resolved workspace guest root for Git safe.directory.",
);
for (const [label, source] of [
  ["Docker server", dockerServer],
  ["Sandbox Worker", sandboxWorker],
  ["Docker runtime", dockerRuntime],
] as const) {
  assert.ok(!/['"`]\/workspace['"`]/u.test(source), `${label} must not hardcode the guest workspace root.`);
}
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
assert.ok(
  dockerServer.includes("startSeneraSandboxWorkerProcess") &&
    dockerServer.includes("SENERA_SANDBOX_WORKER_ENDPOINT?.trim()"),
  "The single-service container server must embed the Sandbox Worker unless an external endpoint is supplied.",
);
assert.ok(
  dockerServer.includes("automaticLoopbackHttp: true") &&
    dockerServer.includes("SENERA_ALLOW_INSECURE_HTTP is deprecated") &&
    dockerServer.includes("same-origin browser access is automatic"),
  "The container server must derive local HTTP and same-origin access automatically while keeping legacy overrides explicit.",
);
assert.ok(
  !/SENERA_(?:ALLOW_INSECURE_HTTP|ALLOWED_ORIGINS):/u.test(composeSource),
  "compose.yaml must not require deprecated HTTP or Origin environment variables.",
);

// compose.yaml is the single-service deployment: one container runs Senera and
// the embedded Sandbox Worker. It must run as root and bind the Docker Engine
// socket directly so the Worker can reach the daemon, and must declare that
// choice loudly instead of hiding it behind an overlay file.
const services = readRecord(compose.services);
assert.deepEqual(Object.keys(services), ["senera"], "compose.yaml must declare exactly the single senera service.");
const application = readRecord(services.senera);
const environment = readRecord(application.environment);
assert.equal(
  environment.SENERA_CONTAINER_RUNTIME_USER,
  "root",
  "compose.yaml must explicitly opt into the root runtime user for the embedded Sandbox Worker.",
);
assert.ok(
  readArray(application.volumes).some((mount) => String(mount).includes("docker.sock")),
  "compose.yaml must bind the Docker Engine socket for the embedded Sandbox Worker.",
);
assert.ok(
  !readArray(application.volumes).some((mount) => String(mount).includes("worker.sock")),
  "compose.yaml must not require a sandbox control socket volume; the Worker is embedded.",
);
assert.ok(
  !("sandbox-worker" in services) && !("sandbox-runtime" in services),
  "compose.yaml must not declare retired sandbox-runtime or sandbox-worker services.",
);
assert.match(
  composeSource,
  /image:\s*\$\{SENERA_IMAGE:-ghcr\.io\/yuanplussfive\/senera:latest\}/u,
  "Compose must use the verified application latest tag unless an operator supplies an immutable override.",
);
const volumes = readRecord(compose.volumes);
assert.equal(
  String(readRecord(volumes["senera-data"]).name),
  "senera-data",
  "Compose must pin the senera-data volume name so the embedded Worker mounts the same workspace volume.",
);
assert.ok(
  browserDriver.includes('SENERA_CONTAINER === "1"') &&
    browserDriver.includes('"--no-sandbox"') &&
    browserDriver.includes("isContainerRoot"),
  "The browser driver must only weaken Chromium's sandbox for the container root path.",
);

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
  assert.ok(
    document.includes("SENERA_CONTAINER_RUNTIME_USER") && document.includes("root"),
    `${label} must document the single-service compose.yaml and its root runtime boundary.`,
  );
}

function readRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function readArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}
