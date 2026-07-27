import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  AgentSandboxRuntimeImageLabels,
  readAgentSandboxDistributionContract,
} from "../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";

const workspaceRoot = process.cwd();
const dockerfile = fs.readFileSync(path.join(workspaceRoot, "Dockerfile"), "utf8");
const sandboxDockerfile = fs.readFileSync(path.join(workspaceRoot, "Dockerfile.sandbox"), "utf8");
const dockerignore = fs.readFileSync(path.join(workspaceRoot, ".dockerignore"), "utf8");
const dockerEntrypoint = fs.readFileSync(path.join(workspaceRoot, "Apps", "DockerEntrypoint.sh"), "utf8");
const dockerServer = fs.readFileSync(path.join(workspaceRoot, "Apps", "DockerServer.ts"), "utf8");
const frontendIndex = fs.readFileSync(path.join(workspaceRoot, "Frontend", "index.html"), "utf8");
const frontendRuntimeConfig = fs.readFileSync(
  path.join(workspaceRoot, "Frontend", "public", "senera-runtime-config.js"),
  "utf8",
);
const gvisorWorker = fs.readFileSync(path.join(workspaceRoot, "Apps", "GvisorWorker.ts"), "utf8");
const dockerRuntime = fs.readFileSync(
  path.join(workspaceRoot, "Source", "AgentSystem", "Sandbox", "Gvisor", "AgentGvisorDockerRuntime.ts"),
  "utf8",
);
const workerProtocol = fs.readFileSync(
  path.join(workspaceRoot, "Source", "AgentSystem", "Sandbox", "Gvisor", "AgentGvisorWorkerProtocol.ts"),
  "utf8",
);
const readme = fs.readFileSync(path.join(workspaceRoot, "README.md"), "utf8");
const operations = fs.readFileSync(path.join(workspaceRoot, "docs", "Operations.md"), "utf8");
const compose = fs.readFileSync(path.join(workspaceRoot, "compose.yaml"), "utf8");
const releaseWorkflow = fs.readFileSync(path.join(workspaceRoot, ".github", "workflows", "release.yml"), "utf8");
const providerRegistry = fs.readFileSync(
  path.join(workspaceRoot, "Source", "AgentSystem", "Sandbox", "ProviderRegistry", "contract.json"),
  "utf8",
);
const dockerEnginePolicy = fs.readFileSync(
  path.join(workspaceRoot, "Source", "AgentSystem", "Sandbox", "DockerEngine", "contract.json"),
  "utf8",
);
const sandboxDistribution = readAgentSandboxDistributionContract();
const sandboxImageReference = `ghcr.io/yuanplussfive/senera:sandbox-runtime-${sandboxDistribution.archiveVersion}`;

assert.ok(
  !dockerfile.includes("sandbox.seed") && !dockerfile.includes("SandboxSeed"),
  "Dockerfile must not scan or copy platform-specific Microsandbox runtime files.",
);
for (const label of Object.values(AgentSandboxRuntimeImageLabels)) {
  assert.ok(sandboxDockerfile.includes(label), `Docker sandbox image must declare the identity label ${label}.`);
}
assert.ok(
  !dockerfile.includes("PrepareSandboxRuntime"),
  "Dockerfile must not start or download the microsandbox runtime while building the image.",
);
assert.match(
  dockerfile,
  /ARG NODE_IMAGE=[^\s]+@sha256:[a-f0-9]{64}/u,
  "Dockerfile must pin its Node base image to an immutable digest.",
);
for (const ignoredPath of [".cache", ".senera", ".uploads", "coverage", "Release/*", "node_modules"]) {
  assert.ok(
    dockerignore.split(/\r?\n/u).includes(ignoredPath),
    `.dockerignore must exclude local or generated directory ${ignoredPath}.`,
  );
}
assert.ok(
  !dockerignore.includes("!Release/SandboxImage"),
  ".dockerignore must not admit Microsandbox release assets into the Docker build context.",
);
assert.ok(
  dockerfile.includes("npm rebuild better-sqlite3 --build-from-source"),
  "Dockerfile must build the Node better-sqlite3 native addon after ignoring dependency scripts.",
);
assert.ok(
  dockerfile.includes("apt-get install -y --no-install-recommends python3 make g++") &&
    !dockerfile.includes("bubblewrap") &&
    !dockerfile.includes("socat") &&
    !/apt-get install[^\n]*\bripgrep\b/u.test(dockerfile),
  "Docker builder must install only the native compilation toolchain used by better-sqlite3.",
);
assert.ok(
  dockerfile.includes("node Dist/Scripts/VerifyDockerNativeSqlite.js"),
  "Dockerfile must run the native SQLite smoke test before producing the runtime image.",
);
assert.ok(
  !dockerfile.includes("Release/SandboxImage") && !dockerfile.includes("SandboxImage"),
  "Docker runtime must consume a registry-native sandbox image instead of embedding a Microsandbox Bundle.",
);
assert.ok(
  dockerfile.includes("/health/ready") && !dockerfile.includes("fetch('http://127.0.0.1:' + port + '/')"),
  "Docker healthcheck must use the explicit readiness endpoint instead of the public frontend route.",
);
assert.ok(
  dockerfile.includes("apt-get install -y --no-install-recommends ca-certificates util-linux"),
  "Docker runtime must provide the CA bundle and explicit setpriv implementation used by its bootstrap.",
);
assert.ok(
  dockerfile.includes("COPY --chmod=755 Apps/DockerEntrypoint.sh") &&
    dockerfile.includes('ENTRYPOINT ["senera-container-entrypoint"]') &&
    !dockerfile.includes("USER root") &&
    !dockerfile.includes("USER node"),
  "Docker must enter through the audited root bootstrap instead of running the application directly as root or node.",
);
assert.ok(
  dockerfile.includes("HEALTHCHECK") && dockerfile.includes("setpriv --reuid=node --regid=node --clear-groups -- node"),
  "Docker health checks must run with the unprivileged application identity.",
);
assert.ok(
  !dockerEntrypoint.includes("/dev/kvm") &&
    !dockerEntrypoint.includes("NET_ADMIN") &&
    dockerEntrypoint.includes("exec setpriv") &&
    dockerEntrypoint.includes("--clear-groups") &&
    dockerEntrypoint.includes('[ "$runtime_uid" != "0" ]') &&
    dockerEntrypoint.includes('[ "$runtime_gid" != "0" ]') &&
    !dockerEntrypoint.includes("sandbox_provider="),
  "Docker bootstrap must drop privileges without requiring a host KVM device.",
);
assert.ok(
  !/chmod\s+(?:0?666|a\+rw)\s+[^\n]*\/dev\/kvm/u.test(dockerEntrypoint),
  "Docker bootstrap must not make the KVM device world-writable.",
);
assert.ok(
  dockerServer.includes('BaseDir: "/data/.senera/sandbox-runtime"'),
  "Docker sandbox runtime must install under the mounted /data volume.",
);
assert.ok(
  dockerServer.includes("resolveDockerSandboxProvider") &&
    dockerServer.includes("Provider: sandboxProvider") &&
    dockerServer.includes("prepareAgentGvisorRuntime") &&
    dockerServer.includes("SENERA_GVISOR_WORKER_SOCKET") &&
    !dockerServer.includes("sandboxBundleRoot") &&
    dockerServer.includes('httpBaseUrl: ""') &&
    dockerServer.includes("complete compose.yaml deployment") &&
    dockerServer.includes("application container requires sandbox-worker"),
  "Docker deployment must negotiate and lock its Docker Engine provider before preparing the isolated Worker.",
);
const runtimeConfigEntry = '<script src="/senera-runtime-config.js"></script>';
const frontendMainEntry = '<script type="module" src="/src/main.tsx"></script>';
assert.ok(
  frontendIndex.indexOf(runtimeConfigEntry) >= 0 &&
    frontendIndex.indexOf(runtimeConfigEntry) < frontendIndex.indexOf(frontendMainEntry) &&
    !frontendRuntimeConfig.includes("export") &&
    !dockerServer.includes("export {};"),
  "Frontend runtime configuration must execute as a classic script before the application module.",
);
assert.deepEqual(
  JSON.parse(providerRegistry).candidates.map((candidate: { provider: string }) => candidate.provider),
  ["microsandbox", "gvisor", "docker-engine"],
  "The provider registry must keep the declared three-tier selection order.",
);
assert.deepEqual(
  JSON.parse(dockerEnginePolicy).container.dropCapabilities,
  ["ALL"],
  "Every Docker Engine provider must inherit the shared capability-drop policy.",
);
assert.ok(
  compose.includes("SENERA_ADMIN_LOGIN_NAME") &&
    compose.includes("SENERA_ADMIN_DISPLAY_NAME") &&
    compose.includes("SENERA_ADMIN_PASSWORD") &&
    compose.includes('SENERA_ADMIN_PASSWORD: "replace-with-a-strong-password"') &&
    !compose.includes("${SENERA_ADMIN_"),
  "compose.yaml must expose directly editable administrator values without external variable interpolation.",
);
assert.ok(
  compose.includes('SENERA_CONFIG_SECRET_KEY: "${SENERA_CONFIG_SECRET_KEY:-}"'),
  "compose.yaml must allow an optional host-managed configuration secret key.",
);
assert.ok(
  !compose.includes("senera-admin:") && compose.includes("sandbox-worker:") && compose.includes("sandbox-runtime:"),
  "compose.yaml must use dedicated sandbox runtime and Worker services rather than an administrator sidecar.",
);
assert.ok(
  !compose.includes("/dev/kvm:/dev/kvm") &&
    !compose.includes("NET_ADMIN") &&
    compose.includes("/var/run/docker.sock:/run/docker-engine.sock") &&
    compose.includes('SENERA_GVISOR_WORKER_SOCKET_MODE: "0666"') &&
    compose.includes("SENERA_DOCKER_SANDBOX_IMAGE: *senera-sandbox-image") &&
    compose.includes("${SENERA_IMAGE:-ghcr.io/yuanplussfive/senera:1.9.7}") &&
    compose.includes("${SENERA_SANDBOX_IMAGE:-") &&
    compose.includes("SENERA_RUNTIME_IMAGE_REFERENCE: *senera-image") &&
    !compose.includes("ghcr.io/yuanplussfive/senera:latest") &&
    compose.includes("condition: service_completed_successfully") &&
    compose.includes(sandboxImageReference) &&
    !compose.includes("SENERA_GVISOR_BUNDLE_ROOT") &&
    compose.includes("network_mode: none") &&
    compose.includes("read_only: true"),
  "compose.yaml must keep Docker Engine access inside the isolated, read-only Worker without host KVM requirements.",
);
assert.ok(
  compose.includes('- "8787:8787"') &&
    compose.includes("SENERA_ALLOW_INSECURE_HTTP") &&
    compose.includes("command: []") &&
    !compose.includes("container_name:") &&
    !compose.includes("127.0.0.1:8787:8787"),
  "compose.yaml must publish the service port, isolate deployment names, and make direct HTTP access explicit.",
);
assert.ok(
  dockerRuntime.includes("assertImageIdentity") &&
    dockerRuntime.includes("AgentSandboxRuntimeImageLabels") &&
    !dockerRuntime.includes("loadImage(") &&
    !dockerRuntime.includes(".pull("),
  "Docker sandbox runtime must validate the declared registry image without importing or pulling it.",
);
assert.ok(
  !/requestId:\s*NonEmptyString,\s*image:/u.test(workerProtocol) && !dockerRuntime.includes("request.image"),
  "Docker sandbox execution requests must not be able to select or override the deployment runtime image.",
);
assert.ok(
  !fs.existsSync(path.join(workspaceRoot, "compose.kvm.yaml")),
  "The retired compose.kvm.yaml overlay must not remain after Docker deployment convergence.",
);
assert.ok(
  dockerServer.includes("synchronizeDockerAdminAccount") &&
    dockerServer.includes("prepareDockerSandboxRuntime") &&
    dockerServer.includes("sandboxRuntimePrepared: true"),
  "Docker must synchronize its administrator and prepare the locked sandbox provider before starting the web server.",
);
assert.ok(
  gvisorWorker.includes("SENERA_DOCKER_SANDBOX_IMAGE") &&
    !gvisorWorker.includes("SENERA_GVISOR_BUNDLE_ROOT") &&
    !gvisorWorker.includes("bundleRoot"),
  "Docker Worker must require the registry-native runtime image and must not expose a Bundle import path.",
);
assertDockerStartupDocumented(readme, "README.md");
assertDockerStartupDocumented(operations, "docs/Operations.md");
assert.ok(
  releaseWorkflow.includes("node Dist/Scripts/VerifyDockerUserPluginWrite.js"),
  "Release container smoke must verify that the node user can write the persistent plugin root.",
);
assert.ok(
  releaseWorkflow.includes("node Dist/Scripts/VerifyDockerUserPluginWrite.js"),
  "Release smoke must retain the unprivileged application write verification.",
);

console.log("Docker runtime sandbox policy verified.");

function assertDockerStartupDocumented(document: string, label: string): void {
  const configure = document.indexOf("SENERA_ADMIN_LOGIN_NAME");
  const startup = document.indexOf("docker compose up -d --pull always");
  assert.ok(configure >= 0, `${label} must document Compose administrator bootstrap values.`);
  assert.ok(startup > configure, `${label} must document Docker startup after administrator configuration.`);
  assert.ok(
    !document.includes("senera-admin init") && !document.includes("compose.kvm.yaml"),
    `${label} must not document retired Docker initialization or deployment modes.`,
  );
}
