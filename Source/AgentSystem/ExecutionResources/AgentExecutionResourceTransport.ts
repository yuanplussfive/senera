import type { SeneraPersistentProcessChild } from "../Execution/SeneraPersistentProcessTypes.js";
import type { SeneraTerminalChild, SeneraTerminalDimensions } from "../Execution/SeneraTerminalTypes.js";
import { terminateSeneraProcessTree } from "../Execution/SeneraNodeProcessBackend.js";
import {
  AgentExecutionResourceSignals,
  type AgentExecutionResourceKind,
  type AgentExecutionResourceSignal,
  type AgentExecutionResourceTerminalMetadata,
} from "./AgentExecutionResourceTypes.js";

export type AgentExecutionResourceExitSignal = NodeJS.Signals | number | null;

export class AgentExecutionResourceTransportCloseError extends Error {
  constructor(
    readonly kind: AgentExecutionResourceKind,
    readonly pid: number | undefined,
    readonly signalFailures: readonly unknown[],
  ) {
    super(`Execution ${kind} transport${pid === undefined ? "" : ` ${pid}`} did not terminate after force kill.`, {
      cause:
        signalFailures.length === 0
          ? undefined
          : signalFailures.length === 1
            ? signalFailures[0]
            : new AggregateError(signalFailures, "Execution resource termination signals failed."),
    });
    this.name = "AgentExecutionResourceTransportCloseError";
  }
}

export interface AgentExecutionResourceTransport {
  readonly kind: AgentExecutionResourceKind;
  readonly pid?: number;
  readonly terminalMetadata?: AgentExecutionResourceTerminalMetadata;
  onOutput(listener: (stream: "stdout" | "stderr", data: Buffer) => void): void;
  onError(listener: (error: Error) => void): void;
  onClose(listener: (exitCode: number | null, signal: AgentExecutionResourceExitSignal) => void): void;
  write(input: Uint8Array): Promise<void>;
  resize(dimensions: SeneraTerminalDimensions): Promise<void>;
  signal(signal: AgentExecutionResourceSignal): Promise<void>;
  close(graceMs: number): Promise<void>;
}

const NodeSignalByResourceSignal = {
  [AgentExecutionResourceSignals.Interrupt]: "SIGINT",
  [AgentExecutionResourceSignals.Terminate]: "SIGTERM",
  [AgentExecutionResourceSignals.Kill]: "SIGKILL",
} as const satisfies Record<AgentExecutionResourceSignal, NodeJS.Signals>;

export class AgentPipeProcessTransport implements AgentExecutionResourceTransport {
  readonly kind = "process";
  private closed = false;
  private exitCode: number | null = null;
  private exitSignal: AgentExecutionResourceExitSignal = null;
  private readonly closeWaiters = new Set<() => void>();

  constructor(private readonly child: SeneraPersistentProcessChild) {
    if (!isPersistentChildRunning(child)) {
      this.exitCode = child.exitCode ?? null;
      this.exitSignal = child.signalCode ?? null;
      this.closed = true;
      return;
    }
    child.on("close", (exitCode, signal) => {
      this.exitCode = exitCode;
      this.exitSignal = signal;
      this.closed = true;
      for (const wake of [...this.closeWaiters]) wake();
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  onOutput(listener: (stream: "stdout" | "stderr", data: Buffer) => void): void {
    this.child.stdout.on("data", (data) => listener("stdout", data));
    this.child.stderr?.on("data", (data) => listener("stderr", data));
  }

  onError(listener: (error: Error) => void): void {
    this.child.stdout.on("error", listener);
    this.child.on("error", listener);
  }

  onClose(listener: (exitCode: number | null, signal: AgentExecutionResourceExitSignal) => void): void {
    if (this.closed) {
      listener(this.exitCode, this.exitSignal);
      return;
    }
    this.child.on("close", listener);
  }

  async write(input: Uint8Array): Promise<void> {
    const drained = this.child.stdin.write(Buffer.from(input));
    if (drained) return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
      this.child.stdin.once("drain", () => finish());
      this.child.once("close", () => finish(new Error("Process closed before stdin drained.")));
    });
  }

  async resize(): Promise<void> {
    throw new Error("Pipe-backed execution resources cannot be resized.");
  }

  async signal(signal: AgentExecutionResourceSignal): Promise<void> {
    await this.sendSignal(NodeSignalByResourceSignal[signal]);
  }

  async close(graceMs: number): Promise<void> {
    if (this.closed) return;
    const signalFailures: unknown[] = [];
    await this.sendSignal("SIGTERM").catch((error) => signalFailures.push(error));
    if (await this.waitForClose(graceMs)) return;
    await this.sendSignal("SIGKILL").catch((error) => signalFailures.push(error));
    if (await this.waitForClose(graceMs)) return;
    throw new AgentExecutionResourceTransportCloseError(this.kind, this.pid, signalFailures);
  }

  private async sendSignal(signal: NodeJS.Signals): Promise<void> {
    const pid = this.child.pid;
    if (pid !== undefined) {
      await terminateSeneraProcessTree(pid, signal).catch(() => {
        this.child.kill(signal);
      });
      return;
    }
    this.child.kill(signal);
  }

  private async waitForClose(timeoutMs: number): Promise<boolean> {
    if (this.closed) return true;
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        this.closeWaiters.delete(wake);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      timer.unref();
      const wake = (): void => finish();
      this.closeWaiters.add(wake);
    });
    return this.closed;
  }
}

function isPersistentChildRunning(child: SeneraPersistentProcessChild): boolean {
  return (
    (child.exitCode === null || child.exitCode === undefined) &&
    (child.signalCode === null || child.signalCode === undefined)
  );
}

export class AgentPtyTerminalTransport implements AgentExecutionResourceTransport {
  readonly kind = "terminal";
  private closed = false;
  private exitCode: number | null = null;
  private exitSignal: AgentExecutionResourceExitSignal = null;
  private dimensions: SeneraTerminalDimensions;
  private readonly closeWaiters = new Set<() => void>();

  constructor(
    private readonly child: SeneraTerminalChild,
    dimensions: SeneraTerminalDimensions,
  ) {
    this.dimensions = { ...dimensions };
    child.onExit(({ exitCode, signal }) => {
      this.exitCode = exitCode;
      this.exitSignal = signal ?? null;
      this.closed = true;
      for (const wake of [...this.closeWaiters]) wake();
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  get terminalMetadata(): AgentExecutionResourceTerminalMetadata {
    return {
      backend: this.child.metadata.backendId,
      shellDialect: this.child.metadata.shellDialect,
      requestedBoundary: this.child.metadata.requestedBoundary,
      effectiveBoundary: this.child.metadata.effectiveBoundary,
      capabilities: this.child.metadata.capabilities,
      capabilityProviders: this.child.metadata.capabilityProviders,
      persistenceScope: this.child.metadata.persistenceScope,
      sandboxId: this.child.metadata.sandboxId,
      ...this.dimensions,
    };
  }

  onOutput(listener: (stream: "stdout" | "stderr", data: Buffer) => void): void {
    this.child.onData((data) => listener("stdout", Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8")));
  }

  onError(listener: (error: Error) => void): void {
    this.child.onError(listener);
  }

  onClose(listener: (exitCode: number | null, signal: AgentExecutionResourceExitSignal) => void): void {
    if (this.closed) {
      listener(this.exitCode, this.exitSignal);
      return;
    }
    this.child.onExit(({ exitCode, signal }) => listener(exitCode, signal ?? null));
  }

  async write(input: Uint8Array): Promise<void> {
    await this.child.write(Buffer.from(input));
  }

  async resize(dimensions: SeneraTerminalDimensions): Promise<void> {
    if (!this.child.resize) {
      throw new Error(`Terminal backend ${this.child.metadata.backendId} does not support resize.`);
    }
    await this.child.resize(dimensions.columns, dimensions.rows);
    this.dimensions = { ...dimensions };
  }

  async signal(signal: AgentExecutionResourceSignal): Promise<void> {
    await this.child.signal(signal);
  }

  async close(graceMs: number): Promise<void> {
    if (this.closed) return;
    const signalFailures: unknown[] = [];
    await this.child.signal(AgentExecutionResourceSignals.Terminate).catch((error) => signalFailures.push(error));
    if (await this.waitForClose(graceMs)) return;
    await this.child.signal(AgentExecutionResourceSignals.Kill).catch((error) => signalFailures.push(error));
    if (await this.waitForClose(graceMs)) return;
    throw new AgentExecutionResourceTransportCloseError(this.kind, this.pid, signalFailures);
  }

  private async waitForClose(timeoutMs: number): Promise<boolean> {
    if (this.closed) return true;
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        this.closeWaiters.delete(wake);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      timer.unref();
      const wake = (): void => finish();
      this.closeWaiters.add(wake);
    });
    return this.closed;
  }
}
