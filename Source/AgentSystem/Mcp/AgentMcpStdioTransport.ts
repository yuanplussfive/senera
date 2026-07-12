import { PassThrough, type Stream } from "node:stream";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";
import type {
  SeneraPersistentProcessChild,
  SeneraPersistentProcessSpawner,
} from "../Execution/SeneraPersistentProcessTypes.js";

export interface AgentMcpStdioTransportOptions {
  command: string;
  args?: readonly string[];
  cwd: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  profile?: SeneraProcessExecutionProfile;
  spawnPersistentProcess: SeneraPersistentProcessSpawner;
  pipeStderr?: boolean;
}

export class AgentMcpStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private readonly readBuffer = new ReadBuffer();
  private readonly stderrStream: PassThrough | null;
  private child: SeneraPersistentProcessChild | undefined;

  constructor(private readonly options: AgentMcpStdioTransportOptions) {
    this.stderrStream = options.pipeStderr === false ? null : new PassThrough();
  }

  get stderr(): Stream | null {
    return this.stderrStream;
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  async start(): Promise<void> {
    if (this.child) {
      throw new Error("MCP stdio transport already started.");
    }

    await new Promise<void>((resolve, reject) => {
      let startSettled = false;
      const settleStart = (callback: () => void): void => {
        if (startSettled) return;
        startSettled = true;
        callback();
      };
      const reportError = (error: Error): void => {
        settleStart(() => reject(error));
        this.onerror?.(error);
      };

      void this.options
        .spawnPersistentProcess(this.options.command, this.options.args ?? [], {
          cwd: this.options.cwd,
          env: {
            ...getDefaultEnvironment(),
            ...(this.options.env ?? {}),
          },
          windowsHide: true,
          signal: this.options.signal,
          profile: this.options.profile,
        })
        .then((child) => {
          this.child = child;
          child.on("error", reportError);
          child.on("close", () => {
            this.child = undefined;
            this.onclose?.();
          });
          child.stdout.on("data", (chunk) => {
            this.readBuffer.append(chunk);
            this.processReadBuffer();
          });
          child.stdout.on("error", reportError);
          child.stderr?.on("data", (chunk) => {
            this.stderrStream?.write(chunk);
          });
          queueMicrotask(() => settleStart(resolve));
        })
        .catch((error: unknown) => {
          settleStart(() => reject(error instanceof Error ? error : new Error(String(error))));
        });
    });
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.readBuffer.clear();
      return;
    }

    this.child = undefined;
    const closePromise = new Promise<void>((resolve) => {
      child.once("close", resolve);
    });

    try {
      child.stdin.end();
    } catch {
      // The process may already be closing; termination below still applies.
    }

    await Promise.race([closePromise, delay(2_000)]);
    if (child.exitCode === null || child.exitCode === undefined) {
      child.kill("SIGTERM");
      await Promise.race([closePromise, delay(2_000)]);
    }
    if (child.exitCode === null || child.exitCode === undefined) {
      child.kill("SIGKILL");
    }

    this.readBuffer.clear();
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve) => {
      const child = this.child;
      if (!child) {
        throw new Error("MCP stdio transport is not connected.");
      }

      const payload = serializeMessage(message);
      if (child.stdin.write(payload)) {
        resolve();
      } else {
        child.stdin.once("drain", resolve);
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
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}
