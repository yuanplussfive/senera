import assert from "node:assert/strict";
import path from "node:path";
import { buildAgentPluginProcessExecutionPlan } from "../Source/AgentSystem/ToolRuntime/AgentPluginProcessExecutionProfile.js";
import { resolveAgentToolExecutionPolicy } from "../Source/AgentSystem/ToolRuntime/AgentToolExecutionPolicy.js";
import type { LoadedPlugin, RegisteredTool } from "../Source/AgentSystem/Types/PluginRuntimeTypes.js";
import type { ToolExecutionManifest } from "../Source/AgentSystem/Types/PluginManifestTypes.js";

const workspaceRoot = process.cwd();

function main(): void {
  const localTool = createTool({
    plugin: createPlugin({
      rootKind: "System",
      pluginRoot: path.join(workspaceRoot, "System", "Plugins", "VerifyLocalPlugin"),
    }),
    execution: {
      Boundary: "Local",
      Network: "Allow",
      Workspace: "ReadWrite",
      LocalFallback: "Allow",
    },
  });
  const localPolicy = resolveAgentToolExecutionPolicy(localTool);
  assert.equal(localPolicy.mode, "local");
  assert.equal(localPolicy.network, "default");
  assert.equal(localPolicy.workspaceMount, "writable");
  assert.equal(localPolicy.localFallback, "allow");
  const localPlan = buildAgentPluginProcessExecutionPlan({
    workspaceRoot,
    tool: localTool,
  });
  assert.equal(localPlan.profile.backend, "local");
  assert.equal(localPlan.profile.microsandbox, undefined);
  assert.equal(localPlan.guestContext.workspaceRoot, workspaceRoot);
  assert.equal(localPlan.guestContext.pluginRoot, path.join(workspaceRoot, "System", "Plugins", "VerifyLocalPlugin"));

  const sandboxTool = createTool({
    plugin: createPlugin({
      rootKind: "User",
      pluginRoot: path.join(workspaceRoot, "Plugins", "VerifyUserPlugin"),
    }),
    execution: {
      Boundary: "Sandbox",
      Network: "Deny",
      Workspace: "ReadOnly",
      LocalFallback: "Deny",
    },
  });
  const sandboxPolicy = resolveAgentToolExecutionPolicy(sandboxTool);
  const sandboxPlan = buildAgentPluginProcessExecutionPlan({
    workspaceRoot,
    tool: sandboxTool,
  });
  assert.equal(sandboxPolicy.mode, "sandbox");
  assert.equal(sandboxPolicy.network, "disabled");
  assert.equal(sandboxPolicy.workspaceMount, "readonly");
  assert.equal(sandboxPolicy.localFallback, "deny");
  assert.equal(sandboxPlan.profile.backend, "sandbox");
  assert.equal(sandboxPlan.profile.localFallback, "deny");
  assert.equal(sandboxPlan.profile.microsandbox?.guestWorkspaceRoot, "/workspace");
  assert.equal(sandboxPlan.profile.microsandbox?.guestWorkdir, "/opt/senera/runtime/Plugins/VerifyUserPlugin");
  assert.equal(sandboxPlan.guestContext.workspaceRoot, "/workspace");
  assert.equal(sandboxPlan.guestContext.pluginRoot, "/opt/senera/runtime/Plugins/VerifyUserPlugin");

  const sandboxPreferredTool = createTool({
    plugin: createPlugin({
      rootKind: "System",
      pluginRoot: path.join(workspaceRoot, "System", "Plugins", "VerifySandboxPreferredPlugin"),
    }),
    permissions: ["process:shell"],
    execution: {
      Boundary: "SandboxPreferred",
      Network: "Allow",
      Workspace: "ReadWrite",
      LocalFallback: "Allow",
    },
  });
  const sandboxPreferredPolicy = resolveAgentToolExecutionPolicy(sandboxPreferredTool);
  assert.equal(sandboxPreferredPolicy.mode, "sandbox-preferred");
  assert.equal(sandboxPreferredPolicy.network, "default");
  assert.equal(sandboxPreferredPolicy.workspaceMount, "writable");
  assert.equal(sandboxPreferredPolicy.localFallback, "allow");

  const externalLocalTool = createTool({
    plugin: createPlugin({
      rootKind: "User",
      pluginRoot: path.join(workspaceRoot, "Plugins", "VerifyExternalLocalPlugin"),
    }),
    execution: {
      Boundary: "Local",
      Network: "Deny",
      Workspace: "ReadOnly",
      LocalFallback: "Allow",
    },
  });
  assert.equal(resolveAgentToolExecutionPolicy(externalLocalTool).mode, "local");

  const missingExecutionTool = {
    ...localTool,
    execution: undefined,
  } as unknown as RegisteredTool;
  assert.throws(() => resolveAgentToolExecutionPolicy(missingExecutionTool), /工具缺少 Execution 配置/);

  console.log("Tool execution policy verification passed.");
}

function createPlugin(input: { rootKind: LoadedPlugin["rootKind"]; pluginRoot: string }): LoadedPlugin {
  return {
    rootPath: input.pluginRoot,
    rootKind: input.rootKind,
    manifestPath: path.join(input.pluginRoot, "PluginManifest.json"),
    config: {
      fileName: "PluginConfig.toml",
      path: path.join(input.pluginRoot, "PluginConfig.toml"),
      exists: false,
      source: "default",
      templateExists: false,
      needsUserConfig: false,
      toml: "",
      sections: [],
      runtime: {
        enabled: true,
        tools: {},
      },
      diagnostics: [],
    },
    manifest: {
      Plugin: {
        Name: path.basename(input.pluginRoot),
        Version: "0.0.0",
        Kind: "Tool",
        Entry: {
          Kind: "Process",
          Command: "npm",
          Args: ["run", "tool"],
          Cwd: ".",
        },
      },
      Runtime: {
        Kind: "Node",
        NodeVersion: "22",
        PackageManager: "npm",
        Install: "none",
        Script: "tool",
        SandboxProfile: "node-plugin",
      },
      Tools: [
        {
          Name: "VerifyTool",
          Execution: DefaultExecution,
        },
      ],
    },
  };
}

const DefaultExecution = {
  Boundary: "Sandbox",
  Network: "Deny",
  Workspace: "ReadOnly",
  LocalFallback: "Deny",
} satisfies ToolExecutionManifest;

function createTool(input: {
  plugin: LoadedPlugin;
  permissions?: string[];
  execution: ToolExecutionManifest;
}): RegisteredTool {
  return {
    plugin: input.plugin,
    name: "VerifyTool",
    permissions: input.permissions ?? [],
    execution: input.execution,
    handler: {
      kind: "PluginProcess",
    },
    evidenceCapabilities: [],
  };
}

main();
