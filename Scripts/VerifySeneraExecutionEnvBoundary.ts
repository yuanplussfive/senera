import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import {
  AgentHostCapabilityNames,
  createDefaultHostCapabilityRegistry,
} from "../Source/AgentSystem/AgentDefaultHostCapabilities.js";
import { SeneraLocalExecutionEnv } from "../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import type {
  SeneraPersistentProcessChild,
  SeneraPersistentProcessSpawnOptions,
} from "../Source/AgentSystem/Execution/SeneraPersistentProcessTypes.js";
import { AgentExecutionResourceBroker } from "../Source/AgentSystem/ExecutionResources/AgentExecutionResourceBroker.js";
import { resolveAgentExecutionResourceLimits } from "../Source/AgentSystem/ExecutionResources/AgentExecutionResourceConfig.js";
import { AgentToolRunner } from "../Source/AgentSystem/ToolRuntime/AgentToolRunner.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import type { AgentExtensionRegistryLike } from "../Source/AgentSystem/Types/ToolRuntimeTypes.js";

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
  const processRequests: PersistentProcessRequest[] = [];
  const executionEnv = new SeneraLocalExecutionEnv({
    workspaceRoot: WorkspaceRoot,
    persistentProcessSpawner: async (command, args, options) => {
      processRequests.push({ command, args, options });
      const child = new VerificationPersistentProcessChild();
      setImmediate(() => {
        child.stdout.emit("data", Buffer.from("boundary\n"));
        child.emitClose(0);
      });
      return child;
    },
  });
  const broker = new AgentExecutionResourceBroker({
    workspaceRoot: WorkspaceRoot,
    executionEnv,
    limits: resolveAgentExecutionResourceLimits(VerificationConfig),
  });
  const shellTool = createTool();
  const runner = new AgentToolRunner(
    VerificationConfig,
    WorkspaceRoot,
    createDefaultHostCapabilityRegistry({ executionResources: broker }),
    createRegistry([shellTool]),
    executionEnv,
  );

  const dialect = process.platform === "win32" ? "powershell" : "posix-sh";
  let outputCaptureDirectory: string | undefined;
  try {
    const result = await runner.run(
      shellTool,
      {
        command: { mode: "shell", dialect, script: "echo boundary" },
        cwd: ".",
      },
      {
        sessionId: "verification-session",
        requestId: "verification-request",
        step: 1,
        toolCallId: "verification-tool-call",
      },
    );
    outputCaptureDirectory = result.outputCapture?.directory;

    assert.equal(result.response.ok, true, JSON.stringify(result.response));
    assert.equal(result.stdout, "boundary\n");
    assert.equal(processRequests.length, 1);
    const request = processRequests[0];
    assert.ok(request);
    assert.equal(request.command, "echo boundary");
    assert.deepEqual(request.args, []);
    assert.equal(request.options.cwd, WorkspaceRoot);
    assert.equal(request.options.shellCommand?.dialect, dialect);
    assert.equal(request.options.shellCommand?.script, "echo boundary");
    assert.equal(request.options.profile?.backend, "local");
    assert.equal(request.options.profile?.sandbox, undefined);
    console.log("Senera execution env boundary verification passed.");
  } finally {
    await runner.close();
    await broker.close();
    if (outputCaptureDirectory) {
      await fs.rm(outputCaptureDirectory, { recursive: true, force: true });
    }
  }
}

interface PersistentProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: SeneraPersistentProcessSpawnOptions;
}

class VerificationPersistentProcessChild extends EventEmitter implements SeneraPersistentProcessChild {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin = {
    write: (): boolean => true,
    once: (_event: "drain", _listener: () => void): void => undefined,
    end: (): void => undefined,
  };
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    void this.terminateTree(signal);
    return true;
  }

  async terminateTree(signal: NodeJS.Signals): Promise<void> {
    if (this.exitCode !== null || this.signalCode !== null) return;
    queueMicrotask(() => this.emitClose(null, signal));
  }

  emitClose(exitCode: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = exitCode;
    this.signalCode = signal;
    this.emit("close", exitCode, signal);
  }
}

const DefaultExecution = {
  Targets: ["Local"],
  Network: "Deny",
  Workspace: "ReadWrite",
} satisfies import("../Source/AgentSystem/Types/AgentToolContractTypes.js").ToolExecutionManifest;

function createTool(): RegisteredTool {
  return {
    owner: {
      kind: "system",
      name: "verify-execution-env",
      rootPath: WorkspaceRoot,
      revision: "test",
      trusted: true,
      requiresApproval: false,
    },
    name: "ShellCommandTool",
    loading: "Dynamic",
    permissions: [],
    sources: [],
    handler: { kind: "HostCapability", capability: AgentHostCapabilityNames.ShellRun },
    runtime: { Lifecycle: "Immediate", ProtocolVersion: 2, ResultAssessment: "ProcessExit" },
    execution: DefaultExecution,
    childGrant: "inherit",
    evidenceCapabilities: [],
  };
}

function createRegistry(tools: readonly RegisteredTool[]): AgentExtensionRegistryLike {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return { getTool: (name) => byName.get(name) };
}

await main();
