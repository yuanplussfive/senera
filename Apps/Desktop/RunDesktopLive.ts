import net from "node:net";
import process from "node:process";
import { sync as spawnSync } from "cross-spawn";
import { DesktopNativeModuleMaintenance } from "../../Build/DesktopNativeModuleMaintenance.js";
import { isMainModule } from "../../Source/AgentSystem/Core/AgentPath.js";
import { sleep } from "../../Source/AgentSystem/Core/AgentTiming.js";
import {
  spawnSeneraInheritedProcess,
  terminateSeneraOwnedProcessWithEscalation,
  type SeneraInheritedOwnedProcess,
} from "../../Source/AgentSystem/Execution/SeneraOwnedProcessSpawner.js";
import { probeDesktopLiveFrontend } from "./DesktopLiveFrontendServer.js";
import { acquireDesktopLiveLock, createDesktopLiveCleanup, type DesktopLiveLock } from "./DesktopLiveLifecycle.js";

interface CommandInvocation {
  command: string;
  arguments: string[];
  env?: NodeJS.ProcessEnv;
}

const DesktopChildTerminationGraceMs = 2_000;
const configuredFrontendUrl = process.env.SENERA_DESKTOP_FRONTEND_URL?.trim();
const defaultFrontendUrl = "http://127.0.0.1:5173";
const runningChildren = new Set<SeneraInheritedOwnedProcess>();
const nativeMaintenance = new DesktopNativeModuleMaintenance(process.cwd());
let desktopLiveLock: DesktopLiveLock | undefined;
let nativeDependenciesRequireRestore = false;
let shutdownPromise: Promise<void> | undefined;
let signalExitStarted = false;
const cleanupDesktopLive = createDesktopLiveCleanup(cleanupDesktopLiveResources);

if (isMainModule(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

async function main(): Promise<void> {
  desktopLiveLock = acquireDesktopLiveLock(process.cwd());
  try {
    registerShutdownHandlers();
    await nativeMaintenance.clearRebuildMetadata();
    nativeDependenciesRequireRestore = true;

    const setupSteps = [
      command("npm", ["run", "build"]),
      command("electron-builder", ["install-app-deps", "--platform=win32", "--arch=x64"]),
    ];
    for (const step of setupSteps) {
      const result = run(step);
      if (result !== 0) {
        process.exitCode = result;
        return;
      }
    }

    let frontendUrl = configuredFrontendUrl || defaultFrontendUrl;
    let frontendProbe = await probeDesktopLiveFrontend(frontendUrl);
    if (!configuredFrontendUrl && frontendProbe.kind === "invalid") {
      frontendUrl = await findAvailableFrontendUrl(frontendUrl);
      frontendProbe = { kind: "unavailable", message: "selected an available port" };
      console.log(`\n> port 5173 is occupied; using ${frontendUrl}`);
    }

    if (frontendProbe.kind === "unavailable") {
      await start(command("npm", frontendDevArguments(frontendUrl)));
    } else if (frontendProbe.kind === "invalid") {
      throw new Error(readInvalidFrontendMessage(frontendUrl, frontendProbe.message));
    } else {
      console.log(`\n> reusing frontend dev server ${frontendUrl}`);
    }

    await waitForFrontend(frontendUrl);
    const electronEnv = { ...process.env };
    delete electronEnv.ELECTRON_RUN_AS_NODE;
    const electronProcess = await start(
      command("electron", ["Dist/Apps/Desktop/Main.js"], {
        ...electronEnv,
        SENERA_DESKTOP_FRONTEND_URL: frontendUrl,
        SENERA_DESKTOP_REMOTE_DEBUGGING_PORT: "9333",
      }),
    );
    process.exitCode = await waitForExit(electronProcess);
  } finally {
    await cleanupDesktopLive();
  }
}

function frontendDevArguments(frontendUrl: string): string[] {
  const url = new URL(frontendUrl);
  if (url.protocol !== "http:") {
    throw new Error(`Desktop live frontend URL must use http: ${frontendUrl}`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`Desktop live frontend URL must not include a path, query, or fragment: ${frontendUrl}`);
  }

  return [
    "--workspace",
    "senera-frontend",
    "run",
    "dev",
    "--",
    "--host",
    url.hostname,
    "--port",
    url.port || "80",
    "--strictPort",
  ];
}

async function findAvailableFrontendUrl(occupiedUrl: string): Promise<string> {
  const url = new URL(occupiedUrl);
  const firstPort = Number(url.port || "80") + 1;
  for (let port = firstPort; port <= 65_535; port += 1) {
    if (await isPortAvailable(url.hostname, port)) {
      url.port = String(port);
      return url.toString().replace(/\/$/u, "");
    }
  }
  throw new Error(`Could not find an available frontend port after ${firstPort - 1}.`);
}

function isPortAvailable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close((error) => resolve(!error));
    });
  });
}

function run(invocation: CommandInvocation): number {
  console.log(`\n> ${[invocation.command, ...invocation.arguments].join(" ")}`);
  const result = spawnSync(invocation.command, invocation.arguments, {
    cwd: process.cwd(),
    env: invocation.env ?? process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    console.error(result.error);
    return 1;
  }
  return result.status ?? 1;
}

async function start(invocation: CommandInvocation): Promise<SeneraInheritedOwnedProcess> {
  console.log(`\n> ${[invocation.command, ...invocation.arguments].join(" ")}`);
  const ownedProcess = await spawnSeneraInheritedProcess(invocation.command, invocation.arguments, {
    cwd: process.cwd(),
    env: invocation.env ?? process.env,
    windowsHide: true,
  });
  runningChildren.add(ownedProcess);
  void ownedProcess.closed.then(() => runningChildren.delete(ownedProcess));
  ownedProcess.child.once("error", (error) => {
    runningChildren.delete(ownedProcess);
    console.error(error);
  });
  return ownedProcess;
}

function command(name: string, args: readonly string[] = [], env?: NodeJS.ProcessEnv): CommandInvocation {
  return { command: name, arguments: [...args], env };
}

async function waitForFrontend(url: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    const frontendProbe = await probeDesktopLiveFrontend(url);
    if (frontendProbe.kind === "ready") return;
    if (frontendProbe.kind === "invalid") {
      throw new Error(readInvalidFrontendMessage(url, frontendProbe.message));
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for frontend dev server: ${url}`);
}

function readInvalidFrontendMessage(url: string, detail: string): string {
  return [
    `Frontend URL ${url} is reachable but is not the Senera Vite entry page (${detail}).`,
    "Stop the conflicting frontend server or set SENERA_DESKTOP_FRONTEND_URL to a valid Senera Vite server.",
  ].join(" ");
}

async function waitForExit(ownedProcess: SeneraInheritedOwnedProcess): Promise<number> {
  const { exitCode, signal } = await ownedProcess.closed;
  return signal ? 1 : (exitCode ?? 0);
}

function registerShutdownHandlers(): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      if (signalExitStarted) return;
      signalExitStarted = true;
      void cleanupDesktopLive()
        .then(() => process.exit(signal === "SIGINT" ? 130 : 143))
        .catch((error: unknown) => {
          console.error(error);
          process.exit(1);
        });
    });
  }
}

function shutdownChildren(): Promise<void> {
  return (shutdownPromise ??= Promise.all(
    [...runningChildren].map((ownedProcess) =>
      terminateSeneraOwnedProcessWithEscalation(ownedProcess, DesktopChildTerminationGraceMs),
    ),
  ).then(() => undefined));
}

async function cleanupDesktopLiveResources(): Promise<void> {
  try {
    await shutdownChildren();
    if (nativeDependenciesRequireRestore) {
      nativeDependenciesRequireRestore = false;
      await nativeMaintenance.restoreNodeCompatibility();
    }
  } finally {
    desktopLiveLock?.release();
    desktopLiveLock = undefined;
  }
}
