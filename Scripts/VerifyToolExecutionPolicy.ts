import assert from "node:assert/strict";
import {
  AgentToolExecutionTargetError,
  resolveAgentToolInvocation,
} from "../Source/AgentSystem/ToolRuntime/AgentToolExecutionPlan.js";
import type { RegisteredTool } from "../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import type { ToolExecutionManifest } from "../Source/AgentSystem/Types/AgentToolContractTypes.js";

const workspaceRoot = process.cwd();

function main(): void {
  const local = resolveAgentToolInvocation(
    createTool({ execution: { Targets: ["Local"], Network: "Allow", Workspace: "ReadWrite" } }),
    { command: "echo local" },
  );
  assert.deepEqual(local.arguments, { command: "echo local" });
  assert.deepEqual(local.executionPlan, {
    target: "Local",
    backend: "local",
    network: "default",
    workspaceMount: "writable",
    availableTargets: ["Local"],
  });

  const sandbox = resolveAgentToolInvocation(
    createTool({ execution: { Targets: ["Sandbox"], Network: "Deny", Workspace: "ReadOnly" } }),
    { command: "pwd" },
  );
  assert.deepEqual(sandbox.executionPlan, {
    target: "Sandbox",
    backend: "sandbox",
    network: "disabled",
    workspaceMount: "readonly",
    availableTargets: ["Sandbox"],
  });

  const selectableTool = createTool({
    permissions: ["process:shell"],
    execution: { Targets: ["Sandbox", "Local"], Network: "Allow", Workspace: "ReadWrite" },
  });
  assert.throws(
    () => resolveAgentToolInvocation(selectableTool, { command: "echo target" }),
    AgentToolExecutionTargetError,
  );
  const selectable = resolveAgentToolInvocation(selectableTool, {
    command: "echo target",
    executionTarget: "Sandbox",
  });
  assert.deepEqual(selectable.arguments, { command: "echo target" });
  assert.equal(selectable.executionPlan.backend, "sandbox");
  assert.deepEqual(selectable.executionPlan.availableTargets, ["Sandbox", "Local"]);

  assert.throws(
    () => resolveAgentToolInvocation(selectableTool, { executionTarget: "Remote" }),
    AgentToolExecutionTargetError,
  );

  console.log("Tool execution plan verification passed.");
}

function createTool(input: { permissions?: string[]; execution: ToolExecutionManifest }): RegisteredTool {
  return {
    owner: {
      kind: "system",
      name: "verify-execution",
      rootPath: workspaceRoot,
      revision: "test",
      trusted: true,
      requiresApproval: false,
    },
    name: "VerifyTool",
    loading: "Dynamic",
    permissions: input.permissions ?? [],
    sources: [],
    execution: input.execution,
    handler: { kind: "HostCapability", capability: "verify" },
    runtime: { Lifecycle: "Immediate", ProtocolVersion: 2, ResultAssessment: "ProcessExit" },
    evidenceCapabilities: [],
  };
}

main();
