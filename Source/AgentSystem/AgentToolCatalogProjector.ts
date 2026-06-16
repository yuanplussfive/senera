import type { AgentPluginRegistry } from "./AgentPluginRegistry.js";
import type {
  RegisteredTool,
  ToolSearchCapabilityFacetsManifest,
} from "./Types.js";

export interface AgentToolCatalogItem {
  name: string;
  title: string;
  summary: string;
  capabilities: AgentToolCatalogCapabilityItem[];
  tags: string[];
  useCases: string[];
  examples: string[];
  avoid: string[];
  permissions: string[];
}

export interface AgentToolCatalogCapabilityItem {
  id: string;
  title: string;
  description: string;
  facets: ToolSearchCapabilityFacetsManifest;
  risk?: {
    sideEffect?: string;
    permission?: string;
  };
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
      capabilities: (search?.Capabilities ?? []).map((capability) => ({
        id: capability.Id,
        title: capability.Title ?? capability.Id,
        description: capability.Description ?? "",
        facets: capability.Facets ?? {},
            risk: capability.Risk
          ? {
              sideEffect: capability.Risk.SideEffect,
              permission: capability.Risk.Permission,
            }
          : undefined,
      })),
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
