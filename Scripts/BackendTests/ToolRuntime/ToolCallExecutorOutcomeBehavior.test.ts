import { describe, expect, test, vi } from "vitest";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolCallExecutor } from "../../../Source/AgentSystem/ToolRuntime/AgentToolCallExecutor.js";
import { toolProcessSuccessResult } from "../../../Source/AgentSystem/ToolRuntime/AgentToolProcessEnvelope.js";
import type { AgentToolRunnerLike } from "../../../Source/AgentSystem/ToolRuntime/AgentToolRunner.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import { AgentExecutionErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";
import { createXmlProtocolSpec } from "../../../Source/AgentSystem/Xml/AgentXmlPolicy.js";

describe("tool call executor outcome", () => {
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
    evidenceCapabilities: [],
  };
}
