import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const dockerfile = fs.readFileSync(path.join(workspaceRoot, "Dockerfile"), "utf8");
const dockerServer = fs.readFileSync(path.join(workspaceRoot, "Apps", "DockerServer.ts"), "utf8");

assert.ok(
  !dockerfile.includes("PrepareSandboxRuntime"),
  "Dockerfile must not prepare microsandbox during image build; runtime startup owns sandbox installation.",
);
assert.ok(
  !dockerfile.includes("sandbox-runtime"),
  "Dockerfile must not copy build-time sandbox runtime directories into the image.",
);
assert.ok(
  dockerServer.includes('BaseDir: "/data/.senera/sandbox-runtime"'),
  "Docker sandbox runtime must install under the mounted /data volume.",
);
assert.ok(
  dockerServer.includes('BundleDir: "/data/.senera/sandbox-bundles"'),
  "Docker sandbox bundles must live under the mounted /data volume.",
);

console.log("Docker runtime sandbox policy verified.");
