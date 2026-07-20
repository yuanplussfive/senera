import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type {
  ToolEvidenceCapabilityManifest,
  ToolSearchCapabilityFacetsManifest,
} from "../Types/PluginManifestTypes.js";
import {
  resolveAgentToolRuntimeCapabilities,
  type AgentToolRuntimeCapabilities,
} from "./AgentToolRuntimeCapabilities.js";

export interface AgentToolCatalogItem {
  name: string;
  title: string;
  summary: string;
  rootKind: "System" | "User";
  capabilities: AgentToolCatalogCapabilityItem[];
  tags: string[];
  useCases: string[];
  examples: string[];
  avoid: string[];
  permissions: string[];
  evidenceCapabilities: AgentToolCatalogEvidenceCapability[];
  runtime?: AgentToolRuntimeCapabilities;
}

export interface AgentToolCatalogEvidenceCapability {
  produces: string;
  quality: string;
  satisfies: string[];
  kinds: string[];
  capabilityIds: string[];
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
    return this.registry.listTools().map((tool) => this.project(tool));
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
      rootKind: tool.plugin.rootKind,
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
      tags: search?.Tags ?? [],
      useCases: search?.UseCases ?? [],
      examples: search?.Examples ?? [],
      avoid: search?.Avoid ?? [],
      permissions: tool.permissions,
      runtime: resolveAgentToolRuntimeCapabilities(tool),
      evidenceCapabilities: [
        ...tool.evidenceCapabilities.map(projectEvidenceCapability),
        ...projectArtifactEvidenceCapabilities(tool),
      ],
    };
  }
}

function projectEvidenceCapability(capability: ToolEvidenceCapabilityManifest): AgentToolCatalogEvidenceCapability {
  return {
    produces: capability.Produces,
    quality: capability.Quality,
    satisfies: capability.Satisfies ?? [],
    kinds: capability.Kinds ?? [],
    capabilityIds: capability.CapabilityIds ?? [],
  };
}

function projectArtifactEvidenceCapabilities(tool: RegisteredTool): AgentToolCatalogEvidenceCapability[] {
  return (tool.artifactPolicy?.Evidence ?? []).map((evidence) => {
    const capabilityIds = (tool.search?.Capabilities ?? [])
      .filter((capability) => {
        const facets = capability.Facets ?? {};
        return [...(facets.Evidence ?? []), ...(facets.Outputs ?? [])].includes(evidence.Kind);
      })
      .map((capability) => capability.Id);

    return {
      produces: evidence.Kind,
      quality: "observed",
      satisfies: [evidence.Kind, ...capabilityIds],
      kinds: [evidence.Kind],
      capabilityIds,
    };
  });
}
