import assert from "node:assert/strict";
import path from "node:path";
import {
  AgentHostCapabilityNames,
  createDefaultHostCapabilityRegistry,
} from "../Source/AgentSystem/AgentDefaultHostCapabilities.js";
import { SeneraLocalExecutionEnv } from "../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import type {
  SeneraShellExecutionRequest,
  SeneraShellExecutionResult,
} from "../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import { AgentToolRunner } from "../Source/AgentSystem/ToolRuntime/AgentToolRunner.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { LoadedPlugin, RegisteredTool } from "../Source/AgentSystem/Types/PluginRuntimeTypes.js";
import type { AgentPluginRegistryLike } from "../Source/AgentSystem/Types/ToolRuntimeTypes.js";

const WorkspaceRoot = process.cwd();
const VerificationConfig: AgentSystemConfig = {
  Server: { Host: "127.0.0.1", Port: 8787 },
  DefaultModelProviderId: "verification-model",
  ModelProviderEndpoints: [
    { Id: "verification-provider", BaseUrl: "https://example.invalid/v1", ApiKey: "verification-key" },
  ],
  ModelProviders: [
    {
      Id: "verification-model",
      ProviderId: "verification-provider",
      Endpoint: "ChatCompletions",
      Model: "verification-model",
    },
  ],
  ToolExecution: {
    TimeoutSeconds: 5,
    MaxStdoutBytes: 1024 * 1024,
    MaxStderrBytes: 1024 * 1024,
  },
};

async function main(): Promise<void> {
  const executionEnv = new SpySeneraExecutionEnv({ workspaceRoot: WorkspaceRoot });
  const plugin = createPlugin();
  const shellTool = createTool(plugin);
  const runner = new AgentToolRunner(
    VerificationConfig,
    WorkspaceRoot,
    createDefaultHostCapabilityRegistry(),
    createRegistry([shellTool]),
    executionEnv,
  );

  const dialect = process.platform === "win32" ? "powershell" : "posix-sh";
  const result = await runner.run(shellTool, {
    command: { mode: "shell", dialect, script: "echo boundary" },
    cwd: ".",
  });
  assert.equal(result.response.ok, true);
  assert.equal(executionEnv.shellRequests.length, 1);
  assert.equal(executionEnv.shellRequests[0].command, "echo boundary");
  assert.equal(executionEnv.shellRequests[0].dialect, dialect);
  assert.equal(executionEnv.shellRequests[0].cwd, WorkspaceRoot);
  console.log("Senera execution env boundary verification passed.");
}

class SpySeneraExecutionEnv extends SeneraLocalExecutionEnv {
  readonly shellRequests: SeneraShellExecutionRequest[] = [];

  override async executeShell(request: SeneraShellExecutionRequest): Promise<SeneraShellExecutionResult> {
    this.shellRequests.push(request);
    return { stdout: "boundary\n", stderr: "", exitCode: 0, signal: null };
  }
}

function createPlugin(): LoadedPlugin {
  return {
    rootPath: WorkspaceRoot,
    rootKind: "System",
    manifestPath: path.join(WorkspaceRoot, "PluginManifest.json"),
    config: {
      fileName: "PluginConfig.toml",
      path: path.join(WorkspaceRoot, "PluginConfig.toml"),
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
      Plugin: { Name: "VerifySeneraExecutionEnvPlugin", Version: "0.0.0", Kind: "Tool" },
      Tools: [
        {
          Name: "ShellCommandTool",
          Handler: { Kind: "HostCapability", Capability: AgentHostCapabilityNames.ShellRun },
          Runtime: { Lifecycle: "Immediate", ProtocolVersion: 2 },
          Execution: DefaultExecution,
        },
      ],
    },
  };
}

const DefaultExecution = {
  Targets: ["Local"],
  Network: "Deny",
  Workspace: "ReadWrite",
} satisfies import("../Source/AgentSystem/Types/PluginManifestTypes.js").ToolExecutionManifest;

function createTool(plugin: LoadedPlugin): RegisteredTool {
  return {
    plugin,
    name: "ShellCommandTool",
    loading: "Dynamic",
    permissions: [],
    sources: [],
    handler: { kind: "HostCapability", capability: AgentHostCapabilityNames.ShellRun },
    runtime: { Lifecycle: "Immediate", ProtocolVersion: 2 },
    execution: DefaultExecution,
    evidenceCapabilities: [],
  };
}

function createRegistry(tools: readonly RegisteredTool[]): AgentPluginRegistryLike {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return { getTool: (name) => byName.get(name) };
}

await main();
