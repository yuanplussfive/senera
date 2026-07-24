import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const dockerfile = fs.readFileSync(path.join(workspaceRoot, "Dockerfile"), "utf8");
const dockerServer = fs.readFileSync(path.join(workspaceRoot, "Apps", "DockerServer.ts"), "utf8");
const readme = fs.readFileSync(path.join(workspaceRoot, "README.md"), "utf8");
const operations = fs.readFileSync(path.join(workspaceRoot, "docs", "Operations.md"), "utf8");
const compose = fs.readFileSync(path.join(workspaceRoot, "compose.yaml"), "utf8");
const kvmCompose = fs.readFileSync(path.join(workspaceRoot, "compose.kvm.yaml"), "utf8");
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
  dockerfile.includes("apt-get install -y --no-install-recommends ca-certificates"),
  "Docker runtime must provide the system CA bundle required by the Microsandbox native HTTP client.",
);
assert.ok(
  dockerServer.includes('BaseDir: "/data/.senera/sandbox-runtime"'),
  "Docker sandbox runtime must install under the mounted /data volume.",
);
assertAdminInitializationPrecedesStartup(readme, "README.md");
assertAdminInitializationPrecedesStartup(operations, "docs/Operations.md");
assert.ok(
  compose.includes("x-senera-runtime: &senera-runtime") && compose.match(/<<: \*senera-runtime/gu)?.length === 2,
  "compose.yaml must share one runtime image, environment, and volume contract across service entrypoints.",
);
assert.ok(
  compose.includes("senera-admin:") && compose.includes("- admin") && compose.includes("- Dist/Apps/AdminAccess.js"),
  "compose.yaml must expose the administrator command through an opt-in service profile.",
);
assert.ok(
  compose.includes("SENERA_SANDBOX_DEPLOYMENT: standard") &&
    !compose.includes("/dev/kvm:/dev/kvm") &&
    !compose.includes("NET_ADMIN"),
  "compose.yaml must provide a standard deployment without KVM or NET_ADMIN requirements.",
);
assert.ok(
  kvmCompose.includes("SENERA_SANDBOX_DEPLOYMENT: kvm") &&
    kvmCompose.includes("/dev/kvm:/dev/kvm") &&
    kvmCompose.includes("NET_ADMIN"),
  "compose.kvm.yaml must opt into the KVM-specific sandbox capabilities.",
);
assert.ok(
  dockerServer.includes("prepareDockerSandboxRuntime") && dockerServer.includes("sandboxRuntimePrepared"),
  "Docker KVM deployment must prepare microsandbox before starting the web server and publish the verified state.",
);
assert.ok(
  releaseWorkflow.includes("node Dist/Scripts/VerifyDockerUserPluginWrite.js"),
  "Release container smoke must verify that the node user can write the persistent plugin root.",
);

console.log("Docker runtime sandbox policy verified.");

function assertAdminInitializationPrecedesStartup(document: string, label: string): void {
  const initialize = document.indexOf("docker compose run --rm -it senera-admin init");
  const startup = document.indexOf("docker compose up -d --pull always");
  assert.ok(initialize >= 0, `${label} must document Docker administrator initialization.`);
  assert.ok(startup > initialize, `${label} must initialize the Docker administrator before starting the service.`);
  assert.ok(
    !document.includes("docker compose run --rm -it senera node Dist/Apps/AdminAccess.js"),
    `${label} must not expose the container's internal administrator script path.`,
  );
}
