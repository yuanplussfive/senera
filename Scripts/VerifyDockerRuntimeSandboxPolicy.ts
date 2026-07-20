import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const dockerfile = fs.readFileSync(path.join(workspaceRoot, "Dockerfile"), "utf8");
const dockerServer = fs.readFileSync(path.join(workspaceRoot, "Apps", "DockerServer.ts"), "utf8");
const releaseWorkflow = fs.readFileSync(path.join(workspaceRoot, ".github", "workflows", "release.yml"), "utf8");

assert.ok(
  !dockerfile.includes("PrepareSandboxRuntime"),
  "Dockerfile must not prepare microsandbox during image build; runtime startup owns sandbox installation.",
);
assert.ok(
  !dockerfile.includes("sandbox-runtime"),
  "Dockerfile must not copy build-time sandbox runtime directories into the image.",
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
  dockerServer.includes('BaseDir: "/data/.senera/sandbox-runtime"'),
  "Docker sandbox runtime must install under the mounted /data volume.",
);
assert.ok(
  dockerServer.includes('BundleDir: "/data/.senera/sandbox-bundles"'),
  "Docker sandbox bundles must live under the mounted /data volume.",
);
assert.ok(
  releaseWorkflow.includes("node Dist/Scripts/VerifyDockerUserPluginWrite.js"),
  "Release container smoke must verify that the node user can write the persistent plugin root.",
);

console.log("Docker runtime sandbox policy verified.");
