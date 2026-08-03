import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type { RegisteredSkill } from "./AgentSkillTypes.js";
import type { ToolSearchCapabilityFacetsManifest } from "../Types/AgentToolContractTypes.js";

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
  constructor(private readonly registry: AgentExtensionRegistry) {}

  list(): AgentSkillCatalogItem[] {
    return this.registry.listSkills().map((skill) => this.project(skill));
  }

  project(skill: RegisteredSkill): AgentSkillCatalogItem {
    const search = skill.search;
    return {
      name: skill.name,
      title: skill.title ?? search?.Summary ?? skill.name,
      summary: search?.Summary ?? skill.description,
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
      recommendedTools: this.registry.filterAvailableToolNames(skill.recommendedTools),
      priority: skill.source.priority,
    };
  }
}
