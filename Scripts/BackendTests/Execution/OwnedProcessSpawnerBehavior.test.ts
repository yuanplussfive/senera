import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  spawnSeneraInheritedProcess,
  spawnSeneraOwnedProcess,
} from "../../../Source/AgentSystem/Execution/SeneraOwnedProcessSpawner.js";

const ProcessExitTimeoutMs = 3_000;

describe("owned process spawner behavior", () => {
  test("supports inherited stdio while retaining platform process ownership", async () => {
    const ownedProcess = await spawnSeneraInheritedProcess(
      process.execPath,
      ["-e", "process.exit(0)"],
      defaultSpawnOptions(),
    );

    expect(ownedProcess.child.stdout).toBeNull();
    expect(ownedProcess.terminationBackend).toBe(process.platform === "win32" ? "windows-job" : "posix-process-group");
    await expect(ownedProcess.closed).resolves.toMatchObject({ exitCode: 0, signal: null });
  });

  test.runIf(process.platform === "win32")("uses a Windows Job Object for default process ownership", async () => {
    const ownedProcess = await spawnSeneraOwnedProcess(
      process.execPath,
      ["-e", "setInterval(() => undefined, 1_000)"],
      defaultSpawnOptions(),
    );

    try {
      expect(ownedProcess.terminationBackend).toBe("windows-job");
      expect(ownedProcess.pid).toEqual(expect.any(Number));
      expect(ownedProcess.pid).not.toBe(ownedProcess.child.pid);
      const closed = waitForClose(ownedProcess.child);
      await ownedProcess.terminateTree("SIGKILL");
      await expect(closed).resolves.toBeUndefined();
    } finally {
      await ownedProcess.terminateTree("SIGKILL").catch(() => undefined);
    }
  });

  test.runIf(process.platform === "win32")(
    "does not retry a target outside the Job Object when target startup fails",
    async () => {
      const unavailableCommand = path.join(process.cwd(), `missing-owned-process-${process.pid}.exe`);
      const warnings: NodeJS.ErrnoException[] = [];
      const onWarning = (warning: Error): void => {
        warnings.push(warning);
      };
      process.on("warning", onWarning);

      try {
        await expect(spawnSeneraOwnedProcess(unavailableCommand, [], defaultSpawnOptions())).rejects.toMatchObject({
          code: "ENOENT",
        });
        expect(warnings.map((warning) => warning.code)).not.toContain("SENERA_WINDOWS_PROCESS_SUPERVISION_DEGRADED");
      } finally {
        process.off("warning", onWarning);
      }
    },
  );
});

function defaultSpawnOptions() {
  return {
    cwd: process.cwd(),
    env: { ...process.env },
    windowsHide: true,
  } as const;
}

function waitForClose(child: NodeJS.EventEmitter): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Process did not close within ${ProcessExitTimeoutMs}ms.`)),
      ProcessExitTimeoutMs,
    );
    timer.unref();
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
