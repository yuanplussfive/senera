import { describe, expect, it, vi } from "vitest";
import type { AgentEventSink } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentExecutionResourceBroker } from "../../../Source/AgentSystem/ExecutionResources/AgentExecutionResourceBroker.js";
import type { AgentExecutionResourceLimits } from "../../../Source/AgentSystem/ExecutionResources/AgentExecutionResourceTypes.js";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import type {
  SeneraTerminalChild,
  SeneraTerminalDisposable,
  SeneraTerminalExitEvent,
} from "../../../Source/AgentSystem/Execution/SeneraTerminalTypes.js";
import { SeneraTerminalCapabilityNames } from "../../../Source/AgentSystem/Execution/SeneraTerminalTypes.js";

describe("PTY execution resources", () => {
  it("shares ownership, replay, list, input, resize, and stop controls through the broker", async () => {
    const terminal = new FakeTerminalChild();
    const eventSink = vi.fn();
    const broker = createTerminalBroker(async () => terminal, eventSink);
    const owner = sessionOwner("terminal-session");
    const started = await broker.startTerminal(startRequest(owner));

    expect(started).toEqual(
      expect.objectContaining({
        kind: "terminal",
        terminal: expect.objectContaining({
          backend: "conpty",
          shellDialect: process.platform === "win32" ? "powershell" : "posix-sh",
          requestedBoundary: "local",
          effectiveBoundary: "local",
          columns: 100,
          rows: 28,
        }),
      }),
    );
    expect(eventSink).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "execution.resource.created",
        data: { resource: expect.objectContaining({ resourceId: started.resourceId }) },
      }),
    );
    terminal.emitData("prompt> ");
    expect(broker.inspect(started.resourceId, owner, started.cursor).events).toContainEqual(
      expect.objectContaining({ kind: "output", text: "prompt> " }),
    );

    await broker.write(started.resourceId, owner, Buffer.from("answer\r"));
    await broker.resize(started.resourceId, owner, { columns: 132, rows: 42 });
    expect(terminal.writes).toEqual(["answer\r"]);
    expect(terminal.resizes).toEqual([{ columns: 132, rows: 42 }]);
    expect(eventSink).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "execution.resource.resized",
        data: { resourceId: started.resourceId, columns: 132, rows: 42 },
      }),
    );
    expect(broker.list(owner)).toEqual([
      expect.objectContaining({
        resourceId: started.resourceId,
        events: [],
        terminal: expect.objectContaining({ backend: "conpty", columns: 132, rows: 42 }),
      }),
    ]);

    await broker.stopAll(owner);
    expect(terminal.kills).toEqual(["SIGTERM"]);
    expect(() => broker.inspect(started.resourceId, owner)).toThrowError(
      expect.objectContaining({ code: "execution_resource_not_found" }),
    );
    expect(eventSink).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "execution.resource.removed",
        data: { resourceId: started.resourceId, reason: "stop_all" },
      }),
    );
    await broker.close();
  });

  it("runs an interactive command through the real platform PTY", async () => {
    const executionEnv = new SeneraLocalExecutionEnv({ workspaceRoot: process.cwd() });
    const broker = new AgentExecutionResourceBroker({
      workspaceRoot: process.cwd(),
      limits: resourceLimits(),
    });
    const owner = sessionOwner("real-terminal-session");
    try {
      const started = await broker.startTerminal({
        command: process.execPath,
        args: [
          "-e",
          "process.stdout.write('terminal-ready\\r\\n');process.stdin.once('data',d=>process.stdout.write('terminal-echo:'+d.toString().trim()+'\\r\\n',()=>process.exit(0)))",
        ],
        cwd: process.cwd(),
        executionEnv,
        owner,
        correlation: { sessionId: owner.sessionId, requestId: owner.requestId },
        dimensions: { columns: 90, rows: 25 },
      });
      const ready = await broker.wait(started.resourceId, owner, started.cursor, 5_000);
      expect(outputText(ready)).toContain("terminal-ready");

      await broker.write(started.resourceId, owner, Buffer.from("continue\r"));
      const completed = await waitUntilTerminal(broker, started.resourceId, owner, ready.cursor);
      expect(outputText(completed)).toContain("terminal-echo:continue");
      expect(completed).toEqual(expect.objectContaining({ kind: "terminal", state: "completed", exitCode: 0 }));
    } finally {
      await broker.close();
    }
  }, 10_000);
});

class FakeTerminalChild implements SeneraTerminalChild {
  readonly metadata = {
    requestedBoundary: "local",
    effectiveBoundary: "local",
    backendId: "conpty",
    shellDialect: process.platform === "win32" ? "powershell" : "posix-sh",
    capabilities: [
      SeneraTerminalCapabilityNames.Persistent,
      SeneraTerminalCapabilityNames.InteractiveInput,
      SeneraTerminalCapabilityNames.Resize,
      SeneraTerminalCapabilityNames.Signals,
    ],
  } as const;
  readonly pid = 4242;
  readonly writes: string[] = [];
  readonly resizes: Array<{ columns: number; rows: number }> = [];
  readonly kills: Array<NodeJS.Signals | undefined> = [];
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: SeneraTerminalExitEvent) => void>();

  async write(data: string | Buffer): Promise<void> {
    this.writes.push(data.toString());
  }

  async resize(columns: number, rows: number): Promise<void> {
    this.resizes.push({ columns, rows });
  }

  async signal(signal: "interrupt" | "terminate" | "kill"): Promise<void> {
    const nativeSignal = {
      interrupt: "SIGINT",
      terminate: "SIGTERM",
      kill: "SIGKILL",
    } as const;
    this.kills.push(nativeSignal[signal]);
    queueMicrotask(() => this.emitExit({ exitCode: 1 }));
  }

  onData(listener: (data: string) => void): SeneraTerminalDisposable {
    this.dataListeners.add(listener);
    return disposable(this.dataListeners, listener);
  }

  onError(): SeneraTerminalDisposable {
    return { dispose() {} };
  }

  onExit(listener: (event: SeneraTerminalExitEvent) => void): SeneraTerminalDisposable {
    this.exitListeners.add(listener);
    return disposable(this.exitListeners, listener);
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }

  emitExit(event: SeneraTerminalExitEvent): void {
    for (const listener of this.exitListeners) listener(event);
  }
}

function disposable<T>(listeners: Set<(event: T) => void>, listener: (event: T) => void): SeneraTerminalDisposable {
  return { dispose: () => void listeners.delete(listener) };
}

function createTerminalBroker(
  spawnTerminal: (...args: never[]) => Promise<SeneraTerminalChild>,
  eventSink?: AgentEventSink,
) {
  return new AgentExecutionResourceBroker({
    workspaceRoot: process.cwd(),
    executionEnv: { spawnTerminal } as never,
    limits: resourceLimits(),
    eventSink,
  });
}

function resourceLimits(): AgentExecutionResourceLimits {
  return {
    maxActive: 4,
    maxBufferedBytes: 8_192,
    maxInputBytes: 1_024,
    maxWaitMs: 5_000,
    idleTtlMs: 60_000,
    terminalTtlMs: 60_000,
    sweepIntervalMs: 60_000,
    terminationGraceMs: 100,
  };
}

function sessionOwner(sessionId: string) {
  return { workspaceRoot: process.cwd(), sessionId, requestId: `request-${sessionId}` };
}

function startRequest(owner: ReturnType<typeof sessionOwner>) {
  return {
    command: "shell",
    args: ["run"],
    cwd: process.cwd(),
    owner,
    correlation: { sessionId: owner.sessionId, requestId: owner.requestId },
    dimensions: { columns: 100, rows: 28 },
  };
}

async function waitUntilTerminal(
  broker: AgentExecutionResourceBroker,
  resourceId: string,
  owner: ReturnType<typeof sessionOwner>,
  cursor: number,
) {
  let snapshot = await broker.wait(resourceId, owner, cursor, 5_000);
  const events = [...snapshot.events];
  while (!new Set(["completed", "failed", "cancelled"]).has(snapshot.state)) {
    snapshot = await broker.wait(resourceId, owner, snapshot.cursor, 5_000);
    events.push(...snapshot.events);
  }
  return { ...snapshot, events };
}

function outputText(snapshot: { events: Array<{ kind: string; text?: string }> }): string {
  return snapshot.events.map((event) => (event.kind === "output" ? event.text : "")).join("");
}
