import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { sync as spawnSync } from "cross-spawn";
import { isMainModule } from "../../Source/AgentSystem/Core/AgentPath.js";
import { sleep } from "../../Source/AgentSystem/Core/AgentTiming.js";
import { resolveAgentWorkspaceLayout } from "../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import {
  spawnSeneraInheritedProcess,
  terminateSeneraOwnedProcessWithEscalation,
  type SeneraInheritedOwnedProcess,
} from "../../Source/AgentSystem/Execution/SeneraOwnedProcessSpawner.js";
import { readDesktopServerPort } from "./DesktopRuntimeConfig.js";
import { probeDesktopLiveFrontend } from "./DesktopLiveFrontendServer.js";
import { acquireDesktopLiveLock, createDesktopLiveCleanup, type DesktopLiveLock } from "./DesktopLiveLifecycle.js";
import { isDesktopLiveBuildCurrent } from "./DesktopLiveBuildState.js";

interface CommandInvocation {
  command: string;
  arguments: string[];
  env?: NodeJS.ProcessEnv;
}

const DesktopChildTerminationGraceMs = 2_000;
/**
 * GPU flags used to be the dev default. That made the dev renderer differ from the
 * packaged one and hid GPU-path bugs, so they are an explicit diagnostic opt-in:
 * `SENERA_DESKTOP_DIAGNOSTIC_GPU=1 npm run desktop.live`.
 */
const DesktopElectronDiagnosticArguments = ["--disable-gpu", "--disable-gpu-compositing", "--in-process-gpu"];
const desktopLiveUserDataDir = resolveAgentWorkspaceLayout(process.cwd()).desktopRuntimeRoot;
const desktopLiveTypeScriptCli = path.join(process.cwd(), "node_modules", "typescript", "bin", "tsc");
const desktopLiveBuildInfoPath = path.join(process.cwd(), ".cache", "desktop-live", "tsconfig.tsbuildinfo");
const desktopLiveMainOutputPath = path.join(process.cwd(), "Dist", "Apps", "Desktop", "Main.js");
const configuredFrontendUrl = process.env.SENERA_DESKTOP_FRONTEND_URL?.trim();
const defaultFrontendUrl = "http://127.0.0.1:5173";
const runningChildren = new Set<SeneraInheritedOwnedProcess>();
let desktopLiveLock: DesktopLiveLock | undefined;
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

    // shortcut: live 模式依赖已安装的预编译原生模块；依赖无兼容二进制时再恢复 Electron 重编译。
    const buildExitCode = buildDesktopLive();
    if (buildExitCode !== 0) {
      process.exitCode = buildExitCode;
      return;
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
    const configuredServerPort = readDesktopServerPort(process.env.SENERA_SERVER_PORT);
    const serverPort = configuredServerPort ?? (await findAvailablePort("127.0.0.1", 8787, "desktop server"));
    const configuredRemoteDebuggingPort = readPort(process.env.SENERA_DESKTOP_REMOTE_DEBUGGING_PORT);
    const remoteDebuggingPort =
      configuredRemoteDebuggingPort ?? (await findAvailablePort("127.0.0.1", 9333, "remote debugging"));
    if (serverPort !== 8787) {
      console.log(`\n> port 8787 is occupied; using desktop server port ${serverPort}`);
    }
    const electronEnv = { ...process.env };
    delete electronEnv.ELECTRON_RUN_AS_NODE;
    const electronProcess = await start(
      command(
        "electron",
        [
          ...readDesktopElectronDevelopmentArguments(),
          `--user-data-dir=${desktopLiveUserDataDir}`,
          "Dist/Apps/Desktop/Main.js",
        ],
        {
          ...electronEnv,
          SENERA_DESKTOP_RELEASE_CHANNEL: "development",
          SENERA_DESKTOP_FRONTEND_URL: frontendUrl,
          SENERA_SERVER_PORT: String(serverPort),
          SENERA_DESKTOP_REMOTE_DEBUGGING_PORT: String(remoteDebuggingPort),
        },
      ),
    );
    process.exitCode = await waitForExit(electronProcess);
  } finally {
    await cleanupDesktopLive();
  }
}

/**
 * Desktop live only needs emitted JavaScript, not the release gates that `npm run
 * build` enforces. Compiling incrementally with the type checker disabled keeps
 * repeat launches near-instant; `npm run build` and CI still run the full pipeline.
 */
function buildDesktopLive(): number {
  if (isDesktopLiveBuildCurrent(process.cwd(), desktopLiveBuildInfoPath, desktopLiveMainOutputPath)) {
    console.log("\n> desktop sources unchanged; skipping compile");
  } else {
    const compile = compileDesktopLive();
    if (compile !== 0) return compile;
  }

  return run(command("tsx", ["Build/CopyRuntimeAssets.ts"]));
}

function compileDesktopLive(): number {
  // The incremental state can outlive the outputs it describes (`npm run build`
  // cleans Dist). Trusting it then would skip every emit and launch stale code.
  if (!fs.existsSync(desktopLiveMainOutputPath)) {
    fs.rmSync(desktopLiveBuildInfoPath, { force: true });
  }

  return run(
    command("node", [
      desktopLiveTypeScriptCli,
      "-p",
      "tsconfig.json",
      "--noCheck",
      "--incremental",
      "--tsBuildInfoFile",
      desktopLiveBuildInfoPath,
    ]),
  );
}

function readDesktopElectronDevelopmentArguments(): string[] {
  return process.env.SENERA_DESKTOP_DIAGNOSTIC_GPU?.trim() ? DesktopElectronDiagnosticArguments : [];
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
  url.port = String(await findAvailablePort(url.hostname, firstPort, "frontend"));
  return url.toString().replace(/\/$/u, "");
}

async function findAvailablePort(host: string, firstPort: number, label: string): Promise<number> {
  for (let port = firstPort; port <= 65_535; port += 1) {
    if (await isPortAvailable(host, port)) return port;
  }
  throw new Error(`Could not find an available ${label} port after ${firstPort - 1}.`);
}

function readPort(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SENERA_DESKTOP_REMOTE_DEBUGGING_PORT must be an integer between 1 and 65535.");
  }
  return port;
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
    await sleep(150);
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
  } finally {
    desktopLiveLock?.release();
    desktopLiveLock = undefined;
  }
}
