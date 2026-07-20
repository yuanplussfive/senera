import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentMcpToolClientPool } from "../Source/AgentSystem/Mcp/AgentMcpToolClientPool.js";
import { SeneraLocalExecutionEnv } from "../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import type { SeneraProcessExecutionProfile } from "../Source/AgentSystem/Execution/SeneraExecutionProfile.js";
import type {
  SeneraPersistentProcessChild,
  SeneraPersistentProcessSpawner,
  SeneraPersistentProcessSpawnOptions,
} from "../Source/AgentSystem/Execution/SeneraPersistentProcessTypes.js";
import { ToolOutputNotificationMethod, ToolPluginEnvironmentVariables } from "@senera/tool-plugin-sdk/protocol";

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
  const cancelledRequestIds: unknown[] = [];
  const waitingCallStarted = deferred<unknown>();

  const pool = new AgentMcpToolClientPool();
  const connection = {
    server: {
      id: "verify",
      command: "verify-mcp-server",
      args: ["--stdio"],
      cwd: process.cwd(),
    },
    requestTimeoutMs: 5_000,
    terminationGraceMs: 100,
    executionProfile: profile,
    spawnPersistentProcess: createFakeMcpSpawner(spawned, cancelledRequestIds, (requestId) =>
      waitingCallStarted.resolve(requestId),
    ),
  };
  const progress: unknown[] = [];
  const output: unknown[] = [];
  const first = await pool.withClient(connection, (client) =>
    client.callTool(
      "verify.echo",
      {
        value: "through-persistent-boundary",
        progress: true,
        output: true,
      },
      {
        correlation: { sessionId: "session-a", requestId: "request-a", toolCallId: "call-a", step: 1 },
        onProgress: (event) => progress.push(event),
        onOutput: (event) => output.push(event),
      },
    ),
  );
  const second = await pool.withClient(connection, (client) =>
    client.callTool("verify.echo", {
      value: "reused-connection",
    }),
  );
  const concurrentOutput = { left: [] as unknown[], right: [] as unknown[] };
  await Promise.all(
    Object.entries(concurrentOutput).map(([value, events]) =>
      pool.withClient(connection, (client) =>
        client.callTool(
          "verify.echo",
          { value, output: true },
          {
            onOutput: (event) => events.push(event),
          },
        ),
      ),
    ),
  );
  const controller = new AbortController();
  const cancelled = pool.withClient(connection, (client) =>
    client.callTool(
      "verify.echo",
      { waitForCancel: true },
      {
        signal: controller.signal,
      },
    ),
  );
  const waitingRequestId = await waitingCallStarted.promise;
  controller.abort(new Error("cancel verification call"));
  await assert.rejects(cancelled);
  const afterCancellation = await pool.withClient(connection, (client) =>
    client.callTool("verify.echo", { value: "connection-survived-cancellation" }),
  );
  const taskStates: unknown[] = [];
  const taskResult = await pool.withClient(connection, (client) =>
    client.callTool(
      "verify.echo",
      { value: "remote-job-result", remoteJob: true },
      {
        task: true,
        onTask: (task) => taskStates.push(task),
      },
    ),
  );
  const taskCancellation = new AbortController();
  const cancelledTasks: unknown[] = [];
  const cancelledTask = pool.withClient(connection, (client) =>
    client.callTool(
      "verify.echo",
      { value: "cancelled-remote-job", remoteJob: true, waitForTaskCancel: true },
      {
        task: true,
        signal: taskCancellation.signal,
        onTask: (task) => {
          cancelledTasks.push(task);
          if (task.status === "working") taskCancellation.abort(new Error("cancel remote job"));
        },
      },
    ),
  );
  await assert.rejects(cancelledTask);
  await pool.close();

  assert.deepEqual(spawned, [
    {
      command: "verify-mcp-server",
      args: ["--stdio"],
      cwd: process.cwd(),
      profile,
    },
  ]);
  assert.deepEqual(readRecord(first).content, [
    {
      type: "text",
      text: "through-persistent-boundary",
    },
  ]);
  assert.deepEqual(readRecord(second).content, [{ type: "text", text: "reused-connection" }]);
  assert.deepEqual(readRecord(afterCancellation).content, [{ type: "text", text: "connection-survived-cancellation" }]);
  assert.deepEqual(readRecord(taskResult).content, [{ type: "text", text: "remote-job-result" }]);
  assert.deepEqual(progress, [{ progress: 1, total: 2, message: "halfway" }]);
  assert.deepEqual(
    output.map((event) => {
      const { outputToken: _outputToken, ...value } = readRecord(event);
      return value;
    }),
    [{ stream: "stdout", text: "streamed-through-persistent-boundary\n", byteLength: 37 }],
  );
  assert.equal(cancelledRequestIds.includes(waitingRequestId), true);
  assert.deepEqual(
    taskStates.map((task) => readRecord(task).status),
    ["working", "completed"],
  );
  assert.equal(
    cancelledTasks.some((task) => readRecord(task).status === "working"),
    true,
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(concurrentOutput).map(([key, events]) => [key, events.map((event) => readRecord(event).text)]),
    ),
    { left: ["streamed-left\n"], right: ["streamed-right\n"] },
  );

  await verifyToolPluginSdkContext();

  console.log("MCP persistent process boundary verification passed.");
}

async function verifyToolPluginSdkContext(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-mcp-sdk-"));
  const serverPath = path.join(root, "server.cjs");
  const cancellationMarkerPath = path.join(root, "remote-cancelled.txt");
  const sdkPath = path.resolve("Packages", "ToolPluginSdk");
  fs.writeFileSync(
    serverPath,
    `
const { runMcpToolSuite, z } = require(${JSON.stringify(sdkPath)});
const { FileTaskStore } = require(${JSON.stringify(path.join(sdkPath, "task-store.js"))});
const taskStore = new FileTaskStore({ rootPath: process.env.TASK_STORE_ROOT });
const contextResult = z.object({ value: z.string(), sessionId: z.string(), requestId: z.string(), toolCallId: z.string() }).strict();
void runMcpToolSuite([
  {
    toolName: "verify.context",
    argumentSchema: z.object({ value: z.string() }).strict(),
    resultSchema: contextResult,
    async execute(args, context) {
      await context.reportProgress({ completed: 1, total: 1, message: "sdk-progress" });
      await context.reportOutput({ stream: "stdout", text: "sdk-output" });
      return {
        value: args.value,
        sessionId: context.sessionId ?? "",
        requestId: context.requestId ?? "",
        toolCallId: context.toolCallId ?? "",
      };
    },
  },
  {
    toolName: "verify.remote",
    argumentSchema: z.object({ value: z.string(), waitForCancel: z.boolean().optional(), fail: z.boolean().optional(), crash: z.boolean().optional() }).strict(),
    resultSchema: contextResult,
    async execute(args, context) {
      if (args.crash) {
        await taskStore.appendTaskEvent(context.taskId, {
          kind: "progress",
          progress: { completed: 0, total: 1, message: "remote-started" },
        });
        await taskStore.appendTaskEvent(context.taskId, {
          kind: "output",
          output: { stream: "stdout", text: "remote-output", byteLength: 13 },
        });
        process.exit(17);
      }
      await context.reportProgress({ completed: 0, total: 1, message: "remote-started" });
      await context.reportOutput({ stream: "stdout", text: "remote-output" });
      if (args.waitForCancel) {
        await new Promise((resolve, reject) => {
          const cancel = () => {
            require("node:fs").writeFileSync(process.env.CANCEL_MARKER, "cancelled", "utf8");
            reject(context.signal.reason ?? new Error("remote task cancelled"));
          };
          if (context.signal.aborted) cancel();
          else context.signal.addEventListener("abort", cancel, { once: true });
        });
      }
      if (args.fail) throw new Error("remote failure: " + args.value);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        value: args.value,
        sessionId: context.sessionId ?? "",
        requestId: context.requestId ?? "",
        toolCallId: context.toolCallId ?? "",
      };
    },
  },
], { taskStore, taskEventStore: taskStore });
`,
    "utf8",
  );
  const executionEnv = new SeneraLocalExecutionEnv({ workspaceRoot: root });
  const progress: unknown[] = [];
  const output: unknown[] = [];
  const remoteProgress: unknown[] = [];
  const remoteOutput: unknown[] = [];
  const remoteTasks: unknown[] = [];
  const pool = new AgentMcpToolClientPool();
  const sdkConnection = {
    server: {
      id: "sdk-context",
      command: process.execPath,
      args: [serverPath],
      cwd: root,
      env: {
        [ToolPluginEnvironmentVariables.RemoteJobTools]: JSON.stringify(["verify.remote"]),
        CANCEL_MARKER: cancellationMarkerPath,
        TASK_STORE_ROOT: path.join(root, "task-state"),
      },
    },
    requestTimeoutMs: 5_000,
    terminationGraceMs: 100,
    executionProfile: {
      name: "verify-mcp-sdk",
      kind: "mcp-server" as const,
      backend: "local" as const,
      localFallback: "deny" as const,
    },
    spawnPersistentProcess: executionEnv.spawnPersistentProcess,
  };
  try {
    const result = await pool.withClient(sdkConnection, (client) =>
      client.callTool(
        "verify.context",
        { value: "sdk-context-ok" },
        {
          correlation: {
            sessionId: "session-sdk",
            requestId: "request-sdk",
            toolCallId: "call-sdk",
            step: 3,
          },
          onProgress: (event) => progress.push(event),
          onOutput: (event) => output.push(event),
        },
      ),
    );
    assert.deepEqual(readRecord(result).structuredContent, {
      value: "sdk-context-ok",
      sessionId: "session-sdk",
      requestId: "request-sdk",
      toolCallId: "call-sdk",
    });
    assert.deepEqual(progress, [{ progress: 1, total: 1, message: "sdk-progress" }]);
    assert.deepEqual(
      output.map((event) => {
        const { outputToken: _outputToken, ...value } = readRecord(event);
        return value;
      }),
      [{ stream: "stdout", text: "sdk-output", byteLength: 10 }],
    );
    const remoteEventCursor = { value: 0 };
    const remoteResult = await pool.withClient(sdkConnection, (client) =>
      client.callTool(
        "verify.remote",
        { value: "sdk-remote-ok" },
        {
          task: true,
          resumableEvents: true,
          taskEventCursor: remoteEventCursor,
          correlation: {
            sessionId: "session-remote",
            requestId: "request-remote",
            toolCallId: "call-remote",
          },
          onProgress: (event) => remoteProgress.push(event),
          onOutput: (event) => remoteOutput.push(event),
          onTask: (task) => remoteTasks.push(task),
        },
      ),
    );
    assert.deepEqual(readRecord(remoteResult).structuredContent, {
      value: "sdk-remote-ok",
      sessionId: "session-remote",
      requestId: "request-remote",
      toolCallId: "call-remote",
    });
    assert.deepEqual(remoteProgress, [{ progress: 0, total: 1, message: "remote-started" }]);
    assert.deepEqual(
      remoteOutput.map((event) => {
        const { outputToken: _outputToken, ...value } = readRecord(event);
        return value;
      }),
      [{ stream: "stdout", text: "remote-output", byteLength: 13 }],
    );
    assert.equal(readRecord(remoteTasks[0]).status, "working");
    assert.equal(readRecord(remoteTasks.at(-1)).status, "completed");
    assert.equal(remoteEventCursor.value, 2);
    const recoveredProgress: unknown[] = [];
    const recoveredOutput: unknown[] = [];
    const recoveredEventCursor = { value: 0 };
    const recoveryOptions = {
      task: true,
      resumableEvents: true,
      taskEventCursor: recoveredEventCursor,
      onProgress: (event: unknown) => recoveredProgress.push(event),
      onOutput: (event: unknown) => recoveredOutput.push(event),
    };
    const recoveredAfterCrash = await pool.withRecoverableTask(
      sdkConnection,
      (client) => client.callTool("verify.remote", { value: "sdk-remote-crash", crash: true }, recoveryOptions),
      recoveryOptions,
    );
    assert.equal(readRecord(recoveredAfterCrash).isError, true);
    assert.equal(readRecord(readRecord(readRecord(recoveredAfterCrash).structuredContent).error).code, "TaskOwnerLost");
    assert.deepEqual(recoveredProgress, [{ progress: 0, total: 1, message: "remote-started" }]);
    assert.deepEqual(recoveredOutput, [{ stream: "stdout", text: "remote-output", byteLength: 13 }]);
    assert.equal(recoveredEventCursor.value, 2);
    const cancellation = new AbortController();
    await assert.rejects(
      pool.withClient(sdkConnection, (client) =>
        client.callTool(
          "verify.remote",
          { value: "sdk-remote-cancel", waitForCancel: true },
          {
            task: true,
            signal: cancellation.signal,
            onTask: (task) => {
              if (task.status === "working") cancellation.abort(new Error("cancel real SDK remote task"));
            },
          },
        ),
      ),
    );
    await waitForFile(cancellationMarkerPath);
    const afterCancellation = await pool.withClient(sdkConnection, (client) =>
      client.callTool("verify.context", { value: "sdk-after-remote-cancel" }),
    );
    assert.equal(readRecord(readRecord(afterCancellation).structuredContent).value, "sdk-after-remote-cancel");
    const failedResult = await pool.withClient(sdkConnection, (client) =>
      client.callTool("verify.remote", { value: "sdk-remote-failure", fail: true }, { task: true }),
    );
    assert.equal(readRecord(failedResult).isError, true);
    assert.match(
      String(readRecord(readRecord(readRecord(failedResult).structuredContent).error).message),
      /remote failure/,
    );
  } finally {
    await pool.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!fs.existsSync(filePath)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${filePath}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function createFakeMcpSpawner(
  spawned: Array<{
    command: string;
    args: readonly string[];
    cwd: string;
    profile: SeneraProcessExecutionProfile | undefined;
  }>,
  cancelledRequestIds: unknown[],
  onWaitingCall: (requestId: unknown) => void,
): SeneraPersistentProcessSpawner {
  return async (command, args, options) => {
    spawned.push({
      command,
      args: [...args],
      cwd: options.cwd,
      profile: options.profile,
    });
    return new FakeMcpProcess(options, cancelledRequestIds, onWaitingCall);
  };
}

class FakeMcpProcess extends EventEmitter implements SeneraPersistentProcessChild {
  readonly stdout = new FakeReadable();
  readonly stderr = new FakeReadable();
  readonly stdin: SeneraPersistentProcessChild["stdin"];
  exitCode: number | null = null;
  private readonly lines = new JsonLineAccumulator((message) => this.handleMessage(message));
  private readonly tasks = new Map<
    string,
    { request: Record<string, unknown>; status: "working" | "completed" | "cancelled"; waitForCancel: boolean }
  >();
  private taskSequence = 0;

  constructor(
    private readonly options: SeneraPersistentProcessSpawnOptions,
    private readonly cancelledRequestIds: unknown[],
    private readonly onWaitingCall: (requestId: unknown) => void,
  ) {
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
              tasks: {
                list: {},
                cancel: {},
                requests: { tools: { call: {} } },
              },
            },
            serverInfo: {
              name: "verify-mcp",
              version: "0.0.0",
            },
          }),
      ],
      ["notifications/initialized", () => undefined],
      ["notifications/cancelled", () => this.cancelledRequestIds.push(readRecord(message.params).requestId)],
      ["tools/call", () => this.handleToolCall(message)],
      ["tasks/get", () => this.handleTaskGet(message)],
      ["tasks/result", () => this.handleTaskResult(message)],
      ["tasks/cancel", () => this.handleTaskCancel(message)],
    ]);

    const method = typeof message.method === "string" ? message.method : "";
    handlers.get(method)?.();
  }

  private handleToolCall(message: Record<string, unknown>): void {
    const params = readRecord(message.params);
    const args = readRecord(params.arguments);
    if (args.remoteJob === true) {
      const taskId = `task-${++this.taskSequence}`;
      this.tasks.set(taskId, {
        request: message,
        status: "working",
        waitForCancel: args.waitForTaskCancel === true,
      });
      this.respond(message, { task: this.projectTask(taskId, "working") });
      return;
    }
    if (args.waitForCancel === true) {
      this.onWaitingCall(message.id);
      return;
    }
    if (args.progress === true) {
      const progressToken = readRecord(params._meta).progressToken;
      this.stdout.emitData(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progressToken, progress: 1, total: 2, message: "halfway" },
        })}\n`,
      );
      queueMicrotask(() => {
        this.emitToolOutput(message, args);
        this.respondToolResult(message);
      });
      return;
    }
    this.emitToolOutput(message, args);
    this.respondToolResult(message);
  }

  private handleTaskGet(message: Record<string, unknown>): void {
    const taskId = String(readRecord(message.params).taskId ?? "");
    const task = this.tasks.get(taskId);
    if (!task) return this.respond(message, this.projectTask(taskId, "cancelled"));
    if (!task.waitForCancel && task.status === "working") task.status = "completed";
    this.respond(message, this.projectTask(taskId, task.status));
  }

  private handleTaskResult(message: Record<string, unknown>): void {
    const taskId = String(readRecord(message.params).taskId ?? "");
    const task = this.tasks.get(taskId);
    if (!task) return this.respond(message, { isError: true, content: [{ type: "text", text: "missing task" }] });
    this.respondToolResult(task.request, message.id);
  }

  private handleTaskCancel(message: Record<string, unknown>): void {
    const taskId = String(readRecord(message.params).taskId ?? "");
    const task = this.tasks.get(taskId);
    if (task) task.status = "cancelled";
    this.respond(message, this.projectTask(taskId, "cancelled"));
  }

  private projectTask(taskId: string, status: "working" | "completed" | "cancelled") {
    const timestamp = "2026-07-17T00:00:00.000Z";
    return {
      taskId,
      status,
      ttl: 60_000,
      createdAt: timestamp,
      lastUpdatedAt: timestamp,
      pollInterval: 1,
    };
  }

  private emitToolOutput(message: Record<string, unknown>, args: Record<string, unknown>): void {
    if (args.output !== true) return;
    const params = readRecord(message.params);
    const metadata = readRecord(readRecord(params._meta).senera);
    const outputToken = metadata.outputToken;
    const text = `streamed-${readToolValue(message)}\n`;
    this.stdout.emitData(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: ToolOutputNotificationMethod,
        params: { outputToken, stream: "stdout", text, byteLength: Buffer.byteLength(text) },
      })}\n`,
    );
  }

  private respondToolResult(message: Record<string, unknown>, responseId: unknown = message.id): void {
    this.respondWithId(responseId, {
      content: [{ type: "text", text: readToolValue(message) }],
    });
  }

  private respond(request: Record<string, unknown>, result: Record<string, unknown>): void {
    if (!("id" in request)) return;
    this.respondWithId(request.id, result);
  }

  private respondWithId(id: unknown, result: Record<string, unknown>): void {
    this.stdout.emitData(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id,
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

await main();
