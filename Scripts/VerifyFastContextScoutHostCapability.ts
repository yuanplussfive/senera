import assert from "node:assert/strict";
import { AgentSystemRuntime } from "../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import { fastContextScoutHostTool } from "../Source/AgentSystem/AgentFastContextScoutRuntime.js";
import { VerificationConfigFileName, verificationConfigPath } from "./VerificationConfig.js";

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const runtime = AgentSystemRuntime.load({
    workspaceRoot,
    configPath: verificationConfigPath(workspaceRoot),
  });
  const tool = runtime.registry.getTool("FastContextScoutTool");
  assert.ok(tool, "FastContextScoutTool should be registered.");
  assert.equal(tool.handler.kind, "HostCapability");
  if (tool.handler.kind === "HostCapability") {
    assert.equal(tool.handler.capability, "workspace.context.scout");
  }

  const execution = await fastContextScoutHostTool({
    question: "主模型配置文件怎么写？",
    planningMode: "deterministic",
    hints: {
      item: [
        VerificationConfigFileName,
        "DefaultModelProviderId",
        "ModelProviders",
      ],
    },
    exclude: {
      item: [
        "senera.config.json",
      ],
    },
    maxFiles: 6,
    maxResults: 8,
    readLineWindow: 180,
  }, {
    tool,
    config: runtime.config,
    configPath: runtime.configPath,
    workspaceRoot: runtime.workspaceRoot,
    registry: runtime.registry,
  });

  assert.equal(execution.response.ok, true);
  if (!execution.response.ok) {
    throw new Error(execution.response.error?.message ?? "Scout host capability failed.");
  }

  const result = execution.response.result as {
    files?: {
      item?: Array<{
        path: string;
        content: string;
      }>;
    };
  };
  const configFile = result.files?.item?.find((file) => file.path === VerificationConfigFileName);
  assert.ok(configFile, `Scout host capability should return ${VerificationConfigFileName}.`);
  assert.match(configFile.content, /DefaultModelProviderId/);
  assert.match(configFile.content, /ModelProviders/);
  console.log("Fast context scout host capability verification passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
