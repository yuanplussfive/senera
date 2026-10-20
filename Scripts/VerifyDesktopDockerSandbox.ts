import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const read = (relativePath: string): string => fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
const desktopRuntime = read("Apps/Desktop/DesktopRuntime.ts");
const desktopMain = read("Apps/Desktop/Main.ts");
const desktopServerHost = read("Apps/Desktop/DesktopServerHost.ts");
const desktopServerProcess = read("Apps/Desktop/DesktopServerProcess.ts");
assert.ok(
  !desktopRuntime.includes("TerminalSidecarRuntime") && !desktopRuntime.includes("syncRuntimeDirectory"),
  "Desktop startup must not copy a host-prepared Linux Terminal Sidecar runtime.",
);
assert.ok(
  desktopMain.includes("DesktopServerHost.start") &&
    desktopServerHost.includes("utilityProcess.fork") &&
    desktopServerHost.includes("DesktopServerProcess.js") &&
    desktopServerProcess.includes("SeneraServerDeployments.Local") &&
    desktopServerProcess.includes("deployment: SeneraServerDeployments.Local") &&
    ![desktopMain, desktopServerHost, desktopServerProcess].some(
      (source) =>
        source.includes("startSeneraSandboxWorkerProcess") ||
        source.includes("dockerEngineWorker") ||
        source.includes("sandboxRuntimeAvailability"),
    ),
  "Desktop startup must keep the local execution boundary in its controlled server process without a Docker Worker.",
);
assert.ok(
  !desktopRuntime.includes("sandboxWorkerEntrypoint"),
  "Desktop runtime paths must not resolve a sandbox Worker entrypoint.",
);

console.log("Desktop local runtime verification passed.");
