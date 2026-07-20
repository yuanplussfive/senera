import { StringDecoder } from "node:string_decoder";
import { AgentEventKinds, emitAgentEvent } from "../Events/AgentEvent.js";
import { AgentExecutionResourceError, AgentExecutionResourceErrorCodes } from "./AgentExecutionResourceError.js";
import {
  AgentExecutionResourceSignals,
  AgentExecutionResourceStates,
  type AgentExecutionResourceCorrelation,
  type AgentExecutionResourceEvent,
  type AgentExecutionResourceHandle,
  type AgentExecutionResourceLimits,
  type AgentExecutionResourceOwner,
  type AgentExecutionResourceSignal,
  type AgentExecutionResourceSnapshot,
  type AgentExecutionResourceState,
} from "./AgentExecutionResourceTypes.js";
import type { AgentExecutionResourceDomainEvent } from "./AgentExecutionResourceEventTypes.js";
import type {
  AgentExecutionResourceExitSignal,
  AgentExecutionResourceTransport,
} from "./AgentExecutionResourceTransport.js";

export interface AgentProcessExecutionResourceOptions {
  id: string;
  owner: AgentExecutionResourceOwner;
  correlation: AgentExecutionResourceCorrelation;
  transport: AgentExecutionResourceTransport;
  command: string;
  cwd: string;
  limits: AgentExecutionResourceLimits;
  now?: () => number;
}

export class AgentProcessExecutionResource implements AgentExecutionResourceHandle {
  readonly id: string;
  readonly owner: AgentExecutionResourceOwner;
  private readonly correlation: AgentExecutionResourceCorrelation;
  private readonly command: string;
  private readonly cwd: string;
  private readonly limits: AgentExecutionResourceLimits;
  private readonly now: () => number;
  private readonly createdAt: number;
  private readonly decoders = {
    stdout: new StringDecoder("utf8"),
    stderr: new StringDecoder("utf8"),
  };
  private readonly waiters = new Set<() => void>();
  private events: AgentExecutionResourceEvent[] = [];
  private bufferedBytes = 0;
  private nextCursor = 0;
  private stdoutBytes = 0;
  private stderrBytes = 0;
  private _state: AgentExecutionResourceState = AgentExecutionResourceStates.Starting;
  private _lastAccessedAt: number;
  private updatedAt: number;
  private exitCode?: number | null;
  private exitSignal?: AgentExecutionResourceExitSignal;
  private error?: string;
  private cancellationRequested = false;
  private resourceClosed = false;
  private projection: Promise<void> = Promise.resolve();

  constructor(
    options: AgentProcessExecutionResourceOptions,
    private readonly transport = options.transport,
  ) {
    this.id = options.id;
    this.owner = options.owner;
    this.correlation = options.correlation;
    this.command = options.command;
    this.cwd = options.cwd;
    this.limits = options.limits;
    this.now = options.now ?? Date.now;
    this.createdAt = this.now();
    this.updatedAt = this.createdAt;
    this._lastAccessedAt = this.createdAt;
    this.bindTransport();
    this.transition(AgentExecutionResourceStates.Running);
  }

  get state(): AgentExecutionResourceState {
    return this._state;
  }

  get terminal(): boolean {
    return TerminalStates.has(this._state);
  }

  get closed(): boolean {
    return this.resourceClosed;
  }

  get lastAccessedAt(): number {
    return this._lastAccessedAt;
  }

  inspect(cursor = 0): AgentExecutionResourceSnapshot {
    this.touch();
    const oldestCursor = this.events[0]?.cursor ?? this.nextCursor + 1;
    return {
      resourceId: this.id,
      kind: this.transport.kind,
      state: this._state,
      command: this.command,
      cwd: this.cwd,
      pid: this.transport.pid,
      createdAt: new Date(this.createdAt).toISOString(),
      updatedAt: new Date(this.updatedAt).toISOString(),
      cursor: this.nextCursor,
      oldestCursor,
      truncated: cursor < oldestCursor - 1,
      events: this.events.filter((event) => event.cursor > cursor).map((event) => ({ ...event })),
      exitCode: this.exitCode,
      signal: this.exitSignal,
      error: this.error,
      terminal: this.transport.terminalMetadata,
    };
  }

  async wait(cursor: number, timeoutMs: number, signal?: AbortSignal): Promise<AgentExecutionResourceSnapshot> {
    this.touch();
    if (this.nextCursor !== cursor || this.terminal || timeoutMs === 0) return this.inspect(cursor);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.waiters.delete(onChange);
        signal?.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve();
      };
      const onChange = (): void => finish();
      const onAbort = (): void => finish(signal?.reason ?? new Error("aborted"));
      const timer = setTimeout(onChange, timeoutMs);
      timer.unref();
      this.waiters.add(onChange);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
    return this.inspect(cursor);
  }

  async write(input: Uint8Array): Promise<AgentExecutionResourceSnapshot> {
    this.touch();
    if (this.terminal) {
      throw new AgentExecutionResourceError(
        AgentExecutionResourceErrorCodes.NotWritable,
        `Execution resource ${this.id} is no longer writable.`,
        { resourceId: this.id, state: this._state },
      );
    }
    try {
      await this.transport.write(input);
    } catch (error) {
      throw new AgentExecutionResourceError(
        AgentExecutionResourceErrorCodes.NotWritable,
        `Execution resource ${this.id} rejected input.`,
        { resourceId: this.id, cause: error instanceof Error ? error.message : String(error) },
      );
    }
    return this.inspect(this.nextCursor);
  }

  async resize(columns: number, rows: number): Promise<AgentExecutionResourceSnapshot> {
    this.touch();
    if (
      this.terminal ||
      this.transport.kind !== "terminal" ||
      !this.transport.terminalMetadata?.capabilities.includes("resize")
    ) {
      throw new AgentExecutionResourceError(
        AgentExecutionResourceErrorCodes.NotResizable,
        `Execution resource ${this.id} cannot be resized.`,
        { resourceId: this.id, kind: this.transport.kind, state: this._state },
      );
    }
    await this.transport.resize({ columns, rows });
    return this.inspect(this.nextCursor);
  }

  async signal(signal: AgentExecutionResourceSignal): Promise<AgentExecutionResourceSnapshot> {
    this.touch();
    if (this.resourceClosed) return this.inspect(this.nextCursor);
    this.cancellationRequested = true;
    await this.transport.signal(signal);
    return this.inspect(this.nextCursor);
  }

  async close(): Promise<void> {
    if (this.resourceClosed) return;
    this.cancellationRequested = true;
    await this.transport.close(this.limits.terminationGraceMs);
    if (!this.resourceClosed) {
      throw new AgentExecutionResourceError(
        AgentExecutionResourceErrorCodes.CleanupFailed,
        `Execution resource ${this.id} did not confirm process termination.`,
        { resourceId: this.id, state: this._state, pid: this.transport.pid },
      );
    }
  }

  private bindTransport(): void {
    this.transport.onOutput((stream, chunk) => this.appendOutput(stream, chunk));
    this.transport.onError((error) => this.fail(error));
    this.transport.onClose((exitCode, signal) => {
      this.resourceClosed = true;
      this.wakeWaiters();
      this.flushDecoders();
      this.exitCode = exitCode;
      this.exitSignal = signal;
      this.transition(
        this.cancellationRequested ? AgentExecutionResourceStates.Cancelled : AgentExecutionResourceStates.Completed,
        signal ? `signal:${signal}` : `exit:${exitCode ?? "unknown"}`,
      );
    });
  }

  private appendOutput(stream: "stdout" | "stderr", chunk: Buffer): void {
    if (this.terminal) return;
    if (stream === "stdout") this.stdoutBytes += chunk.byteLength;
    else this.stderrBytes += chunk.byteLength;
    const text = this.decoders[stream].write(chunk);
    if (!text) return;
    const totalBytes = stream === "stdout" ? this.stdoutBytes : this.stderrBytes;
    const bounded = boundOutputText(text, this.limits.maxBufferedBytes);
    const event = {
      cursor: ++this.nextCursor,
      timestamp: new Date(this.now()).toISOString(),
      kind: "output",
      stream,
      text: bounded.text,
      byteLength: chunk.byteLength,
      totalBytes,
      truncated: bounded.truncated || undefined,
    } as const;
    this.appendEvent(event, bounded.byteLength);
    this.project({
      kind: AgentEventKinds.ExecutionResourceOutput,
      context: this.eventContext(),
      data: {
        resourceId: this.id,
        toolCallId: this.correlation.toolCallId,
        toolName: this.correlation.toolName,
        cursor: event.cursor,
        stream,
        text: bounded.text,
        byteLength: event.byteLength,
        totalBytes,
        truncated: bounded.truncated || undefined,
      },
    });
  }

  private flushDecoders(): void {
    for (const stream of ["stdout", "stderr"] as const) {
      const text = this.decoders[stream].end();
      if (!text) continue;
      const totalBytes = stream === "stdout" ? this.stdoutBytes : this.stderrBytes;
      const bounded = boundOutputText(text, this.limits.maxBufferedBytes);
      const event = {
        cursor: ++this.nextCursor,
        timestamp: new Date(this.now()).toISOString(),
        kind: "output",
        stream,
        text: bounded.text,
        byteLength: 0,
        totalBytes,
        truncated: bounded.truncated || undefined,
      } as const;
      this.appendEvent(event, bounded.byteLength);
      this.project({
        kind: AgentEventKinds.ExecutionResourceOutput,
        context: this.eventContext(),
        data: {
          resourceId: this.id,
          toolCallId: this.correlation.toolCallId,
          toolName: this.correlation.toolName,
          cursor: event.cursor,
          stream,
          text: bounded.text,
          byteLength: 0,
          totalBytes,
          truncated: bounded.truncated || undefined,
        },
      });
    }
  }

  private fail(error: unknown): void {
    if (this.terminal) return;
    this.error = error instanceof Error ? error.message : String(error);
    this.transition(AgentExecutionResourceStates.Failed, this.error);
    void this.transport.signal(AgentExecutionResourceSignals.Terminate).catch(() => undefined);
  }

  private transition(state: AgentExecutionResourceState, reason?: string): void {
    if (this.terminal || this._state === state) return;
    this._state = state;
    const event: AgentExecutionResourceEvent = {
      cursor: ++this.nextCursor,
      timestamp: new Date(this.now()).toISOString(),
      kind: "state",
      state,
      reason,
    };
    this.appendEvent(event, 0);
    this.project({
      kind: AgentEventKinds.ExecutionResourceState,
      context: this.eventContext(),
      data: {
        resourceId: this.id,
        toolCallId: this.correlation.toolCallId,
        toolName: this.correlation.toolName,
        cursor: event.cursor,
        state,
        pid: this.transport.pid,
        exitCode: this.exitCode,
        signal: this.exitSignal,
        reason,
      },
    });
  }

  private appendEvent(event: AgentExecutionResourceEvent, byteLength: number): void {
    this.events.push(event);
    this.bufferedBytes += byteLength;
    while (this.bufferedBytes > this.limits.maxBufferedBytes && this.events.length > 1) {
      const removed = this.events.shift();
      if (removed?.kind === "output") this.bufferedBytes -= Buffer.byteLength(removed.text);
    }
    this.updatedAt = this.now();
    this.wakeWaiters();
  }

  private project(event: AgentExecutionResourceDomainEvent): void {
    this.projection = this.projection
      .then(() => emitAgentEvent(this.correlation.onEvent, event))
      .catch(() => undefined);
  }

  private eventContext(): AgentExecutionResourceDomainEvent["context"] {
    return {
      sessionId: this.correlation.sessionId,
      requestId: this.correlation.requestId,
      step: this.correlation.step,
    };
  }

  private touch(): void {
    this._lastAccessedAt = this.now();
  }

  private wakeWaiters(): void {
    for (const wake of [...this.waiters]) wake();
  }
}

function boundOutputText(text: string, maxBytes: number): { text: string; byteLength: number; truncated: boolean } {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength <= maxBytes) return { text, byteLength: bytes.byteLength, truncated: false };
  const bounded = bytes.subarray(bytes.byteLength - maxBytes);
  const normalized = bounded.toString("utf8").replace(/^\uFFFD/u, "");
  return { text: normalized, byteLength: Buffer.byteLength(normalized), truncated: true };
}

const TerminalStates = new Set<AgentExecutionResourceState>([
  AgentExecutionResourceStates.Completed,
  AgentExecutionResourceStates.Failed,
  AgentExecutionResourceStates.Cancelled,
]);
