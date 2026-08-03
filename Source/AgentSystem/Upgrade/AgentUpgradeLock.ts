import fs from "node:fs";
import path from "node:path";
import { parseJsonText } from "../Core/AgentJsonParsing.js";

const UpgradeLockFileName = ".upgrade.lock";

interface UpgradeLockRecord {
  readonly pid: number;
  readonly acquiredAt: string;
}

export function acquireAgentUpgradeLock(upgradeRoot: string, now = (): Date => new Date()): () => void {
  fs.mkdirSync(upgradeRoot, { recursive: true, mode: 0o700 });
  const lockPath = path.join(upgradeRoot, UpgradeLockFileName);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeFileSync(
          descriptor,
          `${JSON.stringify({ pid: process.pid, acquiredAt: now().toISOString() } satisfies UpgradeLockRecord)}\n`,
          "utf8",
        );
      } finally {
        fs.closeSync(descriptor);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const current = readLockRecord(lockPath);
        if (current?.pid === process.pid) fs.rmSync(lockPath, { force: true });
      };
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      const current = readLockRecord(lockPath);
      if (current && isProcessRunning(current.pid)) {
        throw new Error(`Another Senera upgrade operation is active (pid=${current.pid}).`, { cause: error });
      }
      fs.rmSync(lockPath, { force: true });
    }
  }
  throw new Error("Unable to acquire the Senera upgrade lock.");
}

function readLockRecord(lockPath: string): UpgradeLockRecord | undefined {
  try {
    const value = parseJsonText(fs.readFileSync(lockPath, "utf8"), "Upgrade lock file") as Partial<UpgradeLockRecord>;
    return Number.isSafeInteger(value.pid) && Number(value.pid) > 0 && typeof value.acquiredAt === "string"
      ? { pid: Number(value.pid), acquiredAt: value.acquiredAt }
      : undefined;
  } catch {
    return undefined;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
