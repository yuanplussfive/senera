import path from "node:path";
import { describe, expect, test } from "vitest";
import { AgentJsonFileLoader } from "../../../Source/AgentSystem/Config/AgentJsonFileLoader.js";
import { AgentPiToolRegistryProjector } from "../../../Source/AgentSystem/Pi/AgentPiToolRegistryProjector.js";
import type { AgentPiToolExecutionBridge } from "../../../Source/AgentSystem/Pi/AgentPiToolExecutionBridge.js";
import { AgentPiResourceProjector } from "../../../Source/AgentSystem/Pi/AgentPiResourceProjector.js";
import { AgentPluginRegistry } from "../../../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import { PluginManifestSchema } from "../../../Source/AgentSystem/Schemas/PluginManifestSchema.js";
import type { PluginManifest } from "../../../Source/AgentSystem/Types/PluginManifestTypes.js";

describe("Pi tool contract cache behavior", () => {
  test("registers immutable contracts and reuses parameter schemas across turn projections", () => {
    const registry = new AgentPluginRegistry();
    const projector = toolProjector(registry);
    registerSystemPlugin(registry, "AgentExecutionResourceToolPlugin");
    const tools = registry.listTools();

    expect(tools).toHaveLength(8);
    for (const tool of tools) {
      expect(tool.contract?.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(Object.isFrozen(tool.contract)).toBe(true);
      expect(Object.isFrozen(tool.contract?.arguments?.jsonSchema)).toBe(true);
    }

    const first = projector.project({ requestId: "request-1" });
    const second = projector.project({ requestId: "request-2" });

    expect(second.map((tool) => tool.parameters)).toEqual(first.map((tool) => tool.parameters));
    second.forEach((tool, index) => expect(tool.parameters).toBe(first[index]?.parameters));
  }, 15_000);

  test("discovers templates registered after resource projector construction and reuses their content", () => {
    const registry = new AgentPluginRegistry();
    const projector = new AgentPiResourceProjector(registry);
    registerSystemPlugin(registry, "AgentCapabilitySkillsPlugin");

    const first = projector.project();
    const second = projector.project();

    expect(first.harnessResources.promptTemplates?.length).toBeGreaterThan(0);
    expect(second.fingerprint).toBe(first.fingerprint);
    second.harnessResources.promptTemplates?.forEach((template, index) =>
      expect(template).toBe(first.harnessResources.promptTemplates?.[index]),
    );
  });

  test("changes the tool fingerprint when a projected descriptor changes", () => {
    const registry = new AgentPluginRegistry();
    const projector = toolProjector(registry);
    registerSystemPlugin(registry, "AgentExecutionResourceToolPlugin");

    const first = projector.createToolSet().fingerprint;
    const tool = registry.listTools()[0]!;
    tool.plugin.manifest.Plugin.Title = `${tool.plugin.manifest.Plugin.Title ?? tool.name} (updated)`;

    expect(projector.createToolSet().fingerprint).not.toBe(first);
  });
});

function toolProjector(registry: AgentPluginRegistry): AgentPiToolRegistryProjector {
  return new AgentPiToolRegistryProjector({
    config: { ModelProviders: [] },
    registry,
    execution: {
      execute: async () => ({ content: [], details: { senera: { toolName: "test", result: {} } } }),
    } as unknown as AgentPiToolExecutionBridge,
  });
}

function registerSystemPlugin(registry: AgentPluginRegistry, pluginName: string): void {
  const rootPath = path.resolve("System/Plugins", pluginName);
  const manifestPath = path.join(rootPath, "PluginManifest.json");
  registry.registerPlugin({
    rootPath,
    rootKind: "System",
    manifestPath,
    config: {
      fileName: "PluginConfig.toml",
      path: path.join(rootPath, "PluginConfig.toml"),
      exists: false,
      source: "default",
      templateExists: false,
      needsUserConfig: false,
      toml: "",
      sections: [],
      runtime: { enabled: true, tools: {} },
      diagnostics: [],
    },
    manifest: new AgentJsonFileLoader().load(manifestPath, PluginManifestSchema) as PluginManifest,
  });
}
