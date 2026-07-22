import assert from "node:assert/strict";
import path from "node:path";
import {
  AgentToolExecutionTargetError,
  resolveAgentToolInvocation,
} from "../Source/AgentSystem/ToolRuntime/AgentToolExecutionPlan.js";
import type { LoadedPlugin, RegisteredTool } from "../Source/AgentSystem/Types/PluginRuntimeTypes.js";
import type { ToolExecutionManifest } from "../Source/AgentSystem/Types/PluginManifestTypes.js";

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

function createPlugin(): LoadedPlugin {
  const pluginRoot = path.join(workspaceRoot, "System", "Plugins", "VerifyExecutionPlugin");
  return {
    rootPath: pluginRoot,
    rootKind: "System",
    manifestPath: path.join(pluginRoot, "PluginManifest.json"),
    config: {
      fileName: "PluginConfig.toml",
      path: path.join(pluginRoot, "PluginConfig.toml"),
      exists: false,
      source: "default",
      templateExists: false,
      needsUserConfig: false,
      toml: "",
      sections: [],
      runtime: { enabled: true, tools: {} },
      diagnostics: [],
    },
    manifest: {
      ManifestVersion: 2,
      Plugin: { Name: "VerifyExecutionPlugin", Version: "0.0.0", Kind: "Tool" },
      Tools: [
        {
          Name: "VerifyTool",
          Handler: { Kind: "HostCapability", Capability: "verify" },
          Runtime: { Lifecycle: "Immediate", ProtocolVersion: 2 },
          Execution: DefaultExecution,
        },
      ],
    },
  };
}

const DefaultExecution = {
  Targets: ["Sandbox"],
  Network: "Deny",
  Workspace: "ReadOnly",
} satisfies ToolExecutionManifest;

function createTool(input: { permissions?: string[]; execution: ToolExecutionManifest }): RegisteredTool {
  return {
    plugin: createPlugin(),
    name: "VerifyTool",
    loading: "Dynamic",
    permissions: input.permissions ?? [],
    sources: [],
    execution: input.execution,
    handler: { kind: "HostCapability", capability: "verify" },
    runtime: { Lifecycle: "Immediate", ProtocolVersion: 2 },
    evidenceCapabilities: [],
  };
}

main();
