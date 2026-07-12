import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { withAgentMcpToolClient } from "../Source/AgentSystem/Mcp/AgentMcpToolClient.js";
import type { SeneraProcessExecutionProfile } from "../Source/AgentSystem/Execution/SeneraExecutionProfile.js";
import type {
  SeneraPersistentProcessChild,
  SeneraPersistentProcessSpawner,
  SeneraPersistentProcessSpawnOptions,
} from "../Source/AgentSystem/Execution/SeneraPersistentProcessTypes.js";

async function main(): Promise<void> {
  const profile: SeneraProcessExecutionProfile = {
    name: "verify-mcp",
    kind: "mcp-server",
    backend: "sandbox",
    localFallback: "allow",
    microsandbox: {
      network: "disabled",
      workspaceMount: "readonly",
    },
  };
  const spawned: Array<{
    command: string;
    args: readonly string[];
    cwd: string;
    profile: SeneraProcessExecutionProfile | undefined;
  }> = [];

  const result = await withAgentMcpToolClient(
    {
      server: {
        id: "verify",
        command: "verify-mcp-server",
        args: ["--stdio"],
        cwd: process.cwd(),
      },
      requestTimeoutMs: 5_000,
      executionProfile: profile,
      spawnPersistentProcess: createFakeMcpSpawner(spawned),
    },
    (client) =>
      client.callTool("verify.echo", {
        value: "through-persistent-boundary",
      }),
  );

  assert.deepEqual(spawned, [
    {
      command: "verify-mcp-server",
      args: ["--stdio"],
      cwd: process.cwd(),
      profile,
    },
  ]);
  assert.deepEqual(readRecord(result).content, [
    {
      type: "text",
      text: "through-persistent-boundary",
    },
  ]);

  console.log("MCP persistent process boundary verification passed.");
}

function createFakeMcpSpawner(
  spawned: Array<{
    command: string;
    args: readonly string[];
    cwd: string;
    profile: SeneraProcessExecutionProfile | undefined;
  }>,
): SeneraPersistentProcessSpawner {
  return async (command, args, options) => {
    spawned.push({
      command,
      args: [...args],
      cwd: options.cwd,
      profile: options.profile,
    });
    return new FakeMcpProcess(options);
  };
}

class FakeMcpProcess extends EventEmitter implements SeneraPersistentProcessChild {
  readonly stdout = new FakeReadable();
  readonly stderr = new FakeReadable();
  readonly stdin: SeneraPersistentProcessChild["stdin"];
  exitCode: number | null = null;
  private readonly lines = new JsonLineAccumulator((message) => this.handleMessage(message));

  constructor(private readonly options: SeneraPersistentProcessSpawnOptions) {
    super();
    this.stdin = {
      write: (chunk) => {
        this.lines.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk);
        return true;
      },
      once: (_event, listener) => {
        queueMicrotask(listener);
      },
      end: () => {
        this.close(0);
      },
    };

    options.signal?.addEventListener("abort", () => this.kill("SIGTERM"), { once: true });
  }

  override on(event: "error", listener: (error: Error) => void): this;
  override on(event: "close", listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void): this;
  override on(event: string, listener: Parameters<EventEmitter["on"]>[1]): this {
    return super.on(event, listener);
  }

  override once(event: "close", listener: () => void): this;
  override once(event: string, listener: Parameters<EventEmitter["once"]>[1]): this {
    return super.once(event, listener);
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.close(null, signal ?? "SIGTERM");
    return true;
  }

  private handleMessage(message: Record<string, unknown>): void {
    const handlers = new Map<string, () => void>([
      [
        "initialize",
        () =>
          this.respond(message, {
            protocolVersion: "2025-11-25",
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: "verify-mcp",
              version: "0.0.0",
            },
          }),
      ],
      ["notifications/initialized", () => undefined],
      [
        "tools/call",
        () =>
          this.respond(message, {
            content: [
              {
                type: "text",
                text: readToolValue(message),
              },
            ],
          }),
      ],
    ]);

    const method = typeof message.method === "string" ? message.method : "";
    handlers.get(method)?.();
  }

  private respond(request: Record<string, unknown>, result: Record<string, unknown>): void {
    if (!("id" in request)) return;
    this.stdout.emitData(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result,
      })}\n`,
    );
  }

  private close(exitCode: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = exitCode;
    queueMicrotask(() => this.emit("close", exitCode, signal));
  }
}

class FakeReadable extends EventEmitter {
  on(event: "data", listener: (chunk: Buffer) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  override on(event: string, listener: Parameters<EventEmitter["on"]>[1]): this {
    return super.on(event, listener);
  }

  emitData(value: string): void {
    this.emit("data", Buffer.from(value));
  }
}

class JsonLineAccumulator {
  private buffer = "";

  constructor(private readonly onMessage: (message: Record<string, unknown>) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex < 0) return;
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        this.onMessage(readRecord(JSON.parse(line)));
      }
    }
  }
}

function readToolValue(message: Record<string, unknown>): string {
  const params = readRecord(message.params);
  const args = readRecord(params.arguments);
  return typeof args.value === "string" ? args.value : "";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

await main();
