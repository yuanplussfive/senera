import assert from "node:assert/strict";
import { AgentSystemRuntime } from "../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import { parseControllerDecision } from "../Source/AgentSystem/Interaction/AgentControllerDecision.js";
import { parsePiToolArgumentsDraft } from "../Source/AgentSystem/PiProxy/AgentPiAssistantMessageSchema.js";
import { createIsolatedVerificationRuntimeConfig } from "./VerificationRuntimeConfig.js";

void main();

async function main(): Promise<void> {
  const sourceRoot = process.cwd();
  const isolatedConfig = await createIsolatedVerificationRuntimeConfig(sourceRoot);
  const workspaceRoot = sourceRoot;
  const runtime = AgentSystemRuntime.load({
    workspaceRoot,
    configPath: isolatedConfig.configPath,
    toolSearchMemoryStore: isolatedConfig.createToolSearchMemoryStore(),
  });

  try {
    const commandToolName = "ShellCommandTool";
    const patchToolName = "WorkspaceApplyPatch";
    const visibleTools = [commandToolName, patchToolName];
    const toolDefinitions = runtime.services.pi.toolDefinitions({
      visibleToolNames: visibleTools,
    });
    const command = toolDefinitions.find((tool) => tool.name === commandToolName);
    const patch = toolDefinitions.find((tool) => tool.name === patchToolName);

    assert.ok(command, `${commandToolName} Pi tool should be projected.`);
    assert.ok(patch, `${patchToolName} Pi tool should be projected.`);
    assert.deepEqual(schemaFieldNames(command.parameters), [
      "command",
      "cwd",
      "timeoutMs",
      "justification",
      "executionTarget",
    ]);
    assert.deepEqual(schemaFieldNames(patch.parameters), ["operations", "dryRun", "fuzzFactor"]);

    const contract = runtime.registry.getTool(commandToolName)?.contract?.arguments;
    assert.deepEqual(
      contract?.properties.map((property) => property.name),
      ["command", "cwd", "timeoutMs", "justification"],
    );

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
    runtime.toolSearch.close();
    await isolatedConfig.dispose();
  }
}

function schemaFieldNames(schema: Record<string, unknown>): string[] {
  const properties = schema.properties;
  return properties && typeof properties === "object" && !Array.isArray(properties) ? Object.keys(properties) : [];
}
