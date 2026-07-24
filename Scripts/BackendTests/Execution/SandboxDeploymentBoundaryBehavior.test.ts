import { describe, expect, test, vi } from "vitest";
import { SeneraRoutingProcessBackend } from "../../../Source/AgentSystem/Execution/SeneraRoutingProcessBackend.js";
import { createSeneraAuthorizedTerminalSpawner } from "../../../Source/AgentSystem/Execution/SeneraTerminalSpawner.js";

describe("sandbox deployment boundary", () => {
  test("rejects a disabled sandbox process target without invoking either backend", async () => {
    const local = {
      kind: "local",
      executeProcess: vi.fn(),
    };
    const sandbox = {
      kind: "microsandbox",
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
