import { PassThrough, type Stream, type TransformCallback } from "node:stream";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";
import type {
  SeneraPersistentProcessChild,
  SeneraPersistentProcessSpawner,
} from "../Execution/SeneraPersistentProcessTypes.js";
import { SeneraProcessOutputBuffer } from "../Execution/SeneraProcessOutputBuffer.js";

const McpStartupStderrLimitBytes = 16 * 1024;
const McpStartupErrorSummaryChars = 512;
export const AgentMcpDefaultFrameBytes = 64 * 1024 * 1024;
export const AgentMcpDefaultStderrBytes = 1024 * 1024;

const AgentMcpStdioTransportStates = {
  Idle: "idle",
  Starting: "starting",
  Running: "running",
  Closing: "closing",
  Closed: "closed",
} as const;

type AgentMcpStdioTransportState = (typeof AgentMcpStdioTransportStates)[keyof typeof AgentMcpStdioTransportStates];

export class AgentMcpStdioStartupError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null | undefined,
    readonly signal: NodeJS.Signals | null | undefined,
    readonly stderr: string,
  ) {
    const outcome = signal ? `signal ${signal}` : `exit code ${exitCode ?? "unknown"}`;
    const summary = summarizeDiagnostic(stderr);
    super(`MCP stdio server exited during startup with ${outcome}.${summary ? ` stderr: ${summary}` : ""}`);
    this.name = "AgentMcpStdioStartupError";
  }
}

export class AgentMcpStdioTransportCloseError extends Error {
  constructor(
    readonly command: string,
    readonly pid: number | undefined,
    readonly signalFailures: readonly unknown[],
  ) {
    super(`MCP stdio server${pid === undefined ? "" : ` ${pid}`} did not terminate after force kill.`, {
      cause:
        signalFailures.length === 0
          ? undefined
          : signalFailures.length === 1
            ? signalFailures[0]
            : new AggregateError(signalFailures, "MCP stdio termination signals failed."),
    });
    this.name = "AgentMcpStdioTransportCloseError";
  }
}

export interface AgentMcpStdioTransportOptions {
  command: string;
  args?: readonly string[];
  cwd: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  profile?: SeneraProcessExecutionProfile;
  spawnPersistentProcess: SeneraPersistentProcessSpawner;
  terminationGraceMs: number;
  maxFrameBytes?: number;
  maxStderrBytes?: number;
  pipeStderr?: boolean;
}

export class AgentMcpStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private readonly readBuffer = new ReadBuffer();
  private readonly stderrStream: PassThrough | null;
  private readonly maxFrameBytes: number;
  private frameBytes = 0;
  private readonly startupOutput = new SeneraProcessOutputBuffer({
    maxStderrBytes: McpStartupStderrLimitBytes,
  });
  private child: SeneraPersistentProcessChild | undefined;
  private state: AgentMcpStdioTransportState = AgentMcpStdioTransportStates.Idle;
  private spawnPromise: Promise<SeneraPersistentProcessChild> | undefined;
  private startSettlement:
    | {
        settled: boolean;
        resolve(): void;
        reject(error: Error): void;
      }
    | undefined;
  private closePromise: Promise<void> | undefined;
  private transportError: Error | undefined;

  constructor(private readonly options: AgentMcpStdioTransportOptions) {
    assertTerminationGrace(options.terminationGraceMs);
    this.maxFrameBytes = options.maxFrameBytes ?? AgentMcpDefaultFrameBytes;
    const maxStderrBytes = options.maxStderrBytes ?? AgentMcpDefaultStderrBytes;
    assertPositiveBudget(this.maxFrameBytes, "MCP frame bytes");
    assertPositiveBudget(maxStderrBytes, "MCP stderr bytes");
    this.stderrStream = options.pipeStderr === false ? null : new BoundedPassThrough(maxStderrBytes);
  }

  get stderr(): Stream | null {
    return this.stderrStream;
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  start(): Promise<void> {
    if (this.state !== AgentMcpStdioTransportStates.Idle) {
      return Promise.reject(new Error(`MCP stdio transport cannot start from state ${this.state}.`));
    }

    this.state = AgentMcpStdioTransportStates.Starting;
    this.transportError = undefined;
    const started = new Promise<void>((resolve, reject) => {
      this.startSettlement = {
        settled: false,
        resolve,
        reject,
      };
      this.spawnPromise = Promise.resolve().then(() =>
        this.options.spawnPersistentProcess(this.options.command, this.options.args ?? [], {
          cwd: this.options.cwd,
          env: {
            ...getDefaultEnvironment(),
            ...(this.options.env ?? {}),
          },
          windowsHide: true,
          signal: this.options.signal,
          profile: this.options.profile,
        }),
      );
      void this.spawnPromise
        .then((child) => {
          this.bindChild(child);
          setImmediate(() => this.confirmStartup(child));
        })
        .catch((error: unknown) => {
          this.state = AgentMcpStdioTransportStates.Closed;
          this.settleStart("reject", toError(error));
        });
    });
    return started.finally(() => {
      this.startSettlement = undefined;
    });
  }

  close(): Promise<void> {
    if (this.state === AgentMcpStdioTransportStates.Closed) {
      this.readBuffer.clear();
      return Promise.resolve();
    }
    if (this.closePromise) return this.closePromise;

    this.state = AgentMcpStdioTransportStates.Closing;
    this.settleStart(
      "reject",
      new AgentMcpStdioStartupError(this.options.command, undefined, undefined, this.startupOutput.stderr()),
    );
    const closing = this.closeTransport().finally(() => {
      if (this.closePromise === closing) this.closePromise = undefined;
    });
    this.closePromise = closing;
    return closing;
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = this.child;
      if (!child || this.state !== AgentMcpStdioTransportStates.Running) {
        reject(new Error("MCP stdio transport is not connected."));
        return;
      }

      const payload = serializeMessage(message);
      let settled = false;
      const finish = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        child.stdin.off?.("drain", onDrain);
        child.stdin.off?.("error", onError);
        child.off?.("close", onClose);
        if (error) reject(error);
        else resolve();
      };
      const onDrain = (): void => finish();
      const onError = (error: Error): void => finish(error);
      const onClose = (): void =>
        finish(this.transportError ?? new Error("MCP stdio transport closed before stdin drained."));
      child.stdin.on?.("error", onError);
      child.once("close", onClose);
      try {
        if (child.stdin.write(payload)) finish();
        else child.stdin.once("drain", onDrain);
      } catch (error) {
        finish(error);
      }
    });
  }

  private processReadBuffer(): void {
    for (;;) {
      try {
        const message = this.readBuffer.readMessage();
        if (!message) return;
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private bindChild(child: SeneraPersistentProcessChild): void {
    this.child = child;
    child.on("error", (error) => this.reportError(error));
    child.stdin.on?.("error", (error) => {
      if (this.state !== AgentMcpStdioTransportStates.Closing || !isExpectedPipeClosureError(error)) {
        this.reportError(error);
      }
    });
    child.on("close", (exitCode, signal) => this.handleChildClose(child, exitCode, signal));
    child.stdout.on("data", (chunk) => {
      if (!this.acceptFrameBytes(chunk)) {
        this.reportError(new Error(`MCP stdio frame exceeded ${this.maxFrameBytes} bytes.`));
        return;
      }
      this.readBuffer.append(chunk);
      this.processReadBuffer();
    });
    child.stdout.on("error", (error) => this.reportError(error));
    child.stderr?.on("data", (chunk) => {
      if (this.state === AgentMcpStdioTransportStates.Starting) this.startupOutput.pushStderr(chunk);
      this.stderrStream?.write(chunk);
    });
  }

  private confirmStartup(child: SeneraPersistentProcessChild): void {
    if (this.state !== AgentMcpStdioTransportStates.Starting || this.child !== child) return;
    if (!isRunning(child)) {
      this.state = AgentMcpStdioTransportStates.Closed;
      this.child = undefined;
      this.settleStart("reject", this.startupError(child.exitCode, undefined));
      return;
    }
    this.state = AgentMcpStdioTransportStates.Running;
    this.settleStart("resolve");
  }

  private handleChildClose(
    child: SeneraPersistentProcessChild,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.child === child) this.child = undefined;
    const starting = this.state === AgentMcpStdioTransportStates.Starting;
    this.state = AgentMcpStdioTransportStates.Closed;
    if (starting) this.settleStart("reject", this.startupError(exitCode, signal));
    this.onclose?.();
  }

  private reportError(error: Error): void {
    this.transportError ??= error;
    if (this.state === AgentMcpStdioTransportStates.Starting) {
      this.settleStart("reject", error);
      void this.close().catch((closeError: unknown) => this.onerror?.(toError(closeError)));
    }
    if (this.state === AgentMcpStdioTransportStates.Running) {
      void this.close().catch((closeError: unknown) => this.onerror?.(toError(closeError)));
    }
    this.onerror?.(error);
  }

  private acceptFrameBytes(chunk: Uint8Array): boolean {
    for (const byte of chunk) {
      if (byte === 0x0a) {
        this.frameBytes = 0;
        continue;
      }
      this.frameBytes += 1;
      if (this.frameBytes > this.maxFrameBytes) return false;
    }
    return true;
  }

  private settleStart(action: "resolve", error?: never): void;
  private settleStart(action: "reject", error: Error): void;
  private settleStart(action: "resolve" | "reject", error?: Error): void {
    const settlement = this.startSettlement;
    if (!settlement || settlement.settled) return;
    settlement.settled = true;
    if (action === "resolve") settlement.resolve();
    else settlement.reject(error!);
  }

  private startupError(
    exitCode: number | null | undefined,
    signal: NodeJS.Signals | null | undefined,
  ): AgentMcpStdioStartupError {
    return new AgentMcpStdioStartupError(this.options.command, exitCode, signal, this.startupOutput.stderr());
  }

  private async closeTransport(): Promise<void> {
    const child = this.child ?? (await this.spawnPromise?.catch(() => undefined));
    if (!child) {
      this.state = AgentMcpStdioTransportStates.Closed;
      this.readBuffer.clear();
      return;
    }

    try {
      child.stdin.end();
    } catch {
      // The process may already be closing; termination below still applies.
    }

    const signalFailures: unknown[] = [];
    if (await waitForClose(child, this.options.terminationGraceMs)) {
      this.finishClose(child);
      return;
    }
    tryKill(child, "SIGTERM", signalFailures);
    if (await waitForClose(child, this.options.terminationGraceMs)) {
      this.finishClose(child);
      return;
    }
    tryKill(child, "SIGKILL", signalFailures);
    if (await waitForClose(child, this.options.terminationGraceMs)) {
      this.finishClose(child);
      return;
    }
    throw new AgentMcpStdioTransportCloseError(this.options.command, child.pid, signalFailures);
  }

  private finishClose(child: SeneraPersistentProcessChild): void {
    if (this.child === child) this.child = undefined;
    this.state = AgentMcpStdioTransportStates.Closed;
    this.readBuffer.clear();
  }
}

function isExpectedPipeClosureError(error: Error): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EPIPE" || code === "ECONNRESET" || code === "ERR_STREAM_DESTROYED";
}

async function waitForClose(child: SeneraPersistentProcessChild, timeoutMs: number): Promise<boolean> {
  if (!isRunning(child)) return true;
  const closePromise = new Promise<void>((resolve) => child.once("close", resolve));
  await Promise.race([closePromise, delay(timeoutMs)]);
  return !isRunning(child);
}

function isRunning(child: SeneraPersistentProcessChild): boolean {
  return (
    (child.exitCode === null || child.exitCode === undefined) &&
    (child.signalCode === null || child.signalCode === undefined)
  );
}

function assertTerminationGrace(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`MCP termination grace must be a positive finite number: ${value}`);
  }
}

function assertPositiveBudget(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer.`);
}

class BoundedPassThrough extends PassThrough {
  private retainedBytes = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    const remaining = this.maxBytes - this.retainedBytes;
    if (remaining > 0) {
      const retained = chunk.subarray(0, remaining);
      this.retainedBytes += retained.byteLength;
      this.push(retained);
    }
    callback();
  }
}

function tryKill(child: SeneraPersistentProcessChild, signal: NodeJS.Signals, failures: unknown[]): void {
  try {
    child.kill(signal);
  } catch (error) {
    failures.push(error);
  }
}

function summarizeDiagnostic(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > McpStartupErrorSummaryChars
    ? `${normalized.slice(0, McpStartupErrorSummaryChars)}...`
    : normalized;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}
