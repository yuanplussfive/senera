import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  spawnSeneraInheritedProcess,
  spawnSeneraOwnedProcess,
  type SeneraOwnedProcessExit,
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

  test.runIf(process.platform === "win32")("launches Windows command shims such as npm", async () => {
    const ownedProcess = await spawnSeneraInheritedProcess("npm", ["--version"], defaultSpawnOptions());

    await expect(ownedProcess.closed).resolves.toMatchObject({ exitCode: 0, signal: null });
  });

  test.runIf(process.platform === "win32")("keeps the owned Job alive until detached descendants exit", async () => {
    const childScript = "setTimeout(() => process.exit(0), 750)";
    const launcherScript = [
      'const { spawn } = require("node:child_process");',
      `spawn(process.execPath, ["-e", ${JSON.stringify(childScript)}], { stdio: "ignore", windowsHide: true });`,
    ].join(" ");
    const ownedProcess = await spawnSeneraOwnedProcess(process.execPath, ["-e", launcherScript], defaultSpawnOptions());

    try {
      expect(await waitForOwnedExit(ownedProcess.closed, 500)).toBeUndefined();
      const result = await waitForOwnedExit(ownedProcess.closed, ProcessExitTimeoutMs);
      expect(result).toMatchObject({ exitCode: 0, signal: null });
    } finally {
      await ownedProcess.terminateTree("SIGKILL").catch(() => undefined);
    }
  });

  test.runIf(process.platform === "win32")("fails when a Windows target cannot start", async () => {
    const unavailableCommand = path.join(process.cwd(), `missing-owned-process-${process.pid}.exe`);
    await expect(spawnSeneraOwnedProcess(unavailableCommand, [], defaultSpawnOptions())).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

function waitForOwnedExit(
  closed: Promise<SeneraOwnedProcessExit>,
  timeoutMs: number,
): Promise<SeneraOwnedProcessExit | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    timer.unref();
    void closed.then((result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

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
