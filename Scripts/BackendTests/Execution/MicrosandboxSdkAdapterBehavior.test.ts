import { describe, expect, it, vi } from "vitest";
import { SeneraMicrosandboxDynamicSdkAdapter } from "../../../Source/AgentSystem/Execution/SeneraMicrosandboxSdkAdapter.js";
import type {
  SeneraMicrosandboxCreateRequest,
  SeneraMicrosandboxTerminalEvent,
} from "../../../Source/AgentSystem/Execution/SeneraMicrosandboxTypes.js";

describe("microsandbox SDK adapter", () => {
  it("delegates runtime readiness to Senera instead of reading the SDK installation flag", async () => {
    const isInstalled = vi.fn(() => false);
    const sandbox = {
      execStreamWith: vi.fn(),
      stopWithTimeout: vi.fn(async () => undefined),
      kill: vi.fn(async () => undefined),
    };
    const module = { ...fakeMicrosandboxModule(sandbox), isInstalled };
    const adapter = new SeneraMicrosandboxDynamicSdkAdapter(async () => module as never);

    await expect(adapter.createSandbox(createRequest())).resolves.toBeDefined();
    expect(isInstalled).not.toHaveBeenCalled();
  });

  it("preserves native TTY output events that the public SDK normalizer omits", async () => {
    const rawEvents: unknown[] = [
      { eventType: "started", pid: 42 },
      { eventType: "output", data: Buffer.from("terminal-output") },
      { eventType: "exited", code: 0 },
      null,
    ];
    const rawRecv = vi.fn(async () => rawEvents.shift());
    const publicRecv = vi.fn(async () => {
      throw new Error("public normalized receiver must not be used for TTY events");
    });
    const handle = {
      inner: { recv: rawRecv },
      recv: publicRecv,
      takeStdin: vi.fn(async () => ({ write: vi.fn(async () => undefined) })),
      signal: vi.fn(async () => undefined),
      kill: vi.fn(async () => undefined),
    };
    const sandbox = {
      execStreamWith: vi.fn(async (_command: string, configure: (builder: FakeExecBuilder) => FakeExecBuilder) => {
        configure(new FakeExecBuilder());
        return handle;
      }),
      stopWithTimeout: vi.fn(async () => undefined),
      kill: vi.fn(async () => undefined),
    };
    const module = fakeMicrosandboxModule(sandbox);
    const adapter = new SeneraMicrosandboxDynamicSdkAdapter(async () => module as never);
    const session = await adapter.createSandbox(createRequest());
    const terminal = await session.openTerminal!({
      command: "/bin/sh",
      args: ["-lc", "printf terminal-output"],
      cwd: "/workspace",
      env: {},
    });

    const events: SeneraMicrosandboxTerminalEvent[] = [];
    for await (const event of terminal.events) events.push(event);

    expect(events).toEqual([
      { kind: "started", pid: 42 },
      { kind: "output", stream: "stdout", data: Buffer.from("terminal-output") },
      { kind: "exit", code: 0 },
    ]);
    expect(rawRecv).toHaveBeenCalledTimes(4);
    expect(publicRecv).not.toHaveBeenCalled();
  });
});

class FakeExecBuilder {
  args(): this {
    return this;
  }
  cwd(): this {
    return this;
  }
  envs(): this {
    return this;
  }
  tty(): this {
    return this;
  }
  stdinPipe(): this {
    return this;
  }
}

function fakeMicrosandboxModule(sandbox: object) {
  const sandboxBuilder = {
    image() {
      return this;
    },
    cpus() {
      return this;
    },
    memory() {
      return this;
    },
    pullPolicy() {
      return this;
    },
    workdir() {
      return this;
    },
    envs() {
      return this;
    },
    ephemeral() {
      return this;
    },
    replace() {
      return this;
    },
    disableMetricsSample() {
      return this;
    },
    quietLogs() {
      return this;
    },
    maxDuration() {
      return this;
    },
    volume() {
      return this;
    },
    patch() {
      return this;
    },
    disableNetwork() {
      return this;
    },
    async create() {
      return sandbox;
    },
  };
  return {
    Sandbox: { builder: () => sandboxBuilder },
  };
}

function createRequest(): SeneraMicrosandboxCreateRequest {
  return {
    name: "adapter-test",
    image: "alpine",
    workspaceRoot: process.cwd(),
    guestWorkspaceRoot: "/workspace",
    workspaceMount: "writable",
    writableMounts: [],
    guestWorkdir: "/workspace",
    rootfsCopies: [],
    env: {},
    cpus: 1,
    memoryMiB: 512,
    network: "disabled",
    pullPolicy: "if-missing",
    maxDurationSeconds: 60,
  };
}
