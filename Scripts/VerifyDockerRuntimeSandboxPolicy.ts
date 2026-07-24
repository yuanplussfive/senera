import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const dockerfile = fs.readFileSync(path.join(workspaceRoot, "Dockerfile"), "utf8");
const dockerServer = fs.readFileSync(path.join(workspaceRoot, "Apps", "DockerServer.ts"), "utf8");
const readme = fs.readFileSync(path.join(workspaceRoot, "README.md"), "utf8");
const operations = fs.readFileSync(path.join(workspaceRoot, "docs", "Operations.md"), "utf8");
const compose = fs.readFileSync(path.join(workspaceRoot, "compose.yaml"), "utf8");
const releaseWorkflow = fs.readFileSync(path.join(workspaceRoot, ".github", "workflows", "release.yml"), "utf8");

assert.ok(
  !dockerfile.includes("sandbox.seed") && !dockerfile.includes("SandboxSeed"),
  "Dockerfile must not scan or copy platform-specific Microsandbox runtime files.",
);
assert.ok(
  !dockerfile.includes("PrepareSandboxRuntime"),
  "Dockerfile must not start or download the microsandbox runtime while building the image.",
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
  dockerfile.includes("/health/ready") && !dockerfile.includes("fetch('http://127.0.0.1:' + port + '/')"),
  "Docker healthcheck must use the explicit readiness endpoint instead of the public frontend route.",
);
assert.ok(
  dockerfile.includes("apt-get install -y --no-install-recommends ca-certificates"),
  "Docker runtime must provide the system CA bundle required by the Microsandbox native HTTP client.",
);
assert.ok(
  dockerServer.includes('BaseDir: "/data/.senera/sandbox-runtime"'),
  "Docker sandbox runtime must install under the mounted /data volume.",
);
assert.ok(
  dockerServer.includes('{ Kind: "ReleaseBundle" }') && dockerServer.includes("productVersion: ProductVersion"),
  "Docker deployment must consume the version-matched release bundle without an OCI fallback.",
);
assert.ok(
  compose.includes("SENERA_ADMIN_LOGIN_NAME") &&
    compose.includes("SENERA_ADMIN_DISPLAY_NAME") &&
    compose.includes("SENERA_ADMIN_PASSWORD"),
  "compose.yaml must declare first-run administrator credentials directly in the service environment.",
);
assert.ok(
  !compose.includes("senera-admin:") && !compose.includes("SENERA_SANDBOX_DEPLOYMENT"),
  "compose.yaml must not retain administrator sidecars or selectable sandbox deployment modes.",
);
assert.ok(
  compose.includes("/dev/kvm:/dev/kvm") && compose.includes("NET_ADMIN"),
  "compose.yaml must require the KVM and network capabilities needed by the OS sandbox.",
);
assert.ok(
  compose.includes('- "8787:8787"') &&
    compose.includes('SENERA_ALLOW_INSECURE_HTTP: "true"') &&
    !compose.includes("127.0.0.1:8787:8787"),
  "compose.yaml must publish the service port and make direct HTTP access an explicit policy.",
);
assert.ok(
  !fs.existsSync(path.join(workspaceRoot, "compose.kvm.yaml")),
  "The retired compose.kvm.yaml overlay must not remain after Docker deployment convergence.",
);
assert.ok(
  dockerServer.includes("synchronizeDockerAdminAccount") &&
    dockerServer.includes("prepareDockerSandboxRuntime") &&
    dockerServer.includes("sandboxRuntimePrepared: true"),
  "Docker must synchronize its administrator and prepare microsandbox before starting the web server.",
);
assertDockerStartupDocumented(readme, "README.md");
assertDockerStartupDocumented(operations, "docs/Operations.md");
assert.ok(
  releaseWorkflow.includes("node Dist/Scripts/VerifyDockerUserPluginWrite.js"),
  "Release container smoke must verify that the node user can write the persistent plugin root.",
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
