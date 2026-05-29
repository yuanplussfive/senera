import assert from "node:assert/strict";
import path from "node:path";
import { AgentConfigLoader } from "../Source/AgentSystem/AgentConfigLoader.js";
import { AgentPluginScanner } from "../Source/AgentSystem/AgentPluginScanner.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/AgentPluginRegistry.js";
import { AgentToolProcessRunner } from "../Source/AgentSystem/AgentToolProcessRunner.js";
import { createXmlProtocolSpec } from "../Source/AgentSystem/AgentXmlPolicy.js";

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const config = AgentConfigLoader.load(path.join(workspaceRoot, "senera.config.json"));
  const protocol = createXmlProtocolSpec(config);
  const registry = new AgentPluginRegistry();
  for (const plugin of new AgentPluginScanner(workspaceRoot, config).scan()) {
    registry.registerPlugin(plugin);
  }

  const tool = registry.getTool("TaskPrioritizerTool");
  assert.ok(tool, "TaskPrioritizerTool should be registered");
  const fastContextTool = registry.getTool("FastContextSearchTool");
  assert.ok(fastContextTool, "FastContextSearchTool should be registered");

  const runner = new AgentToolProcessRunner(config, protocol, workspaceRoot);
  const result = await runner.run(tool, {
    tasks: {
      item: [{
        title: "Ship plugin runtime verification",
        impact: 5,
        urgency: 4,
        effort: 2,
        blocked: "false",
      }],
    },
  });

  assert.equal(result.response.ok, true);
  const toolResult = result.response.result as { totalTasks?: unknown } | undefined;
  assert.equal(toolResult?.totalTasks, 1);
  assert.equal(path.basename(tool.plugin.rootPath), "TaskPrioritizerToolPlugin");

  const fastContextResult = await runner.run(fastContextTool, {
    query: "runToolPluginSuite",
    maxResults: 3,
    contextLines: 2,
  });
  assert.equal(fastContextResult.response.ok, true);
  const searchResult = fastContextResult.response.result as {
    results?: { item?: Array<{ path?: unknown }> };
  } | undefined;
  assert.ok((searchResult?.results?.item?.length ?? 0) > 0);
  assert.equal(path.basename(fastContextTool.plugin.rootPath), "FastContextSearchToolPlugin");
  console.log("Tool plugin runtime verification passed.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
