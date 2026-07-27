import path from "node:path";
import { rm } from "node:fs/promises";
import { spawn } from "cross-spawn";
import { toError } from "../Source/AgentSystem/Core/AgentErrors.js";
import { nodeErrorCode } from "../Source/AgentSystem/Core/AgentFs.js";
import { sleep } from "../Source/AgentSystem/Core/AgentTiming.js";
import { ElectronNativeModuleNames } from "./PrepareElectronNativeModules.js";

const NativeMetadataCleanupPolicy = Object.freeze({
  maxAttempts: 5,
  initialDelayMs: 25,
  maximumDelayMs: 200,
  backoffMultiplier: 2,
});
const RetryableNativeMetadataErrorCodes = new Set(["EACCES", "EBUSY", "EPERM"]);

export interface DesktopNativeModuleMaintenanceAdapter {
  removeFile(file: string): Promise<void>;
  run(command: string, args: readonly string[], cwd: string): Promise<number>;
  wait(milliseconds: number): Promise<void>;
}

const DefaultDesktopNativeModuleMaintenanceAdapter: DesktopNativeModuleMaintenanceAdapter = {
  removeFile: (file) => rm(file, { force: true }),
  run: runInheritedCommand,
  wait: sleep,
};

export class DesktopNativeModuleMaintenance {
  constructor(
    private readonly workspaceRoot: string,
    private readonly adapter: DesktopNativeModuleMaintenanceAdapter = DefaultDesktopNativeModuleMaintenanceAdapter,
  ) {}

  async clearRebuildMetadata(): Promise<void> {
    const outcomes = await Promise.allSettled(
      ElectronNativeModuleNames.map((moduleName) =>
        this.removeMetadataWithRetry(metadataPath(this.workspaceRoot, moduleName)),
      ),
    );
    const failures = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason] : []));
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Failed to clear Electron native rebuild metadata.");
  }

  async restoreNodeCompatibility(): Promise<void> {
    let rebuildFailure: Error | undefined;
    try {
      const exitCode = await this.adapter.run("npm", ["rebuild", ...ElectronNativeModuleNames], this.workspaceRoot);
      if (exitCode !== 0) {
        throw new Error(`Native dependency rebuild failed with exit code ${exitCode}.`);
      }
    } catch (error) {
      rebuildFailure = toError(error);
    }

    let cleanupFailure: Error | undefined;
    try {
      await this.clearRebuildMetadata();
    } catch (error) {
      cleanupFailure = toError(error);
    }

    if (rebuildFailure && cleanupFailure) {
      throw new AggregateError([rebuildFailure, cleanupFailure], "Native dependency restoration failed.");
    }
    if (rebuildFailure) throw rebuildFailure;
    if (cleanupFailure) throw cleanupFailure;
  }

  private async removeMetadataWithRetry(file: string): Promise<void> {
    let delayMs: number = NativeMetadataCleanupPolicy.initialDelayMs;
    for (let attempt = 1; attempt <= NativeMetadataCleanupPolicy.maxAttempts; attempt += 1) {
      try {
        await this.adapter.removeFile(file);
        return;
      } catch (error) {
        if (
          !RetryableNativeMetadataErrorCodes.has(nodeErrorCode(error) ?? "") ||
          attempt === NativeMetadataCleanupPolicy.maxAttempts
        ) {
          throw new Error(`Could not remove native rebuild metadata: ${file}`, { cause: error });
        }
      }
      await this.adapter.wait(delayMs);
      delayMs = Math.min(
        delayMs * NativeMetadataCleanupPolicy.backoffMultiplier,
        NativeMetadataCleanupPolicy.maximumDelayMs,
      );
    }
  }
}

function metadataPath(workspaceRoot: string, moduleName: string): string {
  return path.join(workspaceRoot, "node_modules", ...moduleName.split("/"), "build", "Release", ".forge-meta");
}

function runInheritedCommand(command: string, args: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}.`));
      else resolve(exitCode ?? 1);
    });
  });
}
