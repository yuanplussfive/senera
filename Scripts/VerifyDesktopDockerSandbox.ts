import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const read = (relativePath: string): string => fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
const desktopRuntime = read("Apps/Desktop/DesktopRuntime.ts");
const desktopMain = read("Apps/Desktop/Main.ts");
assert.ok(
  !desktopRuntime.includes("TerminalSidecarRuntime") && !desktopRuntime.includes("syncRuntimeDirectory"),
  "Desktop startup must not copy a host-prepared Linux Terminal Sidecar runtime.",
);
assert.ok(
  desktopMain.includes("SeneraServerDeployments.Local") &&
    desktopMain.includes("deployment: SeneraServerDeployments.Local") &&
    !desktopMain.includes("startSeneraSandboxWorkerProcess") &&
    !desktopMain.includes("dockerEngineWorker") &&
    !desktopMain.includes("sandboxRuntimeAvailability"),
  "Desktop startup must use the local execution boundary without a Docker Worker.",
);
assert.ok(
  !desktopRuntime.includes("sandboxWorkerEntrypoint"),
  "Desktop runtime paths must not resolve a sandbox Worker entrypoint.",
);

console.log("Desktop local runtime verification passed.");
