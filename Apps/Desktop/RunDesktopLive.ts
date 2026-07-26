import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { spawn, sync as spawnSync } from "cross-spawn";
import { isMainModule } from "../../Source/AgentSystem/Core/AgentPath.js";
import { probeDesktopLiveFrontend } from "./DesktopLiveFrontendServer.js";
import {
  acquireDesktopLiveLock,
  createDesktopLiveCleanup,
  repairNodeNativeDependencies,
  type DesktopLiveLock,
} from "./DesktopLiveLifecycle.js";

interface CommandInvocation {
  command: string;
  arguments: string[];
  env?: NodeJS.ProcessEnv;
  quiet?: boolean;
  stdio?: "ignore" | "inherit";
}

const nativeModules = ["better-sqlite3"];
const nativeDependencyProbe = [
  'const Database = require("better-sqlite3");',
  'const database = new Database(":memory:");',
  "database.close();",
].join(" ");

const configuredFrontendUrl = process.env.SENERA_DESKTOP_FRONTEND_URL?.trim();
const defaultFrontendUrl = "http://127.0.0.1:5173";
const runningChildren = new Set<ChildProcess>();
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
    const nodeNativeCode = ensureNodeNativeDependencies();
    if (nodeNativeCode !== 0) {
      process.exitCode = nodeNativeCode;
      return;
    }

    const buildCode = run(command("npm", ["run", "build"]));
    if (buildCode !== 0) {
      process.exitCode = buildCode;
      return;
    }

    nativeDependenciesRequireRestore = true;
    const electronNativeCode = run(command("electron-builder", ["install-app-deps", "--platform=win32", "--arch=x64"]));
    if (electronNativeCode !== 0) {
      process.exitCode = electronNativeCode;
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
      start(command("npm", frontendDevArguments(frontendUrl)));
    } else if (frontendProbe.kind === "invalid") {
      throw new Error(readInvalidFrontendMessage(frontendUrl, frontendProbe.message));
    } else {
      console.log(`\n> reusing frontend dev server ${frontendUrl}`);
    }

    await waitForFrontend(frontendUrl);
    const electronEnv = { ...process.env };
    delete electronEnv.ELECTRON_RUN_AS_NODE;
    const electronProcess = start(
      command("electron", ["Dist/Apps/Desktop/Main.js"], {
        ...electronEnv,
        SENERA_DESKTOP_FRONTEND_URL: frontendUrl,
        SENERA_DESKTOP_REMOTE_DEBUGGING_PORT: "9333",
      }),
    );
    process.exitCode = await waitForExit(electronProcess);
  } finally {
    const cleanupCode = await cleanupDesktopLive();
    if ((process.exitCode === undefined || process.exitCode === 0) && cleanupCode !== 0) {
      process.exitCode = cleanupCode;
    }
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
      return url.toString().replace(/\/$/, "");
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
  if (!invocation.quiet) {
    console.log(`\n> ${[invocation.command, ...invocation.arguments].join(" ")}`);
  }

  const result = spawnSync(invocation.command, invocation.arguments, {
    cwd: process.cwd(),
    env: invocation.env ?? process.env,
    stdio: invocation.stdio ?? "inherit",
    windowsHide: true,
  });

  if (result.error) {
    console.error(result.error);
    return 1;
  }

  return result.status ?? 1;
}

function start(invocation: CommandInvocation): ChildProcess {
  console.log(`\n> ${[invocation.command, ...invocation.arguments].join(" ")}`);
  const child = spawn(invocation.command, invocation.arguments, {
    cwd: process.cwd(),
    env: invocation.env ?? process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  runningChildren.add(child);
  child.once("exit", () => {
    runningChildren.delete(child);
  });
  child.once("error", (error) => {
    runningChildren.delete(child);
    console.error(error);
  });
  return child;
}

function command(name: string, args: readonly string[] = [], env?: NodeJS.ProcessEnv): CommandInvocation {
  return {
    command: name,
    arguments: [...args],
    env,
  };
}

async function waitForFrontend(url: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    const frontendProbe = await probeDesktopLiveFrontend(url);
    if (frontendProbe.kind === "ready") return;
    if (frontendProbe.kind === "invalid") {
      throw new Error(readInvalidFrontendMessage(url, frontendProbe.message));
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for frontend dev server: ${url}`);
}

function readInvalidFrontendMessage(url: string, detail: string): string {
  return [
    `Frontend URL ${url} is reachable but is not the Senera Vite entry page (${detail}).`,
    "Stop the conflicting frontend server or set SENERA_DESKTOP_FRONTEND_URL to a valid Senera Vite server.",
  ].join(" ");
}

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 0);
    });
  });
}

function registerShutdownHandlers(): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      if (signalExitStarted) return;
      signalExitStarted = true;
      void cleanupDesktopLive()
        .then((cleanupCode) => process.exit(cleanupCode || (signal === "SIGINT" ? 130 : 143)))
        .catch((error: unknown) => {
          console.error(error);
          process.exit(1);
        });
    });
  }
}

function shutdownChildren(): Promise<void> {
  return (shutdownPromise ??= Promise.all([...runningChildren].map(killProcessTree)).then(() => undefined));
}

function killProcessTree(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!child.pid || child.exitCode !== null) {
      resolve();
      return;
    }

    const killer =
      process.platform === "win32"
        ? spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true })
        : undefined;
    if (!killer) {
      child.kill("SIGTERM");
      resolve();
      return;
    }
    killer.once("exit", () => resolve());
    killer.once("error", () => resolve());
  });
}

function ensureNodeNativeDependencies(): number {
  clearNativeRebuildMetadata();
  const result = repairNodeNativeDependencies(
    () =>
      run({
        command: process.execPath,
        arguments: ["-e", nativeDependencyProbe],
        quiet: true,
        stdio: "ignore",
      }),
    () => {
      console.log("\n> detected incompatible Node native dependencies; rebuilding better-sqlite3");
      return run(command("npm", ["rebuild", ...nativeModules]));
    },
  );
  clearNativeRebuildMetadata();
  return result.exitCode;
}

function restoreNativeDependencies(): number {
  if (!nativeDependenciesRequireRestore) return 0;
  nativeDependenciesRequireRestore = false;
  const restoreCode = run(command("npm", ["rebuild", ...nativeModules]));
  clearNativeRebuildMetadata();
  return restoreCode;
}

async function cleanupDesktopLiveResources(): Promise<number> {
  try {
    await shutdownChildren();
    return restoreNativeDependencies();
  } finally {
    desktopLiveLock?.release();
    desktopLiveLock = undefined;
  }
}

function clearNativeRebuildMetadata(): void {
  for (const moduleName of nativeModules) {
    const metadataPath = path.join(process.cwd(), "node_modules", moduleName, "build", "Release", ".forge-meta");
    removeNativeRebuildMetadata(metadataPath);
  }
}

function removeNativeRebuildMetadata(metadataPath: string): void {
  if (!fs.existsSync(metadataPath)) return;

  try {
    fs.rmSync(metadataPath, { force: true });
    return;
  } catch (error) {
    if (process.platform !== "win32" || !isWindowsCleanupError(error)) {
      throw error;
    }
  }

  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      fs.rmSync(metadataPath, { force: true });
      if (!fs.existsSync(metadataPath)) {
        return;
      }
    } catch (error) {
      if (!isWindowsCleanupError(error)) {
        throw error;
      }
    }

    // Brief blocking pause before retrying to handle transient Windows file locks.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }

  if (fs.existsSync(metadataPath)) {
    throw new Error(`Could not remove native rebuild metadata: ${metadataPath}`);
  }
}

function isWindowsCleanupError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  const code = error.code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
