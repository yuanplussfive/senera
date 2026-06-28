import type { AgentPluginRegistry } from "./Plugin/AgentPluginRegistry.js";
import type { RegisteredSkill } from "./Types/PluginRuntimeTypes.js";
import type {
  ToolSearchCapabilityFacetsManifest,
} from "./Types/PluginManifestTypes.js";

export interface AgentSkillCatalogItem {
  name: string;
  title: string;
  summary: string;
  capabilities: AgentSkillCatalogCapabilityItem[];
  tags: string[];
  useCases: string[];
  examples: string[];
  avoid: string[];
  recommendedTools: string[];
  recommendedAgents: string[];
  recommendedWorkflows: string[];
  priority?: number;
}

export interface AgentSkillCatalogCapabilityItem {
  id: string;
  title: string;
  description: string;
  facets: ToolSearchCapabilityFacetsManifest;
  risk?: {
    sideEffect?: string;
    permission?: string;
  };
}

export class AgentSkillCatalogProjector {
  constructor(private readonly registry: AgentPluginRegistry) {}

  list(): AgentSkillCatalogItem[] {
    return this.registry
      .listSkills()
      .map((skill) => this.project(skill));
  }

  project(skill: RegisteredSkill): AgentSkillCatalogItem {
    const search = skill.search;
    return {
      name: skill.name,
      title: skill.title ?? search?.Summary ?? skill.name,
      summary: search?.Summary ?? skill.plugin.manifest.Plugin.Description ?? "",
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
      recommendedTools: skill.recommendedTools,
      recommendedAgents: skill.recommendedAgents,
      recommendedWorkflows: skill.recommendedWorkflows,
      priority: skill.plugin.manifest.Prompting?.Priority,
    };
  }
}
