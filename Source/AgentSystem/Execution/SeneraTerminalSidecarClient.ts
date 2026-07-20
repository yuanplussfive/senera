import {
  SeneraTerminalSidecarProtocolVersion,
  TerminalSidecarServerFrameDecoder,
  encodeTerminalSidecarClientMessage,
  type TerminalSidecarClientMessage,
  type TerminalSidecarServerMessage,
} from "@senera/terminal-sidecar";
import type { SeneraTerminalSidecarChannel } from "./SeneraTerminalSidecarChannel.js";
import type {
  SeneraTerminalChild,
  SeneraTerminalDisposable,
  SeneraTerminalExecutionMetadata,
  SeneraTerminalExitEvent,
  SeneraTerminalSignal,
} from "./SeneraTerminalTypes.js";

export interface OpenSeneraTerminalSidecarOptions {
  readonly channel: SeneraTerminalSidecarChannel;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly columns: number;
  readonly rows: number;
  readonly terminalName: string;
  readonly metadata: SeneraTerminalExecutionMetadata;
  readonly signal?: AbortSignal;
}

export async function openSeneraTerminalSidecar(
  options: OpenSeneraTerminalSidecarOptions,
): Promise<SeneraTerminalChild> {
  const client = new SeneraTerminalSidecarClient(options);
  await client.open();
  return client;
}

class SeneraTerminalSidecarClient implements SeneraTerminalChild {
  readonly metadata: SeneraTerminalExecutionMetadata;
  private readonly decoder = new TerminalSidecarServerFrameDecoder();
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly pendingOutput: string[] = [];
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly exitListeners = new Set<(event: SeneraTerminalExitEvent) => void>();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private requestId = 0;
  private _pid: number | undefined;
  private exitEvent: SeneraTerminalExitEvent | undefined;

  constructor(private readonly options: OpenSeneraTerminalSidecarOptions) {
    this.metadata = options.metadata;
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    options.channel.onData((data) => this.receive(data));
    options.channel.onError((error) => this.fail(error));
    options.channel.onExit((event) => this.handleChannelExit(event));
    options.signal?.addEventListener("abort", () => void this.signal("terminate"), { once: true });
  }

  get pid(): number | undefined {
    return this._pid;
  }

  async open(): Promise<void> {
    await this.send({
      type: "open",
      protocolVersion: SeneraTerminalSidecarProtocolVersion,
      command: this.options.command,
      args: [...this.options.args],
      cwd: this.options.cwd,
      env: this.options.env,
      columns: this.options.columns,
      rows: this.options.rows,
      terminalName: this.options.terminalName,
    });
    await this.ready;
  }

  write(data: string | Buffer): Promise<void> {
    return this.request("write", (requestId) => ({ type: "write", requestId, input: data.toString() }));
  }

  resize(columns: number, rows: number): Promise<void> {
    return this.request("resize", (requestId) => ({ type: "resize", requestId, columns, rows }));
  }

  signal(signal: SeneraTerminalSignal): Promise<void> {
    return this.request("signal", (requestId) => ({ type: "signal", requestId, signal }));
  }

  onData(listener: (data: string | Buffer) => void): SeneraTerminalDisposable {
    const stringListener = (data: string): void => listener(data);
    this.dataListeners.add(stringListener);
    for (const data of this.pendingOutput.splice(0)) stringListener(data);
    return disposable(this.dataListeners, stringListener);
  }

  onError(listener: (error: Error) => void): SeneraTerminalDisposable {
    this.errorListeners.add(listener);
    return disposable(this.errorListeners, listener);
  }

  onExit(listener: (event: SeneraTerminalExitEvent) => void): SeneraTerminalDisposable {
    this.exitListeners.add(listener);
    if (this.exitEvent) queueMicrotask(() => listener(this.exitEvent as SeneraTerminalExitEvent));
    return disposable(this.exitListeners, listener);
  }

  private async request(
    operation: PendingRequest["operation"],
    createMessage: (requestId: number) => TerminalSidecarClientMessage,
  ): Promise<void> {
    if (this.exitEvent) throw new Error("Terminal sidecar is no longer running.");
    const requestId = ++this.requestId;
    const completion = new Promise<void>((resolve, reject) => {
      this.pending.set(requestId, { operation, resolve, reject });
    });
    await this.send(createMessage(requestId)).catch((error: unknown) => {
      this.pending.delete(requestId);
      throw error;
    });
    return completion;
  }

  private send(message: TerminalSidecarClientMessage): Promise<void> {
    return this.options.channel.write(encodeTerminalSidecarClientMessage(message));
  }

  private receive(data: Buffer): void {
    try {
      for (const message of this.decoder.push(data)) this.project(message);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private project(message: TerminalSidecarServerMessage): void {
    const projectors = {
      ready: (value: Extract<TerminalSidecarServerMessage, { type: "ready" }>) => {
        this._pid = value.pid;
        this.resolveReady();
      },
      output: (value: Extract<TerminalSidecarServerMessage, { type: "output" }>) => {
        if (this.dataListeners.size === 0) this.pendingOutput.push(value.data);
        else for (const listener of this.dataListeners) listener(value.data);
      },
      ack: (value: Extract<TerminalSidecarServerMessage, { type: "ack" }>) => {
        const pending = this.pending.get(value.requestId);
        if (!pending) return;
        this.pending.delete(value.requestId);
        if (pending.operation === value.operation) {
          pending.resolve();
          return;
        }
        pending.reject(new Error(`Terminal sidecar acknowledged ${value.operation}, expected ${pending.operation}.`));
      },
      exit: (value: Extract<TerminalSidecarServerMessage, { type: "exit" }>) => {
        this.emitExit({ exitCode: value.exitCode, signal: value.signal });
      },
      error: (value: Extract<TerminalSidecarServerMessage, { type: "error" }>) => {
        const error = new Error(value.message);
        if (value.requestId) {
          const pending = this.pending.get(value.requestId);
          this.pending.delete(value.requestId);
          pending?.reject(error);
        }
        if (value.fatal) this.fail(error);
      },
    } satisfies {
      [K in TerminalSidecarServerMessage["type"]]: (value: Extract<TerminalSidecarServerMessage, { type: K }>) => void;
    };
    projectors[message.type](message as never);
  }

  private fail(error: Error): void {
    this.rejectReady(error);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const listener of this.errorListeners) listener(error);
  }

  private handleChannelExit(event: SeneraTerminalExitEvent): void {
    this.emitExit(this.exitEvent ?? event);
  }

  private emitExit(event: SeneraTerminalExitEvent): void {
    if (this.exitEvent) return;
    this.exitEvent = event;
    for (const pending of this.pending.values()) pending.reject(new Error("Terminal sidecar exited."));
    this.pending.clear();
    for (const listener of this.exitListeners) listener(event);
  }
}

interface PendingRequest {
  readonly operation: "write" | "resize" | "signal";
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

function disposable<T>(listeners: Set<(event: T) => void>, listener: (event: T) => void): SeneraTerminalDisposable {
  return { dispose: () => void listeners.delete(listener) };
}
