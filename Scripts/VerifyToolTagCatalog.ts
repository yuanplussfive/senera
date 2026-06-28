import assert from "node:assert/strict";
import path from "node:path";
import { loadVerificationConfig } from "./VerificationConfig.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import { AgentPluginScanner } from "../Source/AgentSystem/Plugin/AgentPluginScanner.js";
import { AgentToolCatalogProjector, type AgentToolCatalogItem } from "../Source/AgentSystem/ToolRuntime/AgentToolCatalogProjector.js";
import { AgentToolTagCatalogProjector } from "../Source/AgentSystem/ToolRuntime/AgentToolTagCatalogProjector.js";

void main();

function main(): void {
  const workspaceRoot = process.cwd();
  const config = loadVerificationConfig(workspaceRoot);
  const registry = new AgentPluginRegistry();
  const plugins = new AgentPluginScanner(workspaceRoot, config).scan();

  for (const plugin of plugins) {
    registry.registerPlugin(plugin);
  }

  const toolCatalog = new AgentToolCatalogProjector(registry).list();
  const tagCatalog = new AgentToolTagCatalogProjector().project({ tools: toolCatalog });
  const expectedTags = normalizedUnique(
    toolCatalog
      .filter((tool) => tool.rootKind !== "System")
      .flatMap((tool) => tool.tags),
  );

  assert.deepEqual(tagCatalog, expectedTags);
  assert.equal(tagCatalog.some((tag) => tag.length === 0), false);

  assert.equal(plugins.some((plugin) => "Discovery" in plugin.manifest), false);
  assert.equal(registry.listTools().some((tool) => "Keywords" in (tool.search ?? {})), false);
  assert.equal(registry.listSkills().some((skill) => "Keywords" in (skill.search ?? {})), false);
  assert.equal(registry.listAgentWorkflows().some((workflow) =>
    "Keywords" in (workflow.search ?? {}) || "Keywords" in workflow.trigger), false);

  assert.deepEqual(
    new AgentToolTagCatalogProjector().project({ tools: projectorFixtureTools(), includeSystem: false }),
    ["external tag"],
  );
  assert.deepEqual(
    new AgentToolTagCatalogProjector().project({ tools: projectorFixtureTools(), includeSystem: true }),
    ["external tag", "system tag"],
  );

  console.log("Tool tag catalog verification passed.");
}

function normalizedUnique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.normalize("NFKC").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function projectorFixtureTools(): AgentToolCatalogItem[] {
  const base: Omit<AgentToolCatalogItem, "name" | "rootKind" | "tags"> = {
    title: "",
    summary: "",
    capabilities: [],
    useCases: [],
    examples: [],
    avoid: [],
    permissions: [],
    evidenceCapabilities: [],
  };

  return [
    {
      ...base,
      name: "SystemFixtureTool",
      rootKind: "System",
      tags: ["system tag"],
    },
    {
      ...base,
      name: "UserFixtureTool",
      rootKind: "User",
      tags: ["external tag"],
    },
  ];
}
