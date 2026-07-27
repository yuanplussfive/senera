import kill from "tree-kill";
import { sleep, withDeadline } from "../Core/AgentTiming.js";

const SeneraProcessTreeProbeIntervalMs = 25;

export type SeneraProcessTreeTerminator = (pid: number, signal: NodeJS.Signals) => Promise<void>;

export interface SeneraProcessTreeTerminationDiagnostics {
  readonly pid: number;
  readonly platform: NodeJS.Platform;
  readonly rootExited: boolean;
  readonly processTreeAlive: boolean | undefined;
  readonly gracefulAcknowledged: boolean;
  readonly forceAcknowledged: boolean;
}

export class SeneraProcessTreeTerminationError extends Error {
  constructor(
    readonly diagnostics: SeneraProcessTreeTerminationDiagnostics,
    readonly failures: readonly unknown[],
  ) {
    super(`Process tree ${diagnostics.pid} did not terminate within the configured grace period.`, {
      cause:
        failures.length === 0
          ? undefined
          : failures.length === 1
            ? failures[0]
            : new AggregateError(failures, "Process-tree termination attempts failed."),
    });
    this.name = "SeneraProcessTreeTerminationError";
  }
}

export interface TerminateSeneraProcessTreeOptions {
  readonly pid: number;
  readonly graceMs: number;
  readonly hasRootExited: () => boolean;
  readonly waitForRootExit: (timeoutMs: number) => Promise<boolean>;
  readonly terminateProcessTree?: SeneraProcessTreeTerminator;
}

interface SeneraProcessTreeTerminationAttempt {
  readonly signal: NodeJS.Signals;
  readonly acknowledged: boolean;
  readonly error?: unknown;
}

export async function terminateSeneraProcessTreeWithEscalation(
  options: TerminateSeneraProcessTreeOptions,
): Promise<void> {
  const terminateProcessTree = options.terminateProcessTree ?? terminateSeneraProcessTree;
  const failures: unknown[] = [];
  const initialState = readTerminationState(options.pid, options.hasRootExited);
  if (isTerminationConfirmed(initialState, true)) return;

  let gracefulAcknowledged = false;
  let forceAcknowledged = false;
  let finalState = initialState;

  for (const signal of seneraProcessTreeTerminationSignals()) {
    const attempt = await requestProcessTreeTermination(terminateProcessTree, options.pid, signal, options.graceMs);
    if (attempt.error !== undefined) failures.push(attempt.error);
    if (signal === "SIGTERM") gracefulAcknowledged = attempt.acknowledged;
    if (signal === "SIGKILL") forceAcknowledged = attempt.acknowledged;

    finalState = await waitForTerminationConfirmation(options, attempt.acknowledged, failures);
    if (isTerminationConfirmed(finalState, attempt.acknowledged)) return;
  }

  throw new SeneraProcessTreeTerminationError(
    {
      pid: options.pid,
      platform: process.platform,
      rootExited: finalState.rootExited,
      processTreeAlive: finalState.processTreeAlive,
      gracefulAcknowledged,
      forceAcknowledged,
    },
    failures,
  );
}

export function terminateSeneraProcessTree(pid: number, signal: NodeJS.Signals): Promise<void> {
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  return new Promise((resolve, reject) => {
    kill(pid, signal, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function isSeneraProcessTreeAlive(pid: number): boolean | undefined {
  if (process.platform === "win32") return undefined;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    return undefined;
  }
}

function seneraProcessTreeTerminationSignals(): readonly NodeJS.Signals[] {
  return process.platform === "win32" ? ["SIGKILL"] : ["SIGTERM", "SIGKILL"];
}

async function requestProcessTreeTermination(
  terminateProcessTree: SeneraProcessTreeTerminator,
  pid: number,
  signal: NodeJS.Signals,
  timeoutMs: number,
): Promise<SeneraProcessTreeTerminationAttempt> {
  try {
    await withDeadline(
      Promise.resolve().then(() => terminateProcessTree(pid, signal)),
      timeoutMs,
      () => new Error(`Process-tree ${signal} request exceeded ${timeoutMs}ms.`),
    );
    return { signal, acknowledged: true };
  } catch (error) {
    return { signal, acknowledged: false, error };
  }
}

async function waitForTerminationConfirmation(
  options: TerminateSeneraProcessTreeOptions,
  acknowledged: boolean,
  failures: unknown[],
): Promise<ReturnType<typeof readTerminationState>> {
  if (!acknowledged) return readTerminationState(options.pid, options.hasRootExited);

  const deadline = Date.now() + options.graceMs;
  try {
    await options.waitForRootExit(options.graceMs);
  } catch (error) {
    failures.push(error);
  }

  let state = readTerminationState(options.pid, options.hasRootExited);
  while (!isTerminationConfirmed(state, acknowledged)) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0 || !state.rootExited) return state;
    await sleep(Math.min(SeneraProcessTreeProbeIntervalMs, remainingMs), { unref: true });
    state = readTerminationState(options.pid, options.hasRootExited);
  }
  return state;
}

function readTerminationState(pid: number, hasRootExited: () => boolean) {
  return {
    rootExited: hasRootExited(),
    processTreeAlive: isSeneraProcessTreeAlive(pid),
  } as const;
}

function isTerminationConfirmed(state: ReturnType<typeof readTerminationState>, requestAcknowledged: boolean): boolean {
  if (!state.rootExited || state.processTreeAlive === true) return false;
  if (state.processTreeAlive === false) return true;
  return process.platform === "win32" && requestAcknowledged;
}
