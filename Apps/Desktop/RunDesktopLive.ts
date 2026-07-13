import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, sync as spawnSync } from "cross-spawn";
import { probeDesktopLiveFrontend } from "./DesktopLiveFrontendServer.js";

interface CommandInvocation {
  command: string;
  arguments: string[];
  env?: NodeJS.ProcessEnv;
}

const nativeModules = ["better-sqlite3"];

const frontendUrl = process.env.SENERA_DESKTOP_FRONTEND_URL?.trim() || "http://127.0.0.1:5173";
const runningChildren = new Set<ChildProcess>();
let shuttingDown = false;

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  clearNativeRebuildMetadata();

  const setupSteps = [
    command("npm", ["run", "build"]),
    command("electron-builder", ["install-app-deps", "--platform=win32", "--arch=x64"]),
  ];

  for (const step of setupSteps) {
    const result = run(step);
    if (result !== 0) {
      process.exitCode = result;
      restoreNativeDependencies();
      return;
    }
  }

  registerShutdownHandlers();
  try {
    const frontendProbe = await probeDesktopLiveFrontend(frontendUrl);
    if (frontendProbe.kind === "unavailable") {
      start(command("npm", ["--workspace", "senera-frontend", "run", "dev"]));
    } else if (frontendProbe.kind === "invalid") {
      throw new Error(readInvalidFrontendMessage(frontendUrl, frontendProbe.message));
    } else {
      console.log(`\n> reusing frontend dev server ${frontendUrl}`);
    }

    await waitForFrontend(frontendUrl);
    const electronProcess = start(
      command("electron", ["--remote-debugging-port=9333", "Dist/Apps/Desktop/Main.js"], {
        ...process.env,
        SENERA_DESKTOP_FRONTEND_URL: frontendUrl,
      }),
    );
    process.exitCode = await waitForExit(electronProcess);
  } finally {
    await shutdownChildren();
    restoreNativeDependencies();
  }
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
      void shutdownChildren().finally(() => {
        restoreNativeDependencies();
        process.exit(signal === "SIGINT" ? 130 : 143);
      });
    });
  }
}

async function shutdownChildren(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all([...runningChildren].map(killProcessTree));
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

function restoreNativeDependencies(): void {
  const restoreCode = run(command("npm", ["rebuild", "better-sqlite3"]));
  clearNativeRebuildMetadata();
  if (process.exitCode === undefined && restoreCode !== 0) {
    process.exitCode = restoreCode;
  }
}

function clearNativeRebuildMetadata(): void {
  for (const moduleName of nativeModules) {
    const metadataPath = path.join(process.cwd(), "node_modules", moduleName, "build", "Release", ".forge-meta");
    if (fs.existsSync(metadataPath)) {
      fs.rmSync(metadataPath, { force: true });
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
