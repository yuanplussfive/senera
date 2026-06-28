import assert from "node:assert/strict";
import path from "node:path";
import { loadVerificationConfig } from "./VerificationConfig.js";
import { resolveToolSearchConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import { AgentPluginScanner } from "../Source/AgentSystem/Plugin/AgentPluginScanner.js";
import { AgentToolCatalogProjector } from "../Source/AgentSystem/ToolRuntime/AgentToolCatalogProjector.js";
import { AgentToolSearchIndex } from "../Source/AgentSystem/ToolSearch/AgentToolSearchIndex.js";

void main();

function main(): void {
  const workspaceRoot = process.cwd();
  const config = loadVerificationConfig(workspaceRoot);
  const registry = new AgentPluginRegistry();
  for (const plugin of new AgentPluginScanner(workspaceRoot, config).scan()) {
    registry.registerPlugin(plugin);
  }

  const tools = registry.listTools();
  assert.ok(tools.length > 0, "registered tools should not be empty");
  for (const tool of tools) {
    const capabilities = tool.search?.Capabilities ?? [];
    assert.ok(capabilities.length > 0, `${tool.name} should declare Search.Capabilities`);
    for (const capability of capabilities) {
      assert.ok(capability.Id.includes("."), `${tool.name} capability id should use dotted namespace`);
      assert.equal(capability.Id.includes("_"), false, `${tool.name} capability id should not use underscores`);
      assert.ok(capability.Facets, `${tool.name} ${capability.Id} should declare facets`);
      assert.ok(
        Object.values(capability.Facets ?? {}).some((value) => Array.isArray(value) && value.length > 0),
        `${tool.name} ${capability.Id} should have non-empty facets`,
      );
    }
  }

  const catalog = new AgentToolCatalogProjector(registry).list();
  assert.equal(catalog.some((tool) => tool.capabilities.length > 0), true);
  assert.equal(
    catalog.every((tool) => tool.capabilities.every((capability) => !capability.id.includes("_"))),
    true,
  );

  const index = new AgentToolSearchIndex(registry, resolveToolSearchConfig(config));
  assertTopResult(index, "edit workspace file apply patch", "ApplyPatchTool", "workspace.patch-edit");
  assertTopResult(index, "run npm test shell command", "ShellCommandTool", "host.shell-command");
  assertTopResult(index, "weather forecast Shanghai rain", "WeatherTool", "weather.forecast");
  assertIncludesResult(index, "find symbol definition AgentToolSearchIndex", "FastContextSymbolSearchTool", "workspace.symbol-search");
  assertIncludesResult(index, "search exact string MaxOutputTokens", "FastContextSearchTool", "workspace.exact-search");

  console.log("Tool search capabilities verification passed.");
}

function assertTopResult(
  index: AgentToolSearchIndex,
  query: string,
  expectedTool: string,
  expectedCapability: string,
): void {
  const results = index.search({
    query,
    includeLoaded: true,
  });
  assert.ok(results.length > 0, `${query} should return results`);
  const top = results[0];
  assert.equal(top?.toolName, expectedTool, `${query} top result`);
  assertCapability(top, expectedCapability, query);
}

function assertIncludesResult(
  index: AgentToolSearchIndex,
  query: string,
  expectedTool: string,
  expectedCapability: string,
): void {
  const results = index.search({
    query,
    includeLoaded: true,
  });
  const result = results.find((entry) => entry.toolName === expectedTool);
  assert.ok(result, `${query} should include ${expectedTool}`);
  assertCapability(result, expectedCapability, query);
}

function assertCapability(
  result: NonNullable<ReturnType<AgentToolSearchIndex["search"]>[number]>,
  expectedCapability: string,
  query: string,
): void {
  assert.ok(
    result.matchedCapabilities.some((capability) => capability.id === expectedCapability),
    `${query} should explain matched capability ${expectedCapability}`,
  );
}
