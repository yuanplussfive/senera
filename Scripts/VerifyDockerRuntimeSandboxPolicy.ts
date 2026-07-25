import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const dockerfile = fs.readFileSync(path.join(workspaceRoot, "Dockerfile"), "utf8");
const dockerignore = fs.readFileSync(path.join(workspaceRoot, ".dockerignore"), "utf8");
const dockerEntrypoint = fs.readFileSync(path.join(workspaceRoot, "Apps", "DockerEntrypoint.sh"), "utf8");
const dockerServer = fs.readFileSync(path.join(workspaceRoot, "Apps", "DockerServer.ts"), "utf8");
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

assert.ok(
  !dockerfile.includes("sandbox.seed") && !dockerfile.includes("SandboxSeed"),
  "Dockerfile must not scan or copy platform-specific Microsandbox runtime files.",
);
assert.ok(
  !dockerfile.includes("PrepareSandboxRuntime"),
  "Dockerfile must not start or download the microsandbox runtime while building the image.",
);
for (const ignoredPath of [".cache", ".senera", ".uploads", "coverage", "Release/*", "node_modules"]) {
  assert.ok(
    dockerignore.split(/\r?\n/u).includes(ignoredPath),
    `.dockerignore must exclude local or generated directory ${ignoredPath}.`,
  );
}
assert.ok(
  dockerignore.includes("!Release/SandboxImage/**"),
  ".dockerignore must admit only the generated Sandbox Bundle from the Release tree.",
);
assert.ok(
  dockerfile.includes("npm rebuild better-sqlite3 --build-from-source"),
  "Dockerfile must build the Node better-sqlite3 native addon after ignoring dependency scripts.",
);
assert.ok(
  dockerfile.includes("node Dist/Scripts/VerifyDockerNativeSqlite.js"),
  "Dockerfile must run the native SQLite smoke test before producing the runtime image.",
);
assert.ok(
  dockerfile.includes("COPY --chown=node:node Release/SandboxImage ./SandboxImage"),
  "Docker runtime must embed the verified Sandbox Bundle in its own image layer.",
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
    dockerEntrypoint.includes('[ "$runtime_gid" != "0" ]'),
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
    dockerServer.includes("SENERA_GVISOR_WORKER_SOCKET"),
  "Docker deployment must negotiate and lock its Docker Engine provider before preparing the isolated Worker.",
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
    compose.includes("Set SENERA_ADMIN_LOGIN_NAME") &&
    compose.includes("Set SENERA_ADMIN_DISPLAY_NAME") &&
    compose.includes("Set SENERA_ADMIN_PASSWORD"),
  "compose.yaml must require authoritative administrator credentials from deployment configuration.",
);
assert.ok(
  !compose.includes("senera-admin:") && compose.includes("sandbox-worker:"),
  "compose.yaml must use the dedicated sandbox Worker rather than an administrator sidecar.",
);
assert.ok(
  !compose.includes("/dev/kvm:/dev/kvm") &&
    !compose.includes("NET_ADMIN") &&
    compose.includes("/var/run/docker.sock:/run/docker-engine.sock") &&
    compose.includes("SENERA_DOCKER_SANDBOX_PROVIDER") &&
    compose.includes('SENERA_GVISOR_WORKER_SOCKET_MODE: "0666"') &&
    compose.includes("network_mode: none") &&
    compose.includes("read_only: true"),
  "compose.yaml must keep Docker Engine access inside the isolated, read-only Worker without host KVM requirements.",
);
assert.ok(
  compose.includes('- "${SENERA_HOST_PORT:-8787}:8787"') &&
    compose.includes("SENERA_ALLOW_INSECURE_HTTP") &&
    compose.includes("SENERA_DATA_VOLUME") &&
    compose.includes("command: []") &&
    !compose.includes("container_name:") &&
    !compose.includes("127.0.0.1:8787:8787"),
  "compose.yaml must publish a configurable service port, isolate deployment names, and make direct HTTP access explicit.",
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
