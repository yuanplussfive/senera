import net from "node:net";
import { once } from "node:events";
import { AgentSandboxWorkerFrameDecoder, encodeAgentSandboxWorkerFrame } from "./AgentSandboxWorkerFraming.js";
import {
  AgentSandboxWorkerClientMessageSchema,
  AgentSandboxWorkerProtocolVersion,
  AgentSandboxWorkerServerMessageSchema,
  type AgentSandboxExecutionRequest,
  type AgentSandboxWorkerClientMessage,
  type AgentSandboxWorkerServerMessage,
} from "./AgentSandboxWorkerProtocol.js";
import type {
  SeneraSandboxProcessEvent,
  SeneraSandboxProcessHandle,
  SeneraSandboxRuntimeProbe,
  SeneraSandboxWorkerClient,
} from "../../Execution/SeneraSandboxWorkerTypes.js";
import type { AgentSandboxPreparationProgress } from "../AgentSandboxRuntimeTypes.js";
import { toError } from "../../Core/AgentErrors.js";

export interface AgentSandboxWorkerClientOptions {
  endpoint: string;
}

export class AgentSandboxWorkerClient implements SeneraSandboxWorkerClient {
  constructor(private readonly options: AgentSandboxWorkerClientOptions) {}

  probe(input: { timeoutMs: number }): Promise<SeneraSandboxRuntimeProbe> {
    return this.requestCompletion(
      {
        type: "probe",
        protocolVersion: AgentSandboxWorkerProtocolVersion,
      },
      input.timeoutMs,
    ).then((message) => {
      if (message.type !== "probe.result") throw unexpectedMessage("probe.result", message);
      return message;
    });
  }

  async prepare(input: {
    timeoutMs: number;
    onProgress?: (progress: AgentSandboxPreparationProgress) => void;
  }): Promise<void> {
    const message = await this.requestCompletion(
      {
        type: "prepare",
        protocolVersion: AgentSandboxWorkerProtocolVersion,
      },
      input.timeoutMs,
      input.onProgress,
    );
    if (message.type !== "prepared") throw unexpectedMessage("prepared", message);
  }

  async start(request: AgentSandboxExecutionRequest): Promise<SeneraSandboxProcessHandle> {
    const socket = await connectEndpoint(this.options.endpoint, request.limits.timeoutMs);
    const decoder = new AgentSandboxWorkerFrameDecoder();
    const events = new AsyncEventQueue<SeneraSandboxProcessEvent>();
    let sandboxId: string | undefined;
    let readyResolve!: (value: string) => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<string>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const fail = (error: Error): void => {
      if (!sandboxId) readyReject(error);
      events.fail(error);
    };
    socket.on("data", (chunk) => {
      try {
        for (const value of decoder.push(Buffer.from(chunk))) {
          const message = AgentSandboxWorkerServerMessageSchema.parse(value);
          if (message.type === "ready") {
            sandboxId = message.sandboxId;
            readyResolve(message.sandboxId);
          } else if (message.type === "output") {
            events.push({ kind: "output", stream: message.stream, data: Buffer.from(message.data, "base64") });
          } else if (message.type === "exit") {
            events.push({
              kind: "exit",
              code: message.exitCode,
              signal: normalizeSignal(message.signal),
            });
            events.end();
          } else if (message.type === "error") {
            fail(workerError(message));
          }
        }
      } catch (error) {
        fail(toError(error));
      }
    });
    socket.once("error", (error) => fail(error));
    socket.once("close", () => {
      if (!events.settled) fail(new Error("Sandbox worker connection closed before execution completed."));
    });
    const startup = withOptionalDeadline(
      ready,
      request.limits.timeoutMs,
      () => new Error(`Sandbox worker did not become ready within ${request.limits.timeoutMs}ms.`),
      () => socket.destroy(),
    );
    let id: string;
    try {
      await writeFrame(socket, {
        type: "start",
        protocolVersion: AgentSandboxWorkerProtocolVersion,
        request,
      });
      id = await startup;
    } catch (error) {
      socket.destroy();
      void startup.catch(() => undefined);
      throw error;
    }
    return {
      id,
      events,
      write: (data) => writeFrame(socket, { type: "input", data: Buffer.from(data).toString("base64") }),
      endInput: () => writeFrame(socket, { type: "end_input" }),
      terminate: (signal) => writeFrame(socket, { type: "terminate", signal }),
    };
  }

  private async requestCompletion(
    request: AgentSandboxWorkerClientMessage,
    timeoutMs: number,
    onProgress?: (progress: AgentSandboxPreparationProgress) => void,
  ): Promise<AgentSandboxWorkerServerMessage> {
    AgentSandboxWorkerClientMessageSchema.parse(request);
    const socket = await connectEndpoint(this.options.endpoint, timeoutMs);
    const decoder = new AgentSandboxWorkerFrameDecoder();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await new Promise<AgentSandboxWorkerServerMessage>((resolve, reject) => {
        if (hasDeadline(timeoutMs)) {
          timer = setTimeout(() => {
            socket.destroy();
            reject(new Error(`Sandbox worker request exceeded ${timeoutMs}ms.`));
          }, timeoutMs);
          timer.unref();
        }
        socket.on("data", (chunk) => {
          try {
            for (const value of decoder.push(Buffer.from(chunk))) {
              const message = AgentSandboxWorkerServerMessageSchema.parse(value);
              if (message.type === "progress") {
                const { type: _type, ...progress } = message;
                onProgress?.(progress);
              } else if (message.type === "error") {
                reject(workerError(message));
              } else {
                resolve(message);
              }
            }
          } catch (error) {
            reject(toError(error));
          }
        });
        socket.once("error", reject);
        socket.once("close", () => reject(new Error("Sandbox worker connection closed before replying.")));
        void writeFrame(socket, request).catch(reject);
      });
    } finally {
      if (timer) clearTimeout(timer);
      socket.destroy();
    }
  }
}

async function connectEndpoint(endpoint: string, timeoutMs: number): Promise<net.Socket> {
  const socket = net.createConnection(endpoint);
  try {
    await withOptionalDeadline(
      Promise.race([once(socket, "connect"), once(socket, "error").then(([error]) => Promise.reject(error))]),
      timeoutMs,
      () => new Error(`Unable to connect to sandbox Worker within ${timeoutMs}ms.`),
      () => socket.destroy(),
    );
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function hasDeadline(timeoutMs: number): boolean {
  return Number.isFinite(timeoutMs) && timeoutMs > 0;
}

async function withOptionalDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  createError: () => Error,
  onTimeout?: () => void,
): Promise<T> {
  if (!hasDeadline(timeoutMs)) return operation;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(createError());
        }, timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function writeFrame(socket: net.Socket, message: AgentSandboxWorkerClientMessage): Promise<void> {
  const frame = encodeAgentSandboxWorkerFrame(AgentSandboxWorkerClientMessageSchema.parse(message));
  if (socket.write(frame)) return;
  await once(socket, "drain");
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{ resolve: (result: IteratorResult<T>) => void; reject: (error: Error) => void }> =
    [];
  private error: Error | undefined;
  settled = false;

  push(value: T): void {
    if (this.settled) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.values.push(value);
  }

  end(): void {
    if (this.settled) return;
    this.settled = true;
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined, done: true });
  }

  fail(error: Error): void {
    if (this.settled) return;
    this.error = error;
    this.settled = true;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.error) return Promise.reject(this.error);
        if (this.settled) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<T>>((resolve, reject) => this.waiters.push({ resolve, reject }));
      },
    };
  }
}

function normalizeSignal(value: string | null): NodeJS.Signals | null {
  return value && value.startsWith("SIG") ? (value as NodeJS.Signals) : null;
}

function workerError(message: Extract<AgentSandboxWorkerServerMessage, { type: "error" }>): Error {
  return Object.assign(new Error(message.message), { code: message.code, details: message.details });
}

function unexpectedMessage(expected: string, actual: AgentSandboxWorkerServerMessage): Error {
  return new Error(`Sandbox worker returned ${actual.type}; expected ${expected}.`);
}
