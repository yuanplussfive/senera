import assert from "node:assert/strict";
import path from "node:path";
import { loadVerificationConfig } from "./VerificationConfig.js";
import { AgentPluginScanner } from "../Source/AgentSystem/Plugin/AgentPluginScanner.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import { AgentToolProcessRunner } from "../Source/AgentSystem/ToolRuntime/AgentToolProcessRunner.js";
import { createXmlProtocolSpec } from "../Source/AgentSystem/Xml/AgentXmlPolicy.js";

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const config = loadVerificationConfig(workspaceRoot);
  const protocol = createXmlProtocolSpec(config);
  const registry = new AgentPluginRegistry();
  for (const plugin of new AgentPluginScanner(workspaceRoot, config).scan()) {
    registry.registerPlugin(plugin);
  }

  const fastContextTool = registry.getTool("FastContextSearchTool");
  assert.ok(fastContextTool, "FastContextSearchTool should be registered");

  const runner = new AgentToolProcessRunner(config, protocol, workspaceRoot);
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
