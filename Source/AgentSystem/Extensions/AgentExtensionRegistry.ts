import type { RegisteredSkill } from "../Skills/AgentSkillTypes.js";
import {
  assertAgentSkillCatalogToolReferences,
  type AgentSkillToolReferenceValidationOptions,
} from "../Skills/AgentSkillToolBinding.js";
import type { AgentExtensionOwner } from "../Types/AgentExtensionRuntimeTypes.js";
import type { RootCommandManifest } from "../Types/AgentRootCommandContractTypes.js";
import type { AgentToolDiscoverySource } from "../Types/AgentToolContractTypes.js";
import type { RegisteredTemplate, RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";

export class AgentExtensionRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly toolNamesByOwner = new Map<string, Set<string>>();
  private readonly skills = new Map<string, RegisteredSkill>();
  private readonly skillNamesBySource = new Map<string, Set<string>>();
  private readonly templates = new Map<string, RegisteredTemplate>();
  private readonly rootCommandPolicies = new Map<string, RootCommandManifest>();

  registerToolExtension(owner: AgentExtensionOwner, tools: readonly RegisteredTool[]): void {
    this.commitToolExtension(owner, tools, false);
  }

  replaceToolExtension(owner: AgentExtensionOwner, tools: readonly RegisteredTool[]): void {
    this.commitToolExtension(owner, tools, true);
  }

  removeToolExtension(ownerName: string): void {
    for (const name of this.toolNamesByOwner.get(ownerName) ?? []) this.tools.delete(name);
    this.toolNamesByOwner.delete(ownerName);
  }

  getTool(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  listTools(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  filterAvailableToolNames(toolNames: readonly string[]): string[] {
    return [...new Set(toolNames.filter((toolName) => this.tools.has(toolName)))];
  }

  getSkill(name: string): RegisteredSkill | undefined {
    return this.skills.get(name);
  }

  listSkills(): RegisteredSkill[] {
    return [...this.skills.values()];
  }

  registerSkill(skill: RegisteredSkill): void {
    this.replaceSkillSource(skillSourceIdentity(skill), [skill], false);
  }

  replaceSkills(sourceId: string, skills: readonly RegisteredSkill[]): void {
    this.replaceSkillSource(sourceId, skills, true);
  }

  removeSkills(sourceId: string): void {
    for (const name of this.skillNamesBySource.get(sourceId) ?? []) this.skills.delete(name);
    this.skillNamesBySource.delete(sourceId);
  }

  registerPromptAssets(
    templates: readonly RegisteredTemplate[],
    rootCommandPolicies: readonly RootCommandManifest[],
  ): void {
    assertUniqueBy(templates, (template) => template.name, "prompt template");
    assertUniqueBy(rootCommandPolicies, (policy) => policy.Action, "root command action");
    for (const template of templates) this.templates.set(template.name, template);
    for (const policy of rootCommandPolicies) this.rootCommandPolicies.set(policy.Action, policy);
  }

  getTemplate(name: string): RegisteredTemplate | undefined {
    return this.templates.get(name);
  }

  listTemplates(): RegisteredTemplate[] {
    return [...this.templates.values()];
  }

  getRootCommandPolicy(action: string): RootCommandManifest | undefined {
    return this.rootCommandPolicies.get(action);
  }

  listRootCommandPolicies(): RootCommandManifest[] {
    return [...this.rootCommandPolicies.values()];
  }

  listDiscoverySources(): RegisteredDiscoverySource[] {
    const sources = new Map<string, RegisteredDiscoverySource>();
    for (const tool of this.tools.values()) {
      for (const source of tool.sources) {
        const existing = sources.get(source.Id);
        if (existing && !sameDiscoverySource(existing, source)) {
          throw new Error(`Discovery source ${source.Id} has conflicting metadata.`);
        }
        sources.set(source.Id, {
          id: source.Id,
          title: source.Title,
          description: source.Description,
        });
      }
    }
    return [...sources.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  validateAgentReferences(options: AgentSkillToolReferenceValidationOptions = {}): void {
    assertAgentSkillCatalogToolReferences(this.listSkills(), this, options);
  }

  private commitToolExtension(owner: AgentExtensionOwner, tools: readonly RegisteredTool[], replace: boolean): void {
    assertUniqueBy(tools, (tool) => tool.name, `tool in extension ${owner.name}`);
    const previousNames = this.toolNamesByOwner.get(owner.name) ?? new Set<string>();
    for (const tool of tools) {
      if (tool.owner.name !== owner.name || tool.owner.kind !== owner.kind) {
        throw new Error(`Tool ${tool.name} does not belong to extension ${owner.name}.`);
      }
      const installed = this.tools.get(tool.name);
      if (installed && (!replace || !previousNames.has(tool.name))) {
        throw new Error(`Tool name is already registered: ${tool.name}`);
      }
    }

    if (replace) this.removeToolExtension(owner.name);
    const names = new Set<string>();
    for (const tool of tools) {
      names.add(tool.name);
      this.tools.set(tool.name, tool);
    }
    this.toolNamesByOwner.set(owner.name, names);
  }

  private replaceSkillSource(sourceId: string, skills: readonly RegisteredSkill[], replace: boolean): void {
    assertUniqueBy(skills, (skill) => skill.name, `Skill in source ${sourceId}`);
    const previousNames = this.skillNamesBySource.get(sourceId) ?? new Set<string>();
    for (const skill of skills) {
      if (skillSourceIdentity(skill) !== sourceId) {
        throw new Error(`Skill ${skill.name} does not belong to source ${sourceId}.`);
      }
      const installed = this.skills.get(skill.name);
      if (installed && (!replace || !previousNames.has(skill.name))) {
        throw new Error(`Skill name is already registered: ${skill.name}`);
      }
    }

    if (replace) this.removeSkills(sourceId);
    const names = new Set<string>();
    for (const skill of skills) {
      names.add(skill.name);
      this.skills.set(skill.name, skill);
    }
    this.skillNamesBySource.set(sourceId, names);
  }
}

interface RegisteredDiscoverySource {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

function skillSourceIdentity(skill: RegisteredSkill): string {
  return `${skill.source.kind}:${skill.source.id}`;
}

function sameDiscoverySource(left: RegisteredDiscoverySource, right: AgentToolDiscoverySource): boolean {
  return left.title === right.Title && left.description === right.Description;
}

function assertUniqueBy<T>(values: readonly T[], identity: (value: T) => string, label: string): void {
  const identities = new Set<string>();
  for (const value of values) {
    const key = identity(value);
    if (identities.has(key)) throw new Error(`Duplicate ${label}: ${key}`);
    identities.add(key);
  }
}
