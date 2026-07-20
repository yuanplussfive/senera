import assert from "node:assert/strict";
import path from "node:path";
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
  assert.equal(sandboxPolicy.mode, "sandbox");
  assert.equal(sandboxPolicy.network, "disabled");
  assert.equal(sandboxPolicy.workspaceMount, "readonly");
  assert.equal(sandboxPolicy.localFallback, "deny");

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
      ManifestVersion: 2,
      Plugin: {
        Name: path.basename(input.pluginRoot),
        Version: "0.0.0",
        Kind: "Tool",
      },
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
    loading: "Dynamic",
    permissions: input.permissions ?? [],
    execution: input.execution,
    handler: {
      kind: "HostCapability",
      capability: "verify",
    },
    runtime: { Lifecycle: "Immediate", ProtocolVersion: 2 },
    evidenceCapabilities: [],
  };
}

main();
