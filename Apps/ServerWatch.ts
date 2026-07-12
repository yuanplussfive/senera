import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const workspaceRoot = process.cwd();
const RestartDebounceMs = 180;
const RestartGraceMs = 2_500;

const WatchedEntries = [
  "Apps",
  "Source",
  "System",
  "Plugins",
  "Packages",
  "Build",
  "Native",
  "baml_src",
  "package.json",
  "tsconfig.json",
  "senera.config.json",
  "senera.config.example.json",
] as const;

const IgnoredPathSegments = new Set([
  ".git",
  ".agents",
  ".claude",
  ".codex",
  ".senera",
  ".uploads",
  ".trae-html-share-packages",
  ".vite",
  ".cache",
  "coverage",
  "Dist",
  "dist",
  "node_modules",
  "Release",
  "tmp",
  "temp",
]);

let server: ChildProcess | undefined;
let restartTimer: NodeJS.Timeout | undefined;
let stopping = false;
let restartPending = false;
let restartInProgress = false;
let queuedRestartPath: string | undefined;
const pathState = new Map<string, string>();

const watchers = watchProjectFiles();
if (process.argv.includes("--dry-run")) {
  for (const watcher of watchers) {
    watcher.close();
  }
  console.log("[serverwatch] dry run complete");
  process.exit(0);
}
startServer();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void stop(signal);
  });
}

function watchProjectFiles(): fs.FSWatcher[] {
  const active: fs.FSWatcher[] = [];
  for (const entry of WatchedEntries) {
    const absolute = path.resolve(workspaceRoot, entry);
    if (!fs.existsSync(absolute) || isIgnoredPath(absolute)) {
      continue;
    }

    snapshotPathState(absolute);
    const stats = fs.statSync(absolute);
    if (stats.isDirectory()) {
      active.push(...watchDirectoryTree(absolute));
    } else {
      active.push(watchEntry(absolute, path.dirname(absolute)));
    }
  }

  console.log(`[serverwatch] watching ${active.length} project paths; runtime output dirs are ignored`);
  return active;
}

function watchDirectoryTree(directory: string): fs.FSWatcher[] {
  try {
    return [watchEntry(directory, directory, { recursive: true })];
  } catch (error) {
    if (!isRecursiveWatchUnsupported(error)) {
      throw error;
    }
  }

  const active: fs.FSWatcher[] = [];
  active.push(watchEntry(directory, directory));
  for (const child of fs.readdirSync(directory, { withFileTypes: true })) {
    const childPath = path.join(directory, child.name);
    if (!child.isDirectory() || isIgnoredPath(childPath)) {
      continue;
    }
    active.push(...watchDirectoryTree(childPath));
  }
  return active;
}

function watchEntry(target: string, eventBaseDir: string, options: { recursive?: boolean } = {}): fs.FSWatcher {
  return fs.watch(target, options, (_eventType, filename) => {
    const changedPath = filename ? path.resolve(eventBaseDir, filename.toString()) : target;
    if (isIgnoredPath(changedPath) || !hasPathStateChanged(changedPath)) {
      return;
    }
    scheduleRestart(changedPath);
  });
}

function scheduleRestart(changedPath: string): void {
  if (stopping) {
    return;
  }
  if (restartTimer) {
    clearTimeout(restartTimer);
  }
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    void restartServer(changedPath);
  }, RestartDebounceMs);
}

async function restartServer(changedPath: string): Promise<void> {
  if (restartInProgress) {
    queuedRestartPath = queuedRestartPath ?? changedPath;
    return;
  }

  restartInProgress = true;
  const relative = path.relative(workspaceRoot, changedPath) || ".";
  console.log(`[serverwatch] restarting because ${relative} changed`);
  try {
    await stopServerForRestart();
    startServer();
  } finally {
    restartInProgress = false;
  }

  if (queuedRestartPath) {
    const queued = queuedRestartPath;
    queuedRestartPath = undefined;
    scheduleRestart(queued);
  }
}

function startServer(): void {
  server = spawn(process.execPath, ["--import", "tsx", "Apps/Server.ts"], {
    cwd: workspaceRoot,
    env: process.env,
    stdio: "inherit",
  });

  server.once("exit", (code, signal) => {
    server = undefined;
    if (stopping || restartPending) {
      restartPending = false;
      return;
    }
    const suffix = signal ? `signal=${signal}` : `code=${code ?? 0}`;
    console.log(`[serverwatch] server exited (${suffix}); waiting for file changes`);
  });
}

async function stopServerForRestart(): Promise<void> {
  const current = server;
  if (!current || current.exitCode !== null) {
    return;
  }

  restartPending = true;
  current.kill("SIGTERM");
  await waitForExit(current, RestartGraceMs);
  if (current.exitCode === null) {
    current.kill("SIGKILL");
    await waitForExit(current, 500);
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function stop(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  stopping = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
  }
  for (const watcher of watchers) {
    watcher.close();
  }
  await stopServerForRestart();
  process.exit(signal === "SIGINT" ? 130 : 143);
}

function isIgnoredPath(absolutePath: string): boolean {
  const relative = path.relative(workspaceRoot, absolutePath);
  if (!relative || relative.startsWith("..")) {
    return false;
  }
  return relative.split(path.sep).some((segment) => IgnoredPathSegments.has(segment));
}

function isRecursiveWatchUnsupported(error: unknown): boolean {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return code === "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM" || code === "ERR_INVALID_ARG_VALUE";
}

function snapshotPathState(absolutePath: string): void {
  if (isIgnoredPath(absolutePath)) {
    return;
  }
  pathState.set(absolutePath, readPathState(absolutePath));
  if (!fs.existsSync(absolutePath)) {
    return;
  }
  const stats = fs.statSync(absolutePath);
  if (!stats.isDirectory()) {
    return;
  }
  for (const child of fs.readdirSync(absolutePath, { withFileTypes: true })) {
    snapshotPathState(path.join(absolutePath, child.name));
  }
}

function hasPathStateChanged(absolutePath: string): boolean {
  const next = readPathState(absolutePath);
  const previous = pathState.get(absolutePath);
  pathState.set(absolutePath, next);
  return previous !== next && !next.startsWith("dir:");
}

function readPathState(absolutePath: string): string {
  try {
    const stats = fs.statSync(absolutePath);
    if (stats.isDirectory()) {
      return `dir:${stats.mtimeMs}`;
    }
    return `file:${stats.mtimeMs}:${stats.size}`;
  } catch {
    return "missing";
  }
}
