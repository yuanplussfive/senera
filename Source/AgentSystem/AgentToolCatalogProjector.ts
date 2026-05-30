import type { AgentPluginRegistry } from "./AgentPluginRegistry.js";
import type { RegisteredTool } from "./Types.js";

export interface AgentToolCatalogItem {
  name: string;
  title: string;
  summary: string;
  tags: string[];
  useCases: string[];
  examples: string[];
  avoid: string[];
  permissions: string[];
}

export class AgentToolCatalogProjector {
  constructor(private readonly registry: AgentPluginRegistry) {}

  list(): AgentToolCatalogItem[] {
    return this.registry
      .listTools()
      .map((tool) => this.project(tool));
  }

  listVisible(visible: "all" | readonly string[]): AgentToolCatalogItem[] {
    if (visible === "all") {
      return this.list();
    }

    const names = new Set(visible);
    return this.list().filter((tool) => names.has(tool.name));
  }

  private project(tool: RegisteredTool): AgentToolCatalogItem {
    const search = tool.search;
    return {
      name: tool.name,
      title: tool.plugin.manifest.Plugin.Title ?? tool.name,
      summary: search?.Summary ?? tool.plugin.manifest.Plugin.Description ?? "",
      tags: [
        ...(tool.plugin.manifest.Discovery?.Tags ?? []),
        ...(search?.Keywords ?? []),
      ],
      useCases: search?.UseCases ?? [],
      examples: search?.Examples ?? [],
      avoid: search?.Avoid ?? [],
      permissions: tool.permissions,
    };
  }
}
