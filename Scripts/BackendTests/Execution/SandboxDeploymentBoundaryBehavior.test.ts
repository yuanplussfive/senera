import { describe, expect, test, vi } from "vitest";
import { createSeneraExecutionEnvironments } from "../../../Source/AgentSystem/Execution/SeneraExecutionEnvFactory.js";
import { SeneraRoutingProcessBackend } from "../../../Source/AgentSystem/Execution/SeneraRoutingProcessBackend.js";
import { createSeneraAuthorizedTerminalSpawner } from "../../../Source/AgentSystem/Execution/SeneraTerminalSpawner.js";

describe("sandbox deployment boundary", () => {
  test("does not require a Worker when sandbox execution is explicitly disabled", () => {
    expect(() =>
      createSeneraExecutionEnvironments({
        workspaceRoot: process.cwd(),
        sandboxAvailable: false,
      }),
    ).not.toThrow();
  });

  test("requires a Worker only after sandbox availability was established", () => {
    expect(() => createSeneraExecutionEnvironments({ workspaceRoot: process.cwd() })).not.toThrow();
    expect(() =>
      createSeneraExecutionEnvironments({
        workspaceRoot: process.cwd(),
        platform: "linux",
        sandboxEnabled: true,
        sandboxAvailable: true,
      }),
    ).toThrow("requires a Worker client");
  });

  test("exposes the Docker Engine sandbox on Windows when its Worker is ready", () => {
    const environments = createSeneraExecutionEnvironments({
      workspaceRoot: process.cwd(),
      platform: "win32",
      sandboxEnabled: true,
      sandboxAvailable: true,
      sandboxProvider: "docker-engine",
      dockerEngineWorker: {} as never,
    });

    expect(environments.tool.capabilities).toMatchObject({
      effectiveMode: "sandbox",
      effectiveBackend: "sandbox",
      shellDialect: "posix-sh",
      processBackends: ["sandbox"],
      persistentProcessBackends: ["sandbox"],
      terminalBackends: ["sandbox"],
    });
  });

  test("exposes governed host execution on POSIX when sandbox execution is explicitly disabled", () => {
    const environments = createSeneraExecutionEnvironments({
      workspaceRoot: process.cwd(),
      platform: "linux",
      sandboxEnabled: false,
      sandboxAvailable: false,
    });

    expect(environments.tool.capabilities).toMatchObject({
      effectiveMode: "host",
      effectiveBackend: "local",
      shellDialect: "posix-sh",
      processBackends: ["local"],
      persistentProcessBackends: ["local"],
      terminalBackends: ["local"],
    });
  });

  test("does not expose a process backend while a required POSIX sandbox is unavailable", () => {
    const environments = createSeneraExecutionEnvironments({
      workspaceRoot: process.cwd(),
      platform: "linux",
      sandboxEnabled: true,
      sandboxAvailable: false,
    });

    expect(environments.tool.capabilities).toMatchObject({
      effectiveMode: "unavailable",
      processBackends: [],
      persistentProcessBackends: [],
      terminalBackends: [],
    });
    expect(environments.tool.capabilities).not.toHaveProperty("effectiveBackend");
  });

  test("exposes only the sandbox backend after a POSIX Worker is ready", () => {
    const environments = createSeneraExecutionEnvironments({
      workspaceRoot: process.cwd(),
      platform: "linux",
      sandboxEnabled: true,
      sandboxAvailable: true,
      sandboxProvider: "docker-engine",
      dockerEngineWorker: {} as never,
    });

    expect(environments.tool.capabilities).toMatchObject({
      effectiveMode: "sandbox",
      effectiveBackend: "sandbox",
      shellDialect: "posix-sh",
      processBackends: ["sandbox"],
      persistentProcessBackends: ["sandbox"],
      terminalBackends: ["sandbox"],
    });
  });

  test("rejects a disabled sandbox process target without invoking either backend", async () => {
    const local = {
      kind: "local",
      executeProcess: vi.fn(),
    };
    const sandbox = {
      kind: "docker-engine",
      executeProcess: vi.fn(),
    };
    const backend = new SeneraRoutingProcessBackend({
      local,
      sandbox,
      sandboxEnabled: false,
    });

    await expect(
      backend.executeProcess({
        command: "echo",
        args: ["must-not-run"],
        cwd: process.cwd(),
        timeoutMs: 1_000,
        limits: {
          timeoutMs: 1_000,
          maxStdoutBytes: 1_024,
          maxStderrBytes: 1_024,
        },
        profile: {
          name: "shell",
          kind: "shell",
          backend: "sandbox",
        },
      }),
    ).rejects.toMatchObject({
      code: "sandbox_unavailable",
      details: { reason: "sandbox_disabled" },
    });

    expect(local.executeProcess).not.toHaveBeenCalled();
    expect(sandbox.executeProcess).not.toHaveBeenCalled();
  });

  test("rejects a disabled sandbox terminal target before backend lookup", async () => {
    const spawn = createSeneraAuthorizedTerminalSpawner({ sandboxEnabled: false });

    await expect(
      spawn("sh", ["-lc", "echo must-not-run"], {
        cwd: process.cwd(),
        columns: 120,
        rows: 30,
        profile: {
          name: "terminal",
          kind: "shell",
          backend: "sandbox",
        },
      }),
    ).rejects.toMatchObject({
      code: "sandbox_unavailable",
      details: { reason: "sandbox_disabled" },
    });
  });
});
