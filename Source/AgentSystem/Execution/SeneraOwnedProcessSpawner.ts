import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { spawn } from "cross-spawn";
import { toError } from "../Core/AgentErrors.js";
import { withDeadline } from "../Core/AgentTiming.js";
import {
  terminateSeneraProcessTree,
  terminateSeneraProcessTreeWithEscalation,
  type SeneraProcessTreeTerminator,
} from "./SeneraProcessTreeTermination.js";

const WindowsSupervisorControlFd = 3;
const WindowsSupervisorStatusFd = 4;
const WindowsSupervisorHandshakeTimeoutMs = 10_000;
const WindowsSupervisorShutdownTimeoutMs = 2_000;
const WindowsSupervisorMaxStatusBytes = 64 * 1024;
const WindowsSupervisorModulePath = fileURLToPath(new URL("./SeneraWindowsProcessSupervisor.cjs", import.meta.url));

export interface SeneraOwnedProcessSpawnOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly windowsHide: boolean;
}

export interface SeneraOwnedProcessHandle<TChild extends ChildProcess = ChildProcess> {
  readonly child: TChild;
  readonly pid: number | undefined;
  readonly closed: Promise<SeneraOwnedProcessExit>;
  readonly terminationBackend: "posix-process-group" | "windows-job" | "windows-taskkill-fallback" | "custom";
  terminateTree(signal: NodeJS.Signals): Promise<void>;
}

export type SeneraOwnedProcess = SeneraOwnedProcessHandle<ChildProcessWithoutNullStreams>;
export type SeneraInheritedOwnedProcess = SeneraOwnedProcessHandle<ChildProcess>;

export interface SeneraOwnedProcessExit {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface SeneraOwnedProcessSpawnerOptions {
  readonly terminateProcessTree?: SeneraProcessTreeTerminator;
}

interface WindowsSupervisorStatus {
  readonly ok: boolean;
  readonly pid?: number;
  readonly error?: {
    readonly name?: string;
    readonly message: string;
    readonly code?: string;
  };
}

interface WindowsSupervisorChild extends ChildProcess {
  readonly stdio: [Writable | null, Readable | null, Readable | null, Writable, Readable];
}

class SeneraWindowsSupervisorUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SeneraWindowsSupervisorUnavailableError";
  }
}

export async function spawnSeneraOwnedProcess(
  command: string,
  args: readonly string[],
  spawnOptions: SeneraOwnedProcessSpawnOptions,
  options: SeneraOwnedProcessSpawnerOptions = {},
): Promise<SeneraOwnedProcess> {
  const ownedProcess = await spawnSeneraProcess(command, args, spawnOptions, "pipe", options);
  return { ...ownedProcess, child: requirePipedChildProcess(ownedProcess.child) };
}

export function spawnSeneraInheritedProcess(
  command: string,
  args: readonly string[],
  spawnOptions: SeneraOwnedProcessSpawnOptions,
  options: SeneraOwnedProcessSpawnerOptions = {},
): Promise<SeneraInheritedOwnedProcess> {
  return spawnSeneraProcess(command, args, spawnOptions, "inherit", options);
}

async function spawnSeneraProcess(
  command: string,
  args: readonly string[],
  spawnOptions: SeneraOwnedProcessSpawnOptions,
  stdio: "inherit" | "pipe",
  options: SeneraOwnedProcessSpawnerOptions,
): Promise<SeneraInheritedOwnedProcess> {
  if (process.platform === "win32" && options.terminateProcessTree === undefined) {
    try {
      return await spawnWindowsJobProcess(command, args, spawnOptions, stdio);
    } catch (error) {
      if (!(error instanceof SeneraWindowsSupervisorUnavailableError)) throw error;
      emitOwnedProcessWarning(
        "SENERA_WINDOWS_PROCESS_SUPERVISION_DEGRADED",
        "Windows Job Object supervision is unavailable; process cleanup is degraded to taskkill.",
        error,
      );
      return spawnDirectProcess(
        command,
        args,
        spawnOptions,
        stdio,
        terminateSeneraProcessTree,
        "windows-taskkill-fallback",
      );
    }
  }

  return spawnDirectProcess(
    command,
    args,
    spawnOptions,
    stdio,
    options.terminateProcessTree ?? terminateSeneraProcessTree,
    options.terminateProcessTree ? "custom" : "posix-process-group",
  );
}

async function spawnWindowsJobProcess(
  command: string,
  args: readonly string[],
  options: SeneraOwnedProcessSpawnOptions,
  stdio: "inherit" | "pipe",
): Promise<SeneraInheritedOwnedProcess> {
  let job: import("./AgentWindowsJobObject.js").AgentWindowsJobObject;
  try {
    const { AgentWindowsJobObject } = await import("./AgentWindowsJobObject.js");
    job = new AgentWindowsJobObject();
  } catch (error) {
    throw new SeneraWindowsSupervisorUnavailableError("Unable to create the Windows Job Object.", {
      cause: error,
    });
  }

  let child: WindowsSupervisorChild;
  try {
    child = requireWindowsSupervisorChild(
      spawn(process.execPath, [WindowsSupervisorModulePath], {
        cwd: options.cwd,
        env: supervisorEnvironment(),
        shell: false,
        stdio: [stdio, stdio, stdio, "pipe", "pipe"],
        windowsHide: true,
      }),
    );
  } catch (error) {
    closeWindowsJob(job);
    throw new SeneraWindowsSupervisorUnavailableError("Unable to start the Windows process supervisor.", {
      cause: error,
    });
  }
  const supervisorClosed = observeChildClose(child);

  try {
    await waitForSpawn(child);
    if (child.pid === undefined) throw new Error("Windows process supervisor did not expose a process ID.");
    job.assign(child.pid);
  } catch (error) {
    await disposeWindowsJob(job, child, supervisorClosed);
    throw new SeneraWindowsSupervisorUnavailableError("Unable to assign the process supervisor to a Windows Job.", {
      cause: error,
    });
  }

  void supervisorClosed.then(() => closeWindowsJob(job));
  const control = child.stdio[WindowsSupervisorControlFd];
  const statusPromise = Promise.race([
    readWindowsSupervisorStatus(child.stdio[WindowsSupervisorStatusFd]),
    rejectOnStreamError(control),
  ]);
  control.write(
    `${JSON.stringify({
      command,
      args,
      cwd: options.cwd,
      env: stringEnvironment(options.env),
      windowsHide: options.windowsHide,
    })}\n`,
  );

  let status: WindowsSupervisorStatus;
  try {
    status = await withDeadline(
      statusPromise,
      WindowsSupervisorHandshakeTimeoutMs,
      () => new Error(`Windows process supervisor did not respond within ${WindowsSupervisorHandshakeTimeoutMs}ms.`),
    );
  } catch (error) {
    control.destroy();
    await disposeWindowsJob(job, child, supervisorClosed);
    throw new Error("Windows process supervisor handshake failed after target launch was authorized.", {
      cause: error,
    });
  }

  if (!status.ok) {
    control.end();
    await disposeWindowsJob(job, child, supervisorClosed);
    const spawnError = new Error(status.error?.message ?? "Windows process supervisor could not start the target.");
    spawnError.name = status.error?.name ?? "Error";
    if (status.error?.code) (spawnError as NodeJS.ErrnoException).code = status.error.code;
    throw spawnError;
  }

  setImmediate(() => {
    if (!control.destroyed && !control.writableEnded) control.end();
  });

  return {
    child,
    pid: status.pid,
    closed: supervisorClosed,
    terminationBackend: "windows-job",
    terminateTree: async () => job.terminate(),
  };
}

function spawnDirectProcess(
  command: string,
  args: readonly string[],
  options: SeneraOwnedProcessSpawnOptions,
  stdio: "inherit" | "pipe",
  terminateProcessTree: SeneraProcessTreeTerminator,
  terminationBackend: SeneraOwnedProcessHandle["terminationBackend"],
): SeneraInheritedOwnedProcess {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio,
    shell: false,
    windowsHide: options.windowsHide,
    detached: process.platform !== "win32",
  });
  const closed = observeChildClose(child);
  return {
    child,
    pid: child.pid,
    closed,
    terminationBackend,
    terminateTree: async (signal) => {
      if (child.pid === undefined) {
        if (!child.kill(signal)) throw new Error("Process could not receive a termination signal.");
        return;
      }
      await terminateProcessTree(child.pid, signal);
    },
  };
}

export async function terminateSeneraOwnedProcessWithEscalation(
  ownedProcess: SeneraOwnedProcessHandle,
  graceMs: number,
): Promise<void> {
  const pid = ownedProcess.pid ?? ownedProcess.child.pid;
  if (pid === undefined) return;
  await terminateSeneraProcessTreeWithEscalation({
    pid,
    graceMs,
    hasRootExited: () => hasChildExited(ownedProcess.child),
    waitForRootExit: (timeoutMs) => waitForOwnedProcessExit(ownedProcess, timeoutMs),
    terminateProcessTree: (_pid, signal) => ownedProcess.terminateTree(signal),
  });
}

async function waitForOwnedProcessExit(ownedProcess: SeneraOwnedProcessHandle, timeoutMs: number): Promise<boolean> {
  if (hasChildExited(ownedProcess.child)) return true;
  try {
    await withDeadline(
      ownedProcess.closed,
      timeoutMs,
      () => new Error(`Owned process did not close within ${timeoutMs}ms.`),
    );
    return true;
  } catch {
    return false;
  }
}

function hasChildExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error): void => {
      child.off("spawn", handleSpawn);
      child.off("error", handleError);
      if (error) reject(error);
      else resolve();
    };
    const handleSpawn = (): void => finish();
    const handleError = (error: Error): void => finish(error);
    child.once("spawn", handleSpawn);
    child.once("error", handleError);
  });
}

function readWindowsSupervisorStatus(stream: Readable): Promise<WindowsSupervisorStatus> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let retainedBytes = 0;
    stream.on("data", (chunk: Buffer) => {
      retainedBytes += chunk.byteLength;
      if (retainedBytes > WindowsSupervisorMaxStatusBytes) {
        reject(new Error(`Windows process supervisor status exceeds ${WindowsSupervisorMaxStatusBytes} bytes.`));
        stream.destroy();
        return;
      }
      chunks.push(chunk);
    });
    stream.once("error", reject);
    stream.once("end", () => {
      try {
        resolve(parseWindowsSupervisorStatus(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function rejectOnStreamError(stream: Writable): Promise<never> {
  return new Promise((_, reject) => stream.once("error", reject));
}

function observeChildClose(child: ChildProcess): Promise<SeneraOwnedProcessExit> {
  return new Promise((resolve) => {
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
}

function parseWindowsSupervisorStatus(source: string): WindowsSupervisorStatus {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    throw new TypeError("Windows process supervisor returned an invalid status.");
  }
  if (value.ok) {
    if (typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid <= 0) {
      throw new TypeError("Windows process supervisor returned an invalid target process ID.");
    }
    return { ok: true, pid: value.pid };
  }
  const error = value.error;
  if (!isRecord(error) || typeof error.message !== "string") {
    throw new TypeError("Windows process supervisor returned an invalid launch error.");
  }
  return {
    ok: false,
    error: {
      message: error.message,
      ...(typeof error.name === "string" ? { name: error.name } : {}),
      ...(typeof error.code === "string" ? { code: error.code } : {}),
    },
  };
}

function supervisorEnvironment(): NodeJS.ProcessEnv {
  return typeof process.versions.electron === "string"
    ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
    : { ...process.env };
}

function stringEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function closeWindowsJob(job: import("./AgentWindowsJobObject.js").AgentWindowsJobObject): void {
  try {
    job.close();
  } catch (error) {
    emitOwnedProcessWarning("SENERA_WINDOWS_JOB_CLOSE_FAILED", "Failed to close a Windows Job Object.", error);
  }
}

function terminateWindowsJob(job: import("./AgentWindowsJobObject.js").AgentWindowsJobObject): void {
  try {
    job.terminate();
  } catch (error) {
    emitOwnedProcessWarning(
      "SENERA_WINDOWS_JOB_TERMINATION_FAILED",
      "Failed to terminate a Windows Job Object.",
      error,
    );
  }
}

async function disposeWindowsJob(
  job: import("./AgentWindowsJobObject.js").AgentWindowsJobObject,
  child: ChildProcess,
  supervisorClosed: Promise<SeneraOwnedProcessExit>,
): Promise<void> {
  terminateWindowsJob(job);
  closeWindowsJob(job);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  try {
    await withDeadline(
      supervisorClosed,
      WindowsSupervisorShutdownTimeoutMs,
      () => new Error(`Windows process supervisor did not close within ${WindowsSupervisorShutdownTimeoutMs}ms.`),
    );
  } catch (error) {
    emitOwnedProcessWarning(
      "SENERA_WINDOWS_PROCESS_SUPERVISOR_SHUTDOWN_FAILED",
      "Windows process supervisor shutdown could not be confirmed.",
      error,
    );
  }
}

function emitOwnedProcessWarning(code: string, message: string, cause: unknown): void {
  const warning = new Error(message, { cause: toError(cause) }) as NodeJS.ErrnoException;
  warning.name = "SeneraOwnedProcessWarning";
  warning.code = code;
  process.emitWarning(warning);
}

function requirePipedChildProcess(child: ChildProcess): ChildProcessWithoutNullStreams {
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error("Owned processes require piped stdin, stdout, and stderr streams.");
  }
  return child as ChildProcessWithoutNullStreams;
}

function requireWindowsSupervisorChild(child: ChildProcess): WindowsSupervisorChild {
  const control = child.stdio[WindowsSupervisorControlFd];
  const status = child.stdio[WindowsSupervisorStatusFd];
  if (!control || typeof (control as Writable).write !== "function") {
    throw new Error("Windows process supervisor requires a writable launch-control pipe.");
  }
  if (!status || typeof (status as Readable).on !== "function") {
    throw new Error("Windows process supervisor requires a readable launch-status pipe.");
  }
  return child as WindowsSupervisorChild;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
