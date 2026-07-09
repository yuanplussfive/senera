import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentSystemRuntime } from "../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const workspaceRoot = process.cwd();

async function main(): Promise<void> {
  const tempRoot = path.join(workspaceRoot, ".senera", "tmp", `external-plugin-${process.pid}-${Date.now()}`);
  const userPluginsRoot = path.join(tempRoot, "Plugins");
  const pluginRoot = path.join(userPluginsRoot, "VerifyExternalPlugin");

  try {
    await mkdir(pluginRoot, { recursive: true });
    await writeVerificationPlugin(pluginRoot);

    const runtime = AgentSystemRuntime.fromConfig({
      workspaceRoot,
      configPath: path.join(workspaceRoot, "senera.config.json"),
      config: verificationConfig(userPluginsRoot),
    });
    try {
      const tool = runtime.registry.getTool("VerifyExternalMicroVmTool");
      assert.equal(tool?.plugin.rootKind, "User");
      assert.equal(tool.plugin.manifest.Security?.TrustLevel, "External");

      const result = await runtime.services.execution.executeToolCall({
        name: "VerifyExternalMicroVmTool",
        arguments: {
          marker: "microvm",
        },
      }, {
        requestId: "verify-external-microvm",
        step: 1,
        loadedToolNames: "all",
      });

      assert.equal(result.kind, "ToolResults");
      const execution = result.value[0];
      assert.equal(execution?.process.exitCode, 0);
      const observed = execution?.result as Record<string, unknown>;
      assert.equal(observed.marker, "microvm");
      assert.equal(observed.platform, "linux");
      assert.equal(observed.workspaceRoot, "/workspace");
      assert.equal(observed.cwd, observed.pluginRoot);
      assert.match(String(observed.pluginRoot), /^\/opt\/senera\/runtime\//);
      assert.match(String(observed.pluginRoot), /\/Plugins\/VerifyExternalPlugin$/);
    } finally {
      runtime.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  console.log("External plugin microVM verification passed.");
}

async function writeVerificationPlugin(pluginRoot: string): Promise<void> {
  await writeFile(
    path.join(pluginRoot, "package.json"),
    JSON.stringify({
      type: "module",
      scripts: {
        tool: "node index.js",
      },
      dependencies: {},
    }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(pluginRoot, "PluginManifest.json"),
    JSON.stringify({
      Plugin: {
        Name: "VerifyExternalPlugin",
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
      Sandbox: {
        Network: "Deny",
        Workspace: {
          Read: [],
          Write: [],
        },
        State: {
          Write: [],
        },
      },
      Tools: [{
        Name: "VerifyExternalMicroVmTool",
        Handler: {
          Kind: "PluginProcess",
        },
        Execution: {
          Boundary: "Sandbox",
          Network: "Deny",
          Workspace: "ReadOnly",
          LocalFallback: "Deny",
        },
        Permissions: [],
      }],
      Security: {
        TrustLevel: "External",
        Network: "Deny",
        FileSystem: {
          Read: [],
          Write: [],
        },
        RequiresApproval: false,
      },
    }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(pluginRoot, "index.js"),
    `
const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
process.stdout.write(JSON.stringify({
  type: "tool_result",
  version: 1,
  ok: true,
  result: {
    marker: request.arguments.marker,
    platform: process.platform,
    cwd: process.cwd(),
    workspaceRoot: request.context.workspaceRoot,
    pluginRoot: request.context.pluginRoot
  }
}) + "\\n");
`.trimStart(),
    "utf8",
  );
}

function verificationConfig(userPluginsRoot: string): AgentSystemConfig {
  return {
    PluginRoots: {
      System: [],
      User: [userPluginsRoot],
    },
    Server: {
      Host: "127.0.0.1",
      Port: 8787,
    },
    DefaultModelProviderId: "verification-model",
    ModelProviderEndpoints: [{
      Id: "verification-provider",
      BaseUrl: "https://example.invalid/v1",
      ApiKey: "verification-key",
    }],
    ModelProviders: [{
      Id: "verification-model",
      ProviderId: "verification-provider",
      Endpoint: "ChatCompletions",
      Model: "verification-model",
    }],
    ToolExecution: {
      TimeoutSeconds: 30,
      MaxStdoutBytes: 1024 * 1024,
      MaxStderrBytes: 1024 * 1024,
    },
  };
}

await main();
