import assert from "node:assert/strict";
import { AgentSystemRuntime } from "../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import { parseControllerDecision } from "../Source/AgentSystem/Interaction/AgentControllerDecision.js";
import { parsePiToolArgumentsDraft } from "../Source/AgentSystem/Pi/AgentPiAssistantMessageSchema.js";
import { AgentPiNativeToolBridgeName } from "../Source/AgentSystem/Pi/AgentPiNativeToolBridge.js";
import { createAgentToolAccessGrant } from "../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { ToolLoadingModes } from "../Source/AgentSystem/Types/AgentToolContractTypes.js";
import { createIsolatedVerificationRuntimeConfig } from "./VerificationRuntimeConfig.js";

void main();

async function main(): Promise<void> {
  const sourceRoot = process.cwd();
  const isolatedConfig = await createIsolatedVerificationRuntimeConfig(sourceRoot);
  const workspaceRoot = sourceRoot;
  const runtime = AgentSystemRuntime.load({
    workspaceRoot,
    configPath: isolatedConfig.configPath,
    toolSearchScenarioSource: isolatedConfig.createToolSearchScenarioSource(),
  });

  try {
    const commandToolName = "ShellCommandTool";
    const patchToolName = "WorkspaceApplyPatch";
    const visibleTools = [commandToolName, patchToolName];
    const toolAccessGrant = createAgentToolAccessGrant({
      authorizedToolNames: visibleTools,
      exposedToolNames: visibleTools,
      preferredToolNames: visibleTools,
    });
    const command = runtime.registry.getTool(commandToolName);
    const patch = runtime.registry.getTool(patchToolName);

    assert.ok(command, `${commandToolName} must be registered.`);
    assert.ok(patch, `${patchToolName} must be registered.`);
    assert.equal(command.loading, ToolLoadingModes.Bootstrap);
    assert.equal(patch.loading, ToolLoadingModes.Bootstrap);
    assert.deepEqual(schemaFieldNames(command.contract?.arguments?.jsonSchema ?? {}), [
      "command",
      "cwd",
      "timeoutMs",
      "workspaceEffect",
    ]);
    assert.deepEqual(schemaFieldNames(patch.contract?.arguments?.jsonSchema ?? {}), ["operations"]);

    const contract = command.contract?.arguments;
    assert.deepEqual(
      contract?.properties.map((property) => property.name),
      ["command", "cwd", "timeoutMs", "workspaceEffect"],
    );

    const nativeDefinitions = runtime.services.pi.toolDefinitions({ toolAccessGrant });
    assert.equal(
      nativeDefinitions.some((tool) => tool.name === commandToolName),
      true,
    );
    assert.equal(
      nativeDefinitions.some((tool) => tool.name === patchToolName),
      true,
    );
    const bridge = nativeDefinitions.find((tool) => tool.name === AgentPiNativeToolBridgeName);
    assert.ok(bridge, "Native Pi tools must include the dynamic-tool execution bridge.");
    assert.deepEqual(schemaFieldNames(bridge.parameters), ["tool", "arguments"]);

    const action = parseControllerDecision(
      {
        kind: "Execute",
        fragment: {
          preface: "我先搜索配置引用，再读取命中的文件。",
          calls: [
            {
              toolName: commandToolName,
              purpose: "定位 ModelProviders 配置引用。",
              required: true,
            },
            {
              toolName: patchToolName,
              purpose: "在确认目标后应用原子补丁。",
              required: true,
              dependsOn: [0],
            },
          ],
        },
      },
      {
        allowedTools: visibleTools,
      },
    );
    assert.equal(action.kind === "Execute" ? action.fragment.calls[1]?.dependsOn?.[0] : undefined, 0);

    const argumentsDraft = parsePiToolArgumentsDraft({
      arguments: {
        command: { mode: "shell", dialect: "powershell", script: "rg ModelProviders Source" },
        cwd: ".",
      },
      missingInputs: [],
      assumptions: [],
    });
    assert.equal(argumentsDraft.arguments.cwd, ".");

    assert.throws(
      () =>
        parseControllerDecision(
          {
            kind: "Execute",
            fragment: {
              preface: "invalid dependency",
              calls: [
                {
                  toolName: commandToolName,
                  purpose: "Search.",
                  required: true,
                  dependsOn: [0],
                },
              ],
            },
          },
          {
            allowedTools: visibleTools,
          },
        ),
      /dependsOn/,
    );

    console.log("Tool signature mapping and Pi tool-call validation verified.");
  } finally {
    await runtime.close();
    await isolatedConfig.dispose();
  }
}

function schemaFieldNames(schema: Record<string, unknown>): string[] {
  const properties = schema.properties;
  return properties && typeof properties === "object" && !Array.isArray(properties) ? Object.keys(properties) : [];
}
