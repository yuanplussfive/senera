import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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
import type {
  AgentToolProcessChild,
  AgentToolProcessSpawner,
  AgentToolProcessSpawnOptions,
} from "../Source/AgentSystem/ToolRuntime/AgentToolProcessTypes.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { LoadedPlugin, RegisteredTool } from "../Source/AgentSystem/Types/PluginRuntimeTypes.js";
import type { AgentPluginRegistryLike } from "../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import { createXmlProtocolSpec } from "../Source/AgentSystem/Xml/AgentXmlPolicy.js";
import { AgentExecutionErrorCodes } from "../Source/AgentSystem/Xml/AgentXmlStatus.js";

const WorkspaceRoot = process.cwd();
const VerificationConfig: AgentSystemConfig = {
  Server: {
    Host: "127.0.0.1",
    Port: 8787,
  },
  DefaultModelProviderId: "verification-model",
  ModelProviderEndpoints: [
    {
      Id: "verification-provider",
      BaseUrl: "https://example.invalid/v1",
      ApiKey: "verification-key",
    },
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
  const spawned: Array<{ command: string; args: string[]; cwd: string }> = [];
  const requests: string[] = [];
  const executionEnv = new SpySeneraExecutionEnv({
    workspaceRoot: WorkspaceRoot,
    processSpawner: createFakeSpawner(spawned, requests),
  });
  const plugin = createPlugin();
  const shellTool = createTool("ShellCommandTool", plugin, {
    kind: "HostCapability",
    capability: AgentHostCapabilityNames.ShellRun,
  });
  const pluginTool = createTool("VerifyPluginProcessTool", plugin, {
    kind: "PluginProcess",
  });
  const runner = new AgentToolRunner(
    VerificationConfig,
    createXmlProtocolSpec(VerificationConfig),
    WorkspaceRoot,
    createDefaultHostCapabilityRegistry(),
    createRegistry([shellTool, pluginTool]),
    executionEnv,
  );

  const shellResult = await runner.run(shellTool, {
    command: "echo boundary",
    cwd: ".",
  });
  assert.equal(shellResult.response.ok, true);
  assert.equal(executionEnv.shellRequests.length, 1);
  assert.equal(executionEnv.shellRequests[0].command, "echo boundary");
  assert.equal(executionEnv.shellRequests[0].cwd, WorkspaceRoot);

  const pluginResult = await runner.run(pluginTool, {
    value: "through-env",
  });
  assert.equal(pluginResult.response.ok, true);
  assert.deepEqual(spawned, [
    {
      command: "node",
      args: ["verify-plugin.js"],
      cwd: WorkspaceRoot,
    },
  ]);
  assert.deepEqual(JSON.parse(requests[0] ?? ""), {
    type: "tool_request",
    version: 1,
    tool: "VerifyPluginProcessTool",
    arguments: {
      value: "through-env",
    },
    context: {
      workspaceRoot: WorkspaceRoot,
      pluginRoot: WorkspaceRoot,
    },
  });

  const outsideCwdResult = await runner.run(
    {
      ...pluginTool,
      plugin: createPlugin(".."),
    },
    {},
  );
  assert.equal(outsideCwdResult.response.ok, false);
  assert.equal(outsideCwdResult.response.error?.code, AgentExecutionErrorCodes.ToolProcessConfigurationInvalid);

  console.log("Senera execution env boundary verification passed.");
}

class SpySeneraExecutionEnv extends SeneraLocalExecutionEnv {
  readonly shellRequests: SeneraShellExecutionRequest[] = [];

  override async executeShell(request: SeneraShellExecutionRequest): Promise<SeneraShellExecutionResult> {
    this.shellRequests.push(request);
    return {
      stdout: "boundary\n",
      stderr: "",
      exitCode: 0,
      signal: null,
    };
  }
}

class FakeReadable extends EventEmitter {
  on(event: "data", listener: (chunk: Buffer) => void): this {
    return super.on(event, listener);
  }
}

class FakeToolProcessChild extends EventEmitter implements AgentToolProcessChild {
  readonly stdout = new FakeReadable();
  readonly stderr = new FakeReadable();
  readonly stdin: AgentToolProcessChild["stdin"];

  constructor(private readonly onInput: (chunk?: string) => void) {
    super();
    this.stdin = {
      end: (chunk?: string) => {
        this.onInput(chunk);
        queueMicrotask(() => {
          this.stdout.emit(
            "data",
            Buffer.from(
              `${JSON.stringify({
                type: "tool_result",
                version: 1,
                ok: true,
                result: {
                  source: "senera-execution-env",
                },
              })}\n`,
            ),
          );
          this.emit("close", 0, null);
        });
      },
    };
  }

  kill(): boolean {
    this.emit("close", null, "SIGTERM");
    return true;
  }
}

function createFakeSpawner(
  spawned: Array<{ command: string; args: string[]; cwd: string }>,
  requests: string[],
): AgentToolProcessSpawner {
  return (command: string, args: string[], options: AgentToolProcessSpawnOptions) => {
    spawned.push({
      command,
      args,
      cwd: options.cwd,
    });
    return new FakeToolProcessChild((chunk) => {
      requests.push(chunk ?? "");
    });
  };
}

function createPlugin(cwd = "."): LoadedPlugin {
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
      runtime: {
        enabled: true,
        tools: {},
      },
      diagnostics: [],
    },
    manifest: {
      Plugin: {
        Name: "VerifySeneraExecutionEnvPlugin",
        Version: "0.0.0",
        Kind: "Tool",
        Entry: {
          Kind: "Process",
          Command: "node",
          Args: ["verify-plugin.js"],
          Cwd: cwd,
        },
      },
      Tools: [
        {
          Name: "VerifyPluginProcessTool",
          Handler: {
            Kind: "PluginProcess",
          },
          Execution: DefaultExecution,
        },
      ],
    },
  };
}

const DefaultExecution = {
  Boundary: "Local",
  Network: "Deny",
  Workspace: "ReadOnly",
  LocalFallback: "Allow",
} as const;

function createTool(name: string, plugin: LoadedPlugin, handler: RegisteredTool["handler"]): RegisteredTool {
  return {
    plugin,
    name,
    permissions: [],
    handler,
    execution: DefaultExecution,
    evidenceCapabilities: [],
  };
}

function createRegistry(tools: readonly RegisteredTool[]): AgentPluginRegistryLike {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    getTool: (name) => byName.get(name),
  };
}

await main();
