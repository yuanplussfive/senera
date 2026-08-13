import { describe, expect, test, vi } from "vitest";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import type { AgentLifecycleClock } from "../../../Source/AgentSystem/Events/AgentLifecycleClock.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolCallExecutor } from "../../../Source/AgentSystem/ToolRuntime/AgentToolCallExecutor.js";
import { toolProcessSuccessResult } from "../../../Source/AgentSystem/ToolRuntime/AgentToolProcessEnvelope.js";
import type { AgentToolRunnerLike } from "../../../Source/AgentSystem/ToolRuntime/AgentToolRunner.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import { AgentExecutionErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";
import { createXmlProtocolSpec } from "../../../Source/AgentSystem/Xml/AgentXmlPolicy.js";
import {
  AgentResourceAccessGrantModes,
  createAgentResourceAccessGrant,
} from "../../../Source/AgentSystem/Execution/SeneraResourceAccess.js";

describe("tool call executor outcome", () => {
  test("preserves thinking plus separate authorized and exposed Tool sets in the runner context", async () => {
    const tool = registeredTool();
    const registry = new AgentExtensionRegistry();
    registry.registerToolExtension(tool.owner, [tool]);
    const run = vi.fn<AgentToolRunnerLike["run"]>(async () => toolProcessSuccessResult({ output: "done" }));
    const executor = new AgentToolCallExecutor({
      registry,
      config: { ModelProviders: [] },
      protocol: createXmlProtocolSpec(),
      toolRunner: { run },
    });

    await executor.execute(
      { name: tool.name, callId: "call-thinking" },
      {
        requestId: "request-thinking",
        step: 1,
        thinkingLevel: "high",
        toolAccessGrant: createAgentToolAccessGrant({
          authorizedToolNames: [tool.name, "AuthorizedButNotExposed"],
          exposedToolNames: [tool.name],
        }),
      },
    );

    expect(run).toHaveBeenCalledWith(
      tool,
      {},
      expect.objectContaining({
        thinkingLevel: "high",
        visibleToolNames: [tool.name],
        authorizedToolNames: [tool.name, "AuthorizedButNotExposed"],
      }),
    );
  });

  test("rejects a resource grant bound to a different tool call before dispatch", async () => {
    const tool = registeredTool();
    const registry = new AgentExtensionRegistry();
    registry.registerToolExtension(tool.owner, [tool]);
    const run = vi.fn<AgentToolRunnerLike["run"]>();
    const executor = new AgentToolCallExecutor({
      registry,
      config: { ModelProviders: [] },
      protocol: createXmlProtocolSpec(),
      toolRunner: { run },
      emitLifecycleEvents: false,
    });

    await expect(
      executor.execute(
        { name: tool.name, callId: "call-current" },
        {
          sessionId: "session-current",
          requestId: "request-current",
          toolAccessGrant: createAgentToolAccessGrant({
            authorizedToolNames: [tool.name],
            exposedToolNames: [tool.name],
          }),
          resourceAccessGrant: createAgentResourceAccessGrant({
            mode: AgentResourceAccessGrantModes.FullHost,
            binding: {
              sessionId: "session-current",
              requestId: "request-current",
              toolCallId: "call-other",
              toolName: tool.name,
            },
          }),
        },
      ),
    ).rejects.toThrow("does not belong to tool call call-current");
    expect(run).not.toHaveBeenCalled();
  });

  test("projects a nonzero process exit into result, presentation, and lifecycle failure", async () => {
    const tool = registeredTool();
    const registry = new AgentExtensionRegistry();
    registry.registerToolExtension(tool.owner, [tool]);
    const run = vi.fn<AgentToolRunnerLike["run"]>(async () => ({
      ...toolProcessSuccessResult({ output: "partial" }),
      stderr: "command failed",
      exitCode: 9,
    }));
    const executor = new AgentToolCallExecutor({
      registry,
      config: { ModelProviders: [] },
      protocol: createXmlProtocolSpec(),
      toolRunner: { run },
    });
    const eventKinds: string[] = [];

    const execution = await executor.execute(
      { name: tool.name, callId: "call-process-failure" },
      {
        requestId: "request-process-failure",
        step: 1,
        toolAccessGrant: createAgentToolAccessGrant({
          authorizedToolNames: [tool.name],
          exposedToolNames: [tool.name],
        }),
        onEvent: async (event) => {
          eventKinds.push(event.kind);
        },
      },
    );

    expect(execution.kind).toBe("ToolResults");
    if (execution.kind !== "ToolResults") throw new Error("Expected a tool result.");
    expect(execution.value).toEqual([
      expect.objectContaining({
        outcome: {
          execution: { status: "completed" },
          assessment: {
            status: "failure",
            error: expect.objectContaining({
              code: AgentExecutionErrorCodes.ToolProcessExited,
              kind: "process_exit",
              source: "process",
              retryable: false,
              message: expect.stringContaining("exit code 9"),
              details: expect.objectContaining({ exitCode: 9 }),
            }),
          },
          output: { availability: "partial" },
        },
        presentation: expect.objectContaining({ status: "failure" }),
      }),
    ]);
    expect(eventKinds).toContain("tool.call.failed");
    expect(eventKinds).not.toContain("tool.call.completed");
  });

  test("does not reinterpret a successful business payload containing an error field", async () => {
    const tool = registeredTool();
    const registry = new AgentExtensionRegistry();
    registry.registerToolExtension(tool.owner, [tool]);
    const executor = new AgentToolCallExecutor({
      registry,
      config: { ModelProviders: [] },
      protocol: createXmlProtocolSpec(),
      toolRunner: {
        run: async () => toolProcessSuccessResult({ error: { message: "domain-level result" } }),
      },
    });
    const eventKinds: string[] = [];

    const execution = await executor.execute(
      { name: tool.name, callId: "call-domain-result" },
      {
        requestId: "request-domain-result",
        step: 1,
        toolAccessGrant: createAgentToolAccessGrant({
          authorizedToolNames: [tool.name],
          exposedToolNames: [tool.name],
        }),
        onEvent: async (event) => {
          eventKinds.push(event.kind);
        },
      },
    );

    expect(execution).toMatchObject({
      kind: "ToolResults",
      value: [
        {
          outcome: {
            execution: { status: "completed" },
            assessment: { status: "success" },
            output: { availability: "complete" },
          },
          result: { error: { message: "domain-level result" } },
          presentation: { status: "success" },
        },
      ],
    });
    expect(eventKinds).toContain("tool.call.completed");
    expect(eventKinds).not.toContain("tool.call.failed");
  });

  test("recognizes the declared child-run suspension control after recording tool lifecycle", async () => {
    const tool = registeredTool();
    const registry = new AgentExtensionRegistry();
    registry.registerToolExtension(tool.owner, [tool]);
    const eventKinds: string[] = [];
    const executor = new AgentToolCallExecutor({
      registry,
      config: { ModelProviders: [] },
      protocol: createXmlProtocolSpec(),
      toolRunner: {
        run: async () =>
          toolProcessSuccessResult({
            control: {
              kind: "SuspendChildRun",
              childRunId: "child-1",
              messageId: "message-1",
              message: "A decision is required.",
            },
          }),
      },
    });

    const execution = await executor.execute(
      { name: tool.name, callId: "call-suspend" },
      {
        requestId: "request-suspend",
        step: 1,
        toolAccessGrant: createAgentToolAccessGrant({
          authorizedToolNames: [tool.name],
          exposedToolNames: [tool.name],
        }),
        onEvent: async (event) => {
          eventKinds.push(event.kind);
        },
      },
    );

    expect(execution).toEqual({
      kind: "SuspendChildRun",
      value: {
        childRunId: "child-1",
        messageId: "message-1",
        message: "A decision is required.",
      },
    });
    expect(eventKinds).toContain("tool.call.completed");
    expect(eventKinds).not.toContain("tool.call.failed");
  });

  test("publishes backend-measured lifecycle timing for system tools", async () => {
    const tool = {
      ...registeredTool(),
      artifactPolicy: { Redact: { Keys: ["token"] } },
    } satisfies RegisteredTool;
    const registry = new AgentExtensionRegistry();
    registry.registerToolExtension(tool.owner, [tool]);
    const clock = new TestLifecycleClock(1_000);
    const events: Array<{ kind: string; data: Record<string, unknown> }> = [];
    const executor = new AgentToolCallExecutor({
      registry,
      config: { ModelProviders: [] },
      protocol: createXmlProtocolSpec(),
      clock,
      toolRunner: {
        run: async () => {
          clock.advance(42);
          return toolProcessSuccessResult({ output: "timed" });
        },
      },
    });

    await executor.execute(
      {
        name: tool.name,
        callId: "call-timed",
        arguments: { query: "inspect workspace", token: "secret-token" },
      },
      {
        requestId: "request-timed",
        step: 1,
        toolAccessGrant: createAgentToolAccessGrant({
          authorizedToolNames: [tool.name],
          exposedToolNames: [tool.name],
        }),
        onEvent: async (event) => {
          events.push({ kind: event.kind, data: event.data as Record<string, unknown> });
        },
      },
    );

    expect(events.find((event) => event.kind === "tool.call.started")?.data).toMatchObject({
      callId: "call-timed",
      arguments: { query: "inspect workspace", token: "[REDACTED]" },
      startedAt: "1970-01-01T00:00:01.000Z",
    });
    expect(events.find((event) => event.kind === "tool.call.completed")?.data).toMatchObject({
      callId: "call-timed",
      startedAt: "1970-01-01T00:00:01.000Z",
      durationMs: 42,
    });
  });

  test("closes an unexpected tool exception with an explicit failed lifecycle", async () => {
    const tool = registeredTool();
    const registry = new AgentExtensionRegistry();
    registry.registerToolExtension(tool.owner, [tool]);
    const clock = new TestLifecycleClock(2_000);
    const events: Array<{ kind: string; data: Record<string, unknown> }> = [];
    const executor = new AgentToolCallExecutor({
      registry,
      config: { ModelProviders: [] },
      protocol: createXmlProtocolSpec(),
      clock,
      toolRunner: {
        run: async () => {
          clock.advance(7);
          throw new Error("runner exploded");
        },
      },
    });

    await expect(
      executor.execute(
        { name: tool.name, callId: "call-exception" },
        {
          requestId: "request-exception",
          step: 1,
          toolAccessGrant: createAgentToolAccessGrant({
            authorizedToolNames: [tool.name],
            exposedToolNames: [tool.name],
          }),
          onEvent: async (event) => {
            events.push({ kind: event.kind, data: event.data as Record<string, unknown> });
          },
        },
      ),
    ).rejects.toThrow("runner exploded");

    expect(events.find((event) => event.kind === "tool.call.failed")?.data).toMatchObject({
      callId: "call-exception",
      startedAt: "1970-01-01T00:00:02.000Z",
      durationMs: 7,
    });
  });

  test("passes through a nonzero exit for an unassessed tool without emitting a failure", async () => {
    const tool = registeredTool("Unassessed");
    const registry = new AgentExtensionRegistry();
    registry.registerToolExtension(tool.owner, [tool]);
    const executor = new AgentToolCallExecutor({
      registry,
      config: { ModelProviders: [] },
      protocol: createXmlProtocolSpec(),
      toolRunner: {
        run: async () => ({
          ...toolProcessSuccessResult({ output: "inspect the process fields" }),
          stderr: "command chose exit code 9",
          exitCode: 9,
        }),
      },
    });
    const eventKinds: string[] = [];

    const execution = await executor.execute(
      { name: tool.name, callId: "call-unassessed-exit" },
      {
        requestId: "request-unassessed-exit",
        step: 1,
        toolAccessGrant: createAgentToolAccessGrant({
          authorizedToolNames: [tool.name],
          exposedToolNames: [tool.name],
        }),
        onEvent: async (event) => {
          eventKinds.push(event.kind);
        },
      },
    );

    expect(execution).toMatchObject({
      kind: "ToolResults",
      value: [
        {
          process: { exitCode: 9, stderr: "command chose exit code 9" },
          outcome: {
            execution: { status: "completed" },
            assessment: { status: "unassessed" },
            output: { availability: "complete" },
          },
          presentation: { status: "unassessed" },
        },
      ],
    });
    expect(eventKinds).toContain("tool.call.completed");
    expect(eventKinds).not.toContain("tool.call.failed");
  });
});

function registeredTool(ResultAssessment: "ProcessExit" | "Unassessed" = "ProcessExit"): RegisteredTool {
  return {
    owner: {
      kind: "system",
      name: "outcome-test",
      title: "Outcome test",
      rootPath: process.cwd(),
      revision: "test",
      trusted: true,
      requiresApproval: false,
    },
    name: "OutcomeTestTool",
    loading: "Bootstrap",
    permissions: [],
    handler: { kind: "HostCapability", capability: "test.outcome" },
    execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
    runtime: {
      Lifecycle: "Immediate",
      ProtocolVersion: 2,
      ResultAssessment,
      Capabilities: { Cancellation: true },
    },
    sources: [],
    childGrant: "inherit",
    evidenceCapabilities: [],
  };
}

class TestLifecycleClock implements AgentLifecycleClock {
  constructor(private epochMilliseconds: number) {}

  now(): number {
    return this.epochMilliseconds;
  }

  monotonicNow(): number {
    return this.epochMilliseconds;
  }

  timestamp(epochMilliseconds: number): string {
    return new Date(epochMilliseconds).toISOString();
  }

  advance(milliseconds: number): void {
    this.epochMilliseconds += milliseconds;
  }
}
