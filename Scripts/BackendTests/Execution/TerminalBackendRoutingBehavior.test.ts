import { describe, expect, it } from "vitest";
import { createSeneraAuthorizedTerminalSpawner } from "../../../Source/AgentSystem/Execution/SeneraTerminalSpawner.js";
import {
  SeneraTerminalCapabilityNames,
  type SeneraTerminalBackend,
  type SeneraTerminalChild,
  type SeneraTerminalDisposable,
  type SeneraTerminalSpawnOptions,
} from "../../../Source/AgentSystem/Execution/SeneraTerminalTypes.js";
import type { SeneraShellDialect } from "../../../Source/AgentSystem/Execution/SeneraShellCommand.js";

describe("terminal backend routing", () => {
  it("resolves a raw shell script only after selecting the sandbox backend", async () => {
    const sandbox = new FakeTerminalBackend("sandbox-posix", "sandbox", [SeneraTerminalCapabilityNames.Persistent]);
    const spawn = createSeneraAuthorizedTerminalSpawner({ sandbox });

    await spawn("host-shell-must-not-be-used", ["host-args"], {
      ...sandboxOptions(),
      shellCommand: { mode: "shell", dialect: "posix-sh", script: "printf sandbox-ok" },
    });

    expect(sandbox.spawnInvocations).toEqual([{ command: "/bin/sh", args: ["-lc", "printf sandbox-ok"] }]);
  });

  it("fails a sandbox selection with an unsupported dialect without starting local execution", async () => {
    const sandbox = new FakeTerminalBackend("sandbox-posix", "sandbox", [SeneraTerminalCapabilityNames.Persistent]);
    const local = new FakeTerminalBackend(
      "local-powershell",
      "local",
      [SeneraTerminalCapabilityNames.Persistent],
      "powershell",
    );
    const spawn = createSeneraAuthorizedTerminalSpawner({ sandbox, local });

    await expect(
      spawn("host-shell-must-not-be-used", [], {
        ...sandboxOptions(),
        shellCommand: { mode: "shell", dialect: "powershell", script: "Write-Output local-ok" },
      }),
    ).rejects.toMatchObject({ code: "sandbox_unavailable", details: { reason: "shell_dialect_unsupported" } });

    expect(sandbox.spawnInvocations).toEqual([]);
    expect(local.spawnInvocations).toEqual([]);
  });

  it("runs a local selection through only a compatible local backend", async () => {
    const sandbox = new FakeTerminalBackend("sandbox-no-resize", "sandbox", [
      SeneraTerminalCapabilityNames.Persistent,
      SeneraTerminalCapabilityNames.InteractiveInput,
      SeneraTerminalCapabilityNames.Signals,
    ]);
    const local = new FakeTerminalBackend("local-full", "local", [
      SeneraTerminalCapabilityNames.Persistent,
      SeneraTerminalCapabilityNames.InteractiveInput,
      SeneraTerminalCapabilityNames.Resize,
      SeneraTerminalCapabilityNames.Signals,
    ]);
    const spawn = createSeneraAuthorizedTerminalSpawner({ local, sandbox });

    const child = await spawn("shell", [], {
      ...sandboxOptions(),
      requiredCapabilities: [SeneraTerminalCapabilityNames.Resize],
      profile: {
        ...sandboxOptions().profile!,
        backend: "local",
      },
    });

    expect(sandbox.spawnCalls).toBe(0);
    expect(local.spawnCalls).toBe(1);
    expect(child.metadata).toEqual(
      expect.objectContaining({
        requestedBoundary: "local",
        effectiveBoundary: "local",
        backendId: "local-full",
      }),
    );
  });
});

class FakeTerminalBackend implements SeneraTerminalBackend {
  readonly descriptor;
  spawnCalls = 0;
  readonly spawnInvocations: Array<{ command: string; args: string[] }> = [];

  constructor(
    id: string,
    boundary: "local" | "sandbox",
    capabilities: readonly (typeof SeneraTerminalCapabilityNames)[keyof typeof SeneraTerminalCapabilityNames][],
    shellDialect: SeneraShellDialect = boundary === "sandbox" ? "posix-sh" : "powershell",
  ) {
    this.descriptor = { id, boundary, shellDialect, capabilities: new Set(capabilities) };
  }

  resolveShellInvocation(command: string) {
    return this.descriptor.shellDialect === "posix-sh"
      ? { command: "/bin/sh", args: ["-lc", command] }
      : { command: "pwsh.exe", args: ["-Command", command] };
  }

  async spawn(command: string, args: readonly string[], _options: SeneraTerminalSpawnOptions) {
    this.spawnCalls += 1;
    this.spawnInvocations.push({ command, args: [...args] });
    return new FakeTerminalChild(this.descriptor);
  }
}

class FakeTerminalChild implements SeneraTerminalChild {
  readonly metadata;
  readonly pid = 9;

  constructor(descriptor: SeneraTerminalBackend["descriptor"]) {
    this.metadata = {
      requestedBoundary: descriptor.boundary,
      effectiveBoundary: descriptor.boundary,
      backendId: descriptor.id,
      shellDialect: descriptor.shellDialect,
      capabilities: [...descriptor.capabilities],
    };
  }

  async write(): Promise<void> {}
  async resize(): Promise<void> {}
  async signal(): Promise<void> {}
  onData(): SeneraTerminalDisposable {
    return noOpDisposable();
  }
  onError(): SeneraTerminalDisposable {
    return noOpDisposable();
  }
  onExit(): SeneraTerminalDisposable {
    return noOpDisposable();
  }
}

function sandboxOptions(): SeneraTerminalSpawnOptions {
  return {
    cwd: process.cwd(),
    columns: 100,
    rows: 30,
    maxDurationMs: 5_000,
    profile: {
      name: "sandbox-terminal",
      kind: "shell",
      backend: "sandbox",
      sandbox: {
        workspaceMount: "writable",
        network: "disabled",
      },
    },
  };
}

function noOpDisposable(): SeneraTerminalDisposable {
  return { dispose() {} };
}
