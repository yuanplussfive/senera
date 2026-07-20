import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { SeneraMicrosandboxTerminalHandle } from "./SeneraMicrosandboxTypes.js";
import type { SeneraTerminalDisposable, SeneraTerminalExitEvent, SeneraTerminalSignal } from "./SeneraTerminalTypes.js";

export interface SeneraTerminalSidecarChannel {
  readonly pid?: number;
  write(data: Uint8Array): Promise<void>;
  terminate(signal: SeneraTerminalSignal): Promise<void>;
  onData(listener: (data: Buffer) => void): SeneraTerminalDisposable;
  onError(listener: (error: Error) => void): SeneraTerminalDisposable;
  onExit(listener: (event: SeneraTerminalExitEvent) => void): SeneraTerminalDisposable;
}

export class SeneraNodeTerminalSidecarChannel implements SeneraTerminalSidecarChannel {
  constructor(private readonly child: ChildProcessWithoutNullStreams) {}

  get pid(): number | undefined {
    return this.child.pid;
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.child.stdin.write(Buffer.from(data))) return;
    await new Promise<void>((resolve, reject) => {
      const onDrain = (): void => finish();
      const onError = (error: Error): void => finish(error);
      const onClose = (): void => finish(new Error("Terminal sidecar closed before stdin drained."));
      const finish = (error?: Error): void => {
        this.child.stdin.off("drain", onDrain);
        this.child.stdin.off("error", onError);
        this.child.off("close", onClose);
        if (error) reject(error);
        else resolve();
      };
      this.child.stdin.once("drain", onDrain);
      this.child.stdin.once("error", onError);
      this.child.once("close", onClose);
    });
  }

  async terminate(signal: SeneraTerminalSignal): Promise<void> {
    const nativeSignal = {
      interrupt: "SIGINT",
      terminate: "SIGTERM",
      kill: "SIGKILL",
    } as const satisfies Record<SeneraTerminalSignal, NodeJS.Signals>;
    this.child.kill(nativeSignal[signal]);
  }

  onData(listener: (data: Buffer) => void): SeneraTerminalDisposable {
    const onData = (data: Buffer): void => listener(data);
    this.child.stdout.on("data", onData);
    return disposable(() => this.child.stdout.off("data", onData));
  }

  onError(listener: (error: Error) => void): SeneraTerminalDisposable {
    const onError = (error: Error): void => listener(error);
    const onStderr = (data: Buffer): void => listener(new Error(data.toString("utf8")));
    this.child.on("error", onError);
    this.child.stderr.on("data", onStderr);
    return disposable(() => {
      this.child.off("error", onError);
      this.child.stderr.off("data", onStderr);
    });
  }

  onExit(listener: (event: SeneraTerminalExitEvent) => void): SeneraTerminalDisposable {
    const onExit = (exitCode: number | null, signal: NodeJS.Signals | null): void =>
      listener({ exitCode: exitCode ?? 1, signal: signal ?? undefined });
    this.child.on("exit", onExit);
    return disposable(() => this.child.off("exit", onExit));
  }
}

export class SeneraMicrosandboxTerminalSidecarChannel implements SeneraTerminalSidecarChannel {
  private readonly dataListeners = new Set<(data: Buffer) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly exitListeners = new Set<(event: SeneraTerminalExitEvent) => void>();
  private _pid: number | undefined;
  private error: Error | undefined;
  private exitEvent: SeneraTerminalExitEvent | undefined;
  private disposal: Promise<void> | undefined;

  constructor(
    private readonly handle: SeneraMicrosandboxTerminalHandle,
    private readonly dispose: () => Promise<void>,
  ) {
    void this.consume();
  }

  get pid(): number | undefined {
    return this._pid;
  }

  write(data: Uint8Array): Promise<void> {
    return this.handle.write(data);
  }

  async terminate(signal: SeneraTerminalSignal): Promise<void> {
    if (this.exitEvent) return;
    const signalNumber = { interrupt: 2, terminate: 15, kill: 9 } as const satisfies Record<
      SeneraTerminalSignal,
      number
    >;
    if (signal === "kill") await this.handle.kill();
    else await this.handle.signal(signalNumber[signal]);
  }

  onData(listener: (data: Buffer) => void): SeneraTerminalDisposable {
    this.dataListeners.add(listener);
    return disposable(() => this.dataListeners.delete(listener));
  }

  onError(listener: (error: Error) => void): SeneraTerminalDisposable {
    this.errorListeners.add(listener);
    if (this.error) queueMicrotask(() => listener(this.error as Error));
    return disposable(() => this.errorListeners.delete(listener));
  }

  onExit(listener: (event: SeneraTerminalExitEvent) => void): SeneraTerminalDisposable {
    this.exitListeners.add(listener);
    if (this.exitEvent) queueMicrotask(() => listener(this.exitEvent as SeneraTerminalExitEvent));
    return disposable(() => this.exitListeners.delete(listener));
  }

  private async consume(): Promise<void> {
    let exitCode = 1;
    try {
      for await (const event of this.handle.events) {
        if (event.kind === "started") this._pid = event.pid;
        else if (event.kind === "output" && event.stream === "stdout") {
          for (const listener of this.dataListeners) listener(event.data);
        } else if (event.kind === "output") {
          this.emitError(new Error(event.data.toString("utf8")));
        } else exitCode = event.code;
      }
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      await this.disposeOnce();
      this.emitExit({ exitCode });
    }
  }

  private emitError(error: Error): void {
    this.error = error;
    for (const listener of this.errorListeners) listener(error);
  }

  private emitExit(event: SeneraTerminalExitEvent): void {
    if (this.exitEvent) return;
    this.exitEvent = event;
    for (const listener of this.exitListeners) listener(event);
  }

  private disposeOnce(): Promise<void> {
    this.disposal ??= this.dispose();
    return this.disposal;
  }
}

function disposable(dispose: () => void): SeneraTerminalDisposable {
  return { dispose };
}
