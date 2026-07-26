import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DesktopLiveLockRelativePath = path.join(".cache", "desktop-live.lock");
const LockAcquireAttempts = 3;
const IncompleteLockGracePeriodMs = 5_000;

interface DesktopLiveLockOwner {
  pid: number;
  token: string;
}

export interface DesktopLiveLock {
  path: string;
  release(): void;
}

export interface DesktopLiveLockOptions {
  processId?: number;
  token?: string;
  isProcessRunning?: (processId: number) => boolean;
}

export function repairNodeNativeDependencies(
  probe: () => number,
  rebuild: () => number,
): { exitCode: number; repaired: boolean } {
  const probeCode = probe();
  if (probeCode === 0) return { exitCode: 0, repaired: false };
  return { exitCode: rebuild(), repaired: true };
}

export function createDesktopLiveCleanup(action: () => Promise<number>): () => Promise<number> {
  let cleanupPromise: Promise<number> | undefined;
  return () => (cleanupPromise ??= Promise.resolve().then(action));
}

export function acquireDesktopLiveLock(workspaceRoot: string, options: DesktopLiveLockOptions = {}): DesktopLiveLock {
  const lockPath = path.join(workspaceRoot, DesktopLiveLockRelativePath);
  const processId = options.processId ?? process.pid;
  const token = options.token ?? randomUUID();
  const isProcessRunning = options.isProcessRunning ?? defaultIsProcessRunning;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < LockAcquireAttempts; attempt += 1) {
    try {
      const descriptor = fs.openSync(lockPath, "wx");
      try {
        fs.writeFileSync(descriptor, `${JSON.stringify({ pid: processId, token })}\n`, "utf8");
      } finally {
        fs.closeSync(descriptor);
      }
      return {
        path: lockPath,
        release: () => releaseDesktopLiveLock(lockPath, token),
      };
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
    }

    const owner = readDesktopLiveLockOwner(lockPath);
    if (owner && isProcessRunning(owner.pid)) {
      throw new Error(
        `LiveDesktop is already running (PID ${owner.pid}). Close it from the tray or stop its launcher before starting another instance.`,
      );
    }
    if (!owner && isRecentFile(lockPath, IncompleteLockGracePeriodMs)) {
      throw new Error("Another LiveDesktop launcher is acquiring the launch lock. Try again in a few seconds.");
    }
    quarantineStaleLock(lockPath, processId);
  }

  throw new Error(`Could not acquire the LiveDesktop launch lock: ${lockPath}`);
}

function releaseDesktopLiveLock(lockPath: string, token: string): void {
  const owner = readDesktopLiveLockOwner(lockPath);
  if (!owner || owner.token !== token) return;
  fs.rmSync(lockPath, { force: true });
}

function quarantineStaleLock(lockPath: string, processId: number): void {
  const stalePath = `${lockPath}.stale-${processId}-${randomUUID()}`;
  try {
    fs.renameSync(lockPath, stalePath);
  } catch (error) {
    if (isFileMissingError(error)) return;
    throw error;
  }
  fs.rmSync(stalePath, { force: true });
}

function readDesktopLiveLockOwner(lockPath: string): DesktopLiveLockOwner | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8")) as Partial<DesktopLiveLockOwner>;
    if (!Number.isInteger(parsed.pid) || Number(parsed.pid) <= 0 || typeof parsed.token !== "string") {
      return undefined;
    }
    return { pid: Number(parsed.pid), token: parsed.token };
  } catch {
    return undefined;
  }
}

function defaultIsProcessRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function isRecentFile(filePath: string, maximumAgeMs: number): boolean {
  try {
    return Date.now() - fs.statSync(filePath).mtimeMs < maximumAgeMs;
  } catch {
    return false;
  }
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isFileMissingError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
