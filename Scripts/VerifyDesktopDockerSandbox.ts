import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const read = (relativePath: string): string => fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
const rootPackage = JSON.parse(read("package.json")) as {
  dependencies?: Record<string, string>;
  build?: { extraResources?: unknown[] };
};
const desktopRuntime = read("Apps/Desktop/DesktopRuntime.ts");
const desktopMain = read("Apps/Desktop/Main.ts");
const workerProcess = read("Apps/SandboxWorkerProcess.ts");
const sandboxDockerfile = read("Dockerfile.sandbox");
const workerStartIndex = desktopMain.indexOf("sandboxWorkerHandle = await startSeneraSandboxWorkerProcess");
const serverStartIndex = desktopMain.indexOf("serverHandle = await startSeneraServer");

assert.ok(rootPackage.dependencies?.dockerode, "Desktop runtime must package the Docker Engine client.");
assert.ok(
  desktopRuntime.includes('path.join(appRoot, "Dist", "Apps", "SandboxWorker.js")'),
  "Desktop runtime must resolve the packaged Docker Worker entrypoint from the application bundle.",
);
assert.ok(
  !desktopRuntime.includes("TerminalSidecarRuntime") && !desktopRuntime.includes("syncRuntimeDirectory"),
  "Desktop startup must not copy a host-prepared Linux Terminal Sidecar runtime.",
);
assert.equal(
  rootPackage.build?.extraResources?.some((resource) => JSON.stringify(resource).includes("TerminalSidecarRuntime")) ??
    false,
  false,
  "Desktop packaging must not carry a separate Terminal Sidecar runtime.",
);
assert.ok(
  workerStartIndex >= 0 &&
    serverStartIndex > workerStartIndex &&
    desktopMain.includes("config: bootstrapConfig") &&
    desktopMain.includes("sandboxRuntimeAvailability: sandboxWorkerHandle.availability") &&
    desktopMain.includes("dockerEngineWorker: sandboxWorkerHandle.client"),
  "Desktop startup must connect its Docker Worker before opening the server runtime.",
);
assert.ok(
  workerProcess.includes('ELECTRON_RUN_AS_NODE: "1"') && workerProcess.includes("SENERA_DOCKER_ENGINE_ENDPOINT"),
  "The packaged Worker must run as a hidden Node child and inherit the declared Docker endpoint.",
);
assert.ok(
  sandboxDockerfile.includes("COPY Packages/TerminalSidecar /opt/senera-terminal-sidecar"),
  "The Docker sandbox image must own the Linux Terminal Sidecar runtime.",
);

console.log("Desktop Docker sandbox verification passed.");
