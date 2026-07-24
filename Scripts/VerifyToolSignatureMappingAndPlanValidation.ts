import assert from "node:assert/strict";
import { AgentSystemRuntime } from "../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import {
  parsePiControllerAction,
  parsePiToolArgumentsDraft,
} from "../Source/AgentSystem/PiProxy/AgentPiAssistantMessageSchema.js";
import { createIsolatedVerificationRuntimeConfig } from "./VerificationRuntimeConfig.js";

void main();

async function main(): Promise<void> {
  const sourceRoot = process.cwd();
  const isolatedConfig = await createIsolatedVerificationRuntimeConfig(sourceRoot);
  const workspaceRoot = sourceRoot;
  const runtime = AgentSystemRuntime.load({
    workspaceRoot,
    configPath: isolatedConfig.configPath,
  });

  try {
    const visibleTools = ["WorkspaceGrep", "WorkspaceReadFile"];
    const toolDefinitions = runtime.services.pi.toolDefinitions({
      visibleToolNames: visibleTools,
    });
    const grep = toolDefinitions.find((tool) => tool.name === "WorkspaceGrep");
    const readFile = toolDefinitions.find((tool) => tool.name === "WorkspaceReadFile");

    assert.ok(grep, "WorkspaceGrep Pi tool should be projected.");
    assert.ok(readFile, "WorkspaceReadFile Pi tool should be projected.");
    assert.deepEqual(schemaFieldNames(grep.parameters), [
      "pattern",
      "path",
      "caseSensitive",
      "filePattern",
      "maxResults",
      "context",
    ]);
    assert.deepEqual(schemaFieldNames(readFile.parameters), ["path", "head", "tail"]);

    const contract = runtime.registry.getTool("WorkspaceGrep")?.contract?.arguments;
    assert.deepEqual(
      contract?.properties.map((property) => property.name),
      schemaFieldNames(grep.parameters),
    );

    const action = parsePiControllerAction(
      {
        kind: "CallTools",
        preface: "我先搜索配置引用，再读取命中的文件。",
        calls: [
          {
            toolName: "WorkspaceGrep",
            purpose: "定位 ModelProviders 配置引用。",
            required: true,
          },
          {
            toolName: "WorkspaceReadFile",
            purpose: "读取搜索命中的配置文件。",
            required: true,
            dependsOn: [0],
          },
        ],
      },
      {
        allowedTools: visibleTools,
      },
    );
    assert.equal(action.calls?.[1]?.dependsOn?.[0], 0);

    const argumentsDraft = parsePiToolArgumentsDraft({
      arguments: {
        pattern: "ModelProviders",
        path: ".",
      },
      missingInputs: [],
      assumptions: [],
    });
    assert.equal(argumentsDraft.arguments.pattern, "ModelProviders");

    assert.throws(
      () =>
        parsePiControllerAction(
          {
            kind: "CallTools",
            preface: "invalid dependency",
            calls: [
              {
                toolName: "WorkspaceGrep",
                purpose: "Search.",
                required: true,
                dependsOn: [0],
              },
            ],
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
