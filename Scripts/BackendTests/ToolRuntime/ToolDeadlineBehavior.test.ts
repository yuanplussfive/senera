import { describe, expect, test } from "vitest";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import {
  AgentToolDeadlineExceededError,
  resolveAgentToolCallTimeoutMs,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolDeadline.js";
import { AgentToolHostCapabilityRegistry } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { toolProcessSuccessResult } from "../../../Source/AgentSystem/ToolRuntime/AgentToolProcessEnvelope.js";
import { AgentToolRunner } from "../../../Source/AgentSystem/ToolRuntime/AgentToolRunner.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import { AgentExecutionErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

describe("Tool invocation deadline", () => {
  test("applies one host deadline to HostCapability execution", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-tool-deadline");
    const tool = registeredTool(workspaceRoot);
    let observedSignal: AbortSignal | undefined;
    const capabilities = new AgentToolHostCapabilityRegistry().register("test.deadline", async (_args, context) => {
      observedSignal = context.signal;
      await aborted(context.signal);
      return toolProcessSuccessResult({ completed: true });
    });
    const runner = new AgentToolRunner(
      configWithTimeout(0.01),
      workspaceRoot,
      capabilities,
      { getTool: () => tool },
      new SeneraLocalExecutionEnv({ workspaceRoot }),
    );

    try {
      const result = await runner.run(tool, {});

      expect(observedSignal?.reason).toBeInstanceOf(AgentToolDeadlineExceededError);
      expect(result.response).toMatchObject({
        ok: false,
        error: {
          code: AgentExecutionErrorCodes.ToolProcessTimeout,
          details: { toolName: tool.name, timeoutMs: 10 },
        },
      });
    } finally {
      await runner.close();
      removeDirectory(workspaceRoot);
    }
  });

  test("allows tool-specific durations to shorten but not extend the host deadline", () => {
    const config = configWithTimeout(1);

    expect(resolveAgentToolCallTimeoutMs(config)).toBe(1_000);
    expect(resolveAgentToolCallTimeoutMs(config, 250)).toBe(250);
    expect(resolveAgentToolCallTimeoutMs(config, 5_000)).toBe(1_000);
    expect(() => resolveAgentToolCallTimeoutMs(config, 0)).toThrow("positive duration");
  });

  test("leaves RemoteJob lifetime to task cancellation and status", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-remote-job-deadline");
    const tool = registeredTool(workspaceRoot, "RemoteJob");
    const capabilities = new AgentToolHostCapabilityRegistry().register("test.deadline", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return toolProcessSuccessResult({ completed: true });
    });
    const runner = new AgentToolRunner(
      configWithTimeout(0.01),
      workspaceRoot,
      capabilities,
      { getTool: () => tool },
      new SeneraLocalExecutionEnv({ workspaceRoot }),
    );

    try {
      await expect(runner.run(tool, {})).resolves.toMatchObject({ response: { ok: true } });
    } finally {
      await runner.close();
      removeDirectory(workspaceRoot);
    }
  });
});

function configWithTimeout(timeoutSeconds: number): AgentSystemConfig {
  return { ModelProviders: [], ToolExecution: { TimeoutSeconds: timeoutSeconds } };
}

function registeredTool(
  workspaceRoot: string,
  lifecycle: RegisteredTool["runtime"]["Lifecycle"] = "Immediate",
): RegisteredTool {
  return {
    owner: {
      kind: "system",
      name: "deadline-test",
      rootPath: workspaceRoot,
      revision: "test",
      trusted: true,
      requiresApproval: false,
    },
    name: "DeadlineTestTool",
    loading: "Bootstrap",
    permissions: [],
    handler: { kind: "HostCapability", capability: "test.deadline" },
    execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
    runtime: {
      Lifecycle: lifecycle,
      ProtocolVersion: 2,
      ResultAssessment: "ProcessExit",
      Capabilities: { Cancellation: true },
    },
    sources: [],
    evidenceCapabilities: [],
  };
}

function aborted(signal: AbortSignal | undefined): Promise<void> {
  if (!signal || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}
