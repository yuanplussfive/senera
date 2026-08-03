import { describe, expect, it, vi } from "vitest";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
  type SeneraExecutionEnv,
} from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import { runShellCommandHostTool } from "../../../Source/AgentSystem/ToolRuntime/AgentShellCommandRuntime.js";
import { AgentExecutionErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";

describe("Shell command runtime", () => {
  it("uses the resolved sandbox execution plan without a local fallback path", async () => {
    const executeShell = vi.fn(async () => ({ stdout: "ok", stderr: "", exitCode: 0, signal: null }));
    const workspaceRoot = process.cwd();
    const tool = shellTool();

    const result = await runShellCommandHostTool(
      { command: shellCommand("echo ok") },
      {
        tool,
        config: { ModelProviders: [] },
        workspaceRoot,
        registry: { getTool: () => tool },
        executionEnv: {
          canonicalPath: async () => ({ ok: true, value: workspaceRoot }),
          executeShell,
        } as never,
        sessionId: "session-shell",
        requestId: "request-shell",
        step: 2,
        toolCallId: "call-shell",
        executionPlan: sandboxPlan(),
      },
    );

    expect(result.response.ok).toBe(true);
    expect(executeShell).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "echo ok",
        dialect: "posix-sh",
        profile: expect.objectContaining({
          backend: "sandbox",
          sandbox: { network: "default", workspaceMount: "writable" },
        }),
      }),
    );
  });

  it("emits ordered stdout and stderr deltas before returning", async () => {
    const events: Array<{ kind: string; data: Record<string, unknown> }> = [];
    const workspaceRoot = process.cwd();
    const tool = shellTool();
    const executeShell = vi.fn(async (request: Parameters<SeneraExecutionEnv["executeShell"]>[0]) => {
      request.onOutput?.({ stream: "stdout", data: Buffer.from("hel"), totalBytes: 3 });
      request.onOutput?.({ stream: "stdout", data: Buffer.from("lo"), totalBytes: 5 });
      request.onOutput?.({ stream: "stderr", data: Buffer.from("warning"), totalBytes: 7 });
      return { stdout: "hello", stderr: "warning", exitCode: 0, signal: null };
    });

    const result = await runShellCommandHostTool(
      { command: shellCommand("echo hello") },
      {
        tool,
        config: { ModelProviders: [] },
        workspaceRoot,
        registry: { getTool: () => tool },
        executionEnv: {
          canonicalPath: async () => ({ ok: true, value: workspaceRoot }),
          executeShell,
        } as never,
        requestId: "request-output",
        step: 3,
        toolCallId: "call-output",
        executionPlan: sandboxPlan(),
        onEvent: async (event) => {
          events.push(event as (typeof events)[number]);
        },
      },
    );

    expect(result.response.ok).toBe(true);
    expect(events.map((event) => event.kind)).toEqual(["tool.call.output", "tool.call.output", "tool.call.output"]);
    expect(events.map((event) => event.data.text)).toEqual(["hel", "lo", "warning"]);
    expect(events.map((event) => event.data.outputSequence)).toEqual([1, 2, 3]);
  });

  it("does not turn a successful command into a failure when live output delivery disconnects", async () => {
    const workspaceRoot = process.cwd();
    const tool = shellTool();
    const result = await runShellCommandHostTool(
      { command: shellCommand("echo retained") },
      {
        tool,
        config: { ModelProviders: [] },
        workspaceRoot,
        registry: { getTool: () => tool },
        executionEnv: {
          canonicalPath: async () => ({ ok: true, value: workspaceRoot }),
          executeShell: async (request: Parameters<SeneraExecutionEnv["executeShell"]>[0]) => {
            request.onOutput?.({ stream: "stdout", data: Buffer.from("retained"), totalBytes: 8 });
            return { stdout: "retained", stderr: "", exitCode: 0, signal: null };
          },
        } as never,
        requestId: "request-disconnected",
        step: 1,
        toolCallId: "call-disconnected",
        executionPlan: sandboxPlan(),
        onEvent: async () => {
          throw new Error("socket disconnected");
        },
      },
    );

    expect(result.response.ok).toBe(true);
    expect(result.stdout).toBe("retained");
  });

  it("suppresses live output when the tool contract does not declare output streaming", async () => {
    const events: unknown[] = [];
    const workspaceRoot = process.cwd();
    const tool = shellTool(false);

    const result = await runShellCommandHostTool(
      { command: shellCommand("echo private") },
      {
        tool,
        config: { ModelProviders: [] },
        workspaceRoot,
        registry: { getTool: () => tool },
        executionEnv: {
          canonicalPath: async () => ({ ok: true, value: workspaceRoot }),
          executeShell: async (request: Parameters<SeneraExecutionEnv["executeShell"]>[0]) => {
            request.onOutput?.({ stream: "stdout", data: Buffer.from("private"), totalBytes: 7 });
            return { stdout: "private", stderr: "", exitCode: 0, signal: null };
          },
        } as never,
        requestId: "request-output-disabled",
        step: 1,
        toolCallId: "call-output-disabled",
        executionPlan: sandboxPlan(),
        onEvent: async (event) => {
          events.push(event);
        },
      },
    );

    expect(result.response.ok).toBe(true);
    expect(events).toEqual([]);
  });

  it("clamps a requested command timeout to the host tool deadline", async () => {
    const executeShell = vi.fn(async () => ({ stdout: "ok", stderr: "", exitCode: 0, signal: null }));
    const workspaceRoot = process.cwd();
    const tool = shellTool();

    await runShellCommandHostTool(
      { command: shellCommand("echo bounded"), timeoutMs: 5_000 },
      {
        tool,
        config: { ModelProviders: [], ToolExecution: { TimeoutSeconds: 1 } },
        workspaceRoot,
        registry: { getTool: () => tool },
        executionEnv: {
          canonicalPath: async () => ({ ok: true, value: workspaceRoot }),
          executeShell,
        } as never,
        executionPlan: sandboxPlan(),
      },
    );

    expect(executeShell).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 1_000, limits: expect.objectContaining({ timeoutMs: 1_000 }) }),
    );
  });

  it.each([
    {
      label: "an untyped error whose message resembles cancellation",
      error: new Error("aborted"),
      expectedCode: AgentExecutionErrorCodes.ToolProcessSpawnFailed,
    },
    {
      label: "a typed execution cancellation",
      error: new SeneraExecutionError(SeneraExecutionErrorCodes.Aborted, "execution cancelled"),
      expectedCode: AgentExecutionErrorCodes.ToolProcessCancelled,
    },
  ])("classifies $label by protocol semantics", async ({ error, expectedCode }) => {
    const workspaceRoot = process.cwd();
    const tool = shellTool();
    const result = await runShellCommandHostTool(
      { command: shellCommand("echo outcome") },
      {
        tool,
        config: { ModelProviders: [] },
        workspaceRoot,
        registry: { getTool: () => tool },
        executionEnv: {
          canonicalPath: async () => ({ ok: true, value: workspaceRoot }),
          executeShell: async () => {
            throw error;
          },
        } as never,
        executionPlan: sandboxPlan(),
      },
    );

    expect(result.response).toMatchObject({
      ok: false,
      error: { code: expectedCode },
    });
  });
});

function shellCommand(script: string) {
  return { mode: "shell", dialect: "posix-sh", script } as const;
}

function shellTool(outputStreaming = true): RegisteredTool {
  return {
    owner: {
      kind: "system",
      name: "shell",
      title: "Shell Tool",
      rootPath: process.cwd(),
      revision: "test",
      trusted: true,
      requiresApproval: false,
    },
    name: "ShellCommandTool",
    loading: "Bootstrap",
    permissions: ["process:shell", "filesystem:workspace"],
    execution: {
      Targets: ["Sandbox", "Local"],
      Network: "Allow",
      Workspace: "ReadWrite",
    },
    handler: { kind: "HostCapability", capability: "shell.run" },
    runtime: {
      Lifecycle: "OneShot",
      ProtocolVersion: 2,
      ResultAssessment: "Unassessed",
      Capabilities: { OutputStreaming: outputStreaming, Cancellation: true },
    },
    sources: [],
    evidenceCapabilities: [],
  };
}

function sandboxPlan() {
  return {
    target: "Sandbox" as const,
    backend: "sandbox" as const,
    network: "default" as const,
    workspaceMount: "writable" as const,
    availableTargets: ["Sandbox", "Local"] as const,
  };
}
