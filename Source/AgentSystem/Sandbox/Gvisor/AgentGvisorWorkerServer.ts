import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { once } from "node:events";
import { AgentGvisorWorkerFrameDecoder, encodeAgentGvisorWorkerFrame } from "./AgentGvisorWorkerFraming.js";
import {
  AgentGvisorWorkerClientMessageSchema,
  type AgentGvisorWorkerClientMessage,
  type AgentGvisorWorkerServerMessage,
} from "./AgentGvisorWorkerProtocol.js";
import type { AgentGvisorDockerProcess, AgentGvisorDockerRuntime } from "./AgentGvisorDockerRuntime.js";
import { readAgentGvisorRuntimePolicyContract } from "./AgentGvisorRuntimeContract.js";

export interface AgentGvisorWorkerServerOptions {
  socketPath: string;
  runtime: AgentGvisorDockerRuntime;
  socketMode?: number;
  maxConcurrentExecutions?: number;
}

export class AgentGvisorWorkerServer {
  private readonly server: net.Server;
  private readonly maxConcurrentExecutions: number;
  private activeExecutions = 0;
  private preparation: Promise<void> | undefined;

  constructor(private readonly options: AgentGvisorWorkerServerOptions) {
    const contract = readAgentGvisorRuntimePolicyContract();
    this.maxConcurrentExecutions = options.maxConcurrentExecutions ?? contract.limits.maxConcurrentExecutions;
    this.server = net.createServer((socket) => void this.handleConnection(socket));
  }

  async start(): Promise<void> {
    await prepareUnixSocketPath(this.options.socketPath);
    this.server.listen(this.options.socketPath);
    try {
      await once(this.server, "listening");
      await chmod(this.options.socketPath, this.options.socketMode ?? 0o600);
    } catch (error) {
      await this.close().catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.server.listening) {
      this.server.close();
      await once(this.server, "close");
    }
    await unlink(this.options.socketPath).catch(ignoreMissingFile);
  }

  private async handleConnection(socket: net.Socket): Promise<void> {
    const decoder = new AgentGvisorWorkerFrameDecoder();
    try {
      const first = await readFirstMessage(socket, decoder);
      if (first.type === "probe") {
        await this.handleProbe(socket);
        return;
      }
      if (first.type === "prepare") {
        await this.handlePrepare(socket);
        return;
      }
      if (first.type !== "start") throw workerProtocolError("Expected probe, prepare, or start as the first message.");
      if (this.activeExecutions >= this.maxConcurrentExecutions) {
        throw workerError(
          "worker_capacity_exceeded",
          "Docker Engine sandbox worker execution capacity has been reached.",
        );
      }
      this.activeExecutions += 1;
      try {
        await this.handleExecution(socket, decoder, first);
      } finally {
        this.activeExecutions -= 1;
      }
    } catch (error) {
      if (!socket.destroyed) {
        await sendWorkerError(socket, error).catch(() => undefined);
        socket.end();
      }
    }
  }

  private async handleProbe(socket: net.Socket): Promise<void> {
    const result = await this.options.runtime.probe();
    const { provider, ...probe } = result;
    await writeFrame(socket, { type: "probe.result", isolation: provider, ...probe });
    socket.end();
  }

  private async handlePrepare(socket: net.Socket): Promise<void> {
    this.preparation ??= this.options.runtime
      .prepare({
        onProgress: (progress) => {
          void writeFrame(socket, {
            type: "progress",
            ...progress,
          }).catch(() => undefined);
        },
      })
      .finally(() => {
        this.preparation = undefined;
      });
    await this.preparation;
    await writeFrame(socket, { type: "prepared" });
    socket.end();
  }

  private async handleExecution(
    socket: net.Socket,
    decoder: AgentGvisorWorkerFrameDecoder,
    message: Extract<AgentGvisorWorkerClientMessage, { type: "start" }>,
  ): Promise<void> {
    const process = await this.options.runtime.start(message.request);
    let completed = false;
    const onClose = (): void => {
      if (!completed) void process.terminate("kill").catch(() => undefined);
    };
    socket.once("close", onClose);
    const input = consumeExecutionMessages(socket, decoder, process);
    forwardOutput(process.stdout, socket, "stdout");
    forwardOutput(process.stderr, socket, "stderr");
    await writeFrame(socket, { type: "ready", sandboxId: process.id });
    try {
      const exit = await process.completion;
      completed = true;
      await writeFrame(socket, { type: "exit", exitCode: exit.exitCode, signal: exit.signal });
      socket.end();
      await input.catch((error: unknown) => {
        if (!isSocketClosure(error)) throw error;
      });
    } finally {
      completed = true;
      socket.off("close", onClose);
      await process.cleanup();
    }
  }
}

async function readFirstMessage(
  socket: net.Socket,
  decoder: AgentGvisorWorkerFrameDecoder,
): Promise<AgentGvisorWorkerClientMessage> {
  for await (const chunk of socket.iterator({ destroyOnReturn: false })) {
    const frames = decoder.push(chunk);
    if (frames.length === 0) continue;
    if (frames.length > 1) throw workerProtocolError("Only one initial worker message is allowed per frame batch.");
    return AgentGvisorWorkerClientMessageSchema.parse(frames[0]);
  }
  throw workerProtocolError("Connection closed before the initial worker message.");
}

async function consumeExecutionMessages(
  socket: net.Socket,
  decoder: AgentGvisorWorkerFrameDecoder,
  process: AgentGvisorDockerProcess,
): Promise<void> {
  for await (const chunk of socket) {
    for (const frame of decoder.push(chunk)) {
      const message = AgentGvisorWorkerClientMessageSchema.parse(frame);
      if (message.type === "input") {
        const data = Buffer.from(message.data, "base64");
        if (!process.stdin.write(data)) await once(process.stdin, "drain");
      } else if (message.type === "end_input") {
        process.stdin.end();
      } else if (message.type === "terminate") {
        await process.terminate(message.signal);
      } else {
        throw workerProtocolError(`Unexpected ${message.type} message after execution started.`);
      }
    }
  }
}

function forwardOutput(output: NodeJS.ReadableStream, socket: net.Socket, stream: "stdout" | "stderr"): void {
  output.on("data", (chunk: Buffer | string) => {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const accepted = socket.write(
      encodeAgentGvisorWorkerFrame({ type: "output", stream, data: data.toString("base64") }),
    );
    if (!accepted && "pause" in output && typeof output.pause === "function") {
      output.pause();
      socket.once("drain", () => {
        if ("resume" in output && typeof output.resume === "function") output.resume();
      });
    }
  });
}

async function writeFrame(socket: net.Socket, message: AgentGvisorWorkerServerMessage): Promise<void> {
  if (socket.write(encodeAgentGvisorWorkerFrame(message))) return;
  await once(socket, "drain");
}

async function sendWorkerError(socket: net.Socket, error: unknown): Promise<void> {
  const resolved = resolveWorkerError(error);
  await writeFrame(socket, {
    type: "error",
    code: resolved.code,
    message: resolved.message,
  });
}

async function prepareUnixSocketPath(socketPath: string): Promise<void> {
  if (process.platform === "win32") {
    if (!socketPath.startsWith("\\\\.\\pipe\\")) {
      throw new Error("Windows gVisor worker sockets must use a named pipe path.");
    }
    return;
  }
  if (!path.isAbsolute(socketPath)) throw new Error("gVisor worker socket path must be absolute.");
  await mkdir(path.dirname(socketPath), { recursive: true });
  try {
    const existing = await lstat(socketPath);
    if (!existing.isSocket()) throw new Error(`Refusing to replace non-socket path: ${socketPath}`);
    await unlink(socketPath);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
}

function workerProtocolError(message: string): Error {
  return workerError("invalid_worker_protocol", message);
}

function workerError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function resolveWorkerError(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? error.code : "gvisor_worker_failed";
    return { code, message: error.message };
  }
  return { code: "gvisor_worker_failed", message: String(error) };
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function ignoreMissingFile(error: unknown): void {
  if (!isMissingFile(error)) throw error;
}

function isSocketClosure(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    ["ECONNRESET", "ERR_STREAM_PREMATURE_CLOSE"].includes(String(error.code))
  );
}
