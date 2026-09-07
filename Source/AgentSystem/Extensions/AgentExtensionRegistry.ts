import type { RegisteredSkill } from "../Skills/AgentSkillTypes.js";
import {
  assertAgentSkillCatalogToolReferences,
  type AgentSkillToolReferenceValidationOptions,
} from "../Skills/AgentSkillToolBinding.js";
import type { AgentExtensionOwner } from "../Types/AgentExtensionRuntimeTypes.js";
import type { RootCommandManifest } from "../Types/AgentRootCommandContractTypes.js";
import type { AgentToolDiscoverySource } from "../Types/AgentToolContractTypes.js";
import type { RegisteredSidecarTool, RegisteredTemplate, RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";

export class AgentExtensionRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly toolExtensions = new Map<string, RegisteredToolExtensionContribution>();
  private readonly sidecarTools = new Map<string, RegisteredSidecarTool>();
  private readonly sidecarCapabilitiesByOwner = new Map<string, Set<string>>();
  private readonly skills = new Map<string, RegisteredSkill>();
  private readonly skillSources = new Map<string, RegisteredSkill[]>();
  private readonly templates = new Map<string, RegisteredTemplate>();
  private readonly rootCommandPolicies = new Map<string, RootCommandManifest>();
  private revisionValue = 0;

  /** Changes whenever a catalog contribution is replaced, added, or removed. */
  get revision(): number {
    return this.revisionValue;
  }

  registerToolExtension(owner: AgentExtensionOwner, tools: readonly RegisteredTool[]): void {
    this.commitToolExtension(owner, tools, false);
  }

  replaceToolExtension(owner: AgentExtensionOwner, tools: readonly RegisteredTool[]): void {
    this.commitToolExtension(owner, tools, true);
  }

  removeToolExtension(owner: string | AgentExtensionOwner): void {
    const identities = [...this.toolExtensions].flatMap(([identity, contribution]) =>
      (typeof owner === "string" ? contribution.owner.name === owner : identity === toolOwnerIdentity(owner))
        ? [identity]
        : [],
    );
    if (identities.length === 0) return;
    const affectedNames = new Set(
      identities.flatMap((identity) => this.toolExtensions.get(identity)!.tools.map((tool) => tool.name)),
    );
    for (const identity of identities) this.toolExtensions.delete(identity);
    this.resolveTools(affectedNames);
    this.bumpRevision();
  }

  getTool(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  listTools(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  listToolsForOwner(owner: AgentExtensionOwner): RegisteredTool[] {
    return [...(this.toolExtensions.get(toolOwnerIdentity(owner))?.tools ?? [])];
  }

  registerSidecarToolExtension(owner: AgentExtensionOwner, tools: readonly RegisteredSidecarTool[]): void {
    assertUniqueBy(tools, (tool) => tool.capability, `sidecar capability in extension ${owner.name}`);
    const capabilities = new Set<string>();
    for (const tool of tools) {
      if (tool.owner.name !== owner.name || tool.owner.kind !== owner.kind) {
        throw new Error(`Sidecar tool ${tool.name} does not belong to extension ${owner.name}.`);
      }
      if (this.sidecarTools.has(tool.capability)) {
        throw new Error(`Sidecar capability is already registered: ${tool.capability}.`);
      }
      capabilities.add(tool.capability);
      this.sidecarTools.set(tool.capability, tool);
    }
    if (capabilities.size > 0) {
      this.sidecarCapabilitiesByOwner.set(owner.name, capabilities);
      this.bumpRevision();
    }
  }

  getSidecarTool(capability: string): RegisteredSidecarTool | undefined {
    return this.sidecarTools.get(capability);
  }

  listSidecarTools(): RegisteredSidecarTool[] {
    return [...this.sidecarTools.values()];
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
    if (this.removeSkillEntries(sourceId)) this.bumpRevision();
  }

  registerPromptAssets(
    templates: readonly RegisteredTemplate[],
    rootCommandPolicies: readonly RootCommandManifest[],
  ): void {
    assertUniqueBy(templates, (template) => template.name, "prompt template");
    assertUniqueBy(rootCommandPolicies, (policy) => policy.Action, "root command action");
    for (const template of templates) this.templates.set(template.name, template);
    for (const policy of rootCommandPolicies) this.rootCommandPolicies.set(policy.Action, policy);
    if (templates.length > 0 || rootCommandPolicies.length > 0) this.bumpRevision();
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
    for (const tool of tools) {
      if (tool.owner.name !== owner.name || tool.owner.kind !== owner.kind) {
        throw new Error(`Tool ${tool.name} does not belong to extension ${owner.name}.`);
      }
    }
    const ownerIdentity = toolOwnerIdentity(owner);
    const previous = this.toolExtensions.get(ownerIdentity);
    if (previous && !replace) throw new Error(`Tool extension is already registered: ${ownerIdentity}`);
    this.toolExtensions.set(ownerIdentity, { owner, tools: [...tools] });
    this.resolveTools(
      new Set([...(previous?.tools ?? []).map((tool) => tool.name), ...tools.map((tool) => tool.name)]),
    );
    this.bumpRevision();
  }

  private replaceSkillSource(sourceId: string, skills: readonly RegisteredSkill[], replace: boolean): void {
    assertUniqueBy(skills, (skill) => skill.name, `Skill in source ${sourceId}`);
    for (const skill of skills) {
      if (skillSourceIdentity(skill) !== sourceId) {
        throw new Error(`Skill ${skill.name} does not belong to source ${sourceId}.`);
      }
    }
    const previous = this.skillSources.get(sourceId);
    if (previous && !replace) throw new Error(`Skill source is already registered: ${sourceId}`);
    this.skillSources.set(sourceId, [...skills]);
    this.resolveSkills(new Set([...(previous ?? []).map((skill) => skill.name), ...skills.map((skill) => skill.name)]));
    this.bumpRevision();
  }

  private removeSkillEntries(sourceId: string): boolean {
    const skills = this.skillSources.get(sourceId);
    if (!skills) return false;
    this.skillSources.delete(sourceId);
    this.resolveSkills(new Set(skills.map((skill) => skill.name)));
    return true;
  }

  private resolveTools(names: ReadonlySet<string>): void {
    for (const name of names) {
      const candidates = [...this.toolExtensions.values()].flatMap((contribution) =>
        contribution.tools.filter((tool) => tool.name === name),
      );
      const winner = preferredCandidate(candidates, compareToolPriority);
      if (winner) this.tools.set(name, winner);
      else this.tools.delete(name);
    }
  }

  private resolveSkills(names: ReadonlySet<string>): void {
    for (const name of names) {
      const candidates = [...this.skillSources.values()].flatMap((skills) =>
        skills.filter((skill) => skill.name === name),
      );
      const winner = preferredCandidate(candidates, compareSkillPriority);
      if (winner) this.skills.set(name, winner);
      else this.skills.delete(name);
    }
  }

  private bumpRevision(): void {
    this.revisionValue += 1;
  }
}

interface RegisteredDiscoverySource {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

interface RegisteredToolExtensionContribution {
  readonly owner: AgentExtensionOwner;
  readonly tools: readonly RegisteredTool[];
}

function skillSourceIdentity(skill: RegisteredSkill): string {
  return `${skill.source.kind}:${skill.source.id}`;
}

function toolOwnerIdentity(owner: AgentExtensionOwner): string {
  return `${owner.kind}:${owner.name}`;
}

function preferredCandidate<T>(candidates: readonly T[], compare: (left: T, right: T) => number): T | undefined {
  return candidates.reduce<T | undefined>(
    (winner, candidate) => (!winner || compare(candidate, winner) < 0 ? candidate : winner),
    undefined,
  );
}

function compareToolPriority(left: RegisteredTool, right: RegisteredTool): number {
  return (
    compareSourceKind(left.owner.kind, right.owner.kind) ||
    compareDescending(left.owner.priority, right.owner.priority) ||
    toolOwnerIdentity(left.owner).localeCompare(toolOwnerIdentity(right.owner))
  );
}

function compareSkillPriority(left: RegisteredSkill, right: RegisteredSkill): number {
  return (
    compareSourceKind(left.source.kind, right.source.kind) ||
    compareDescending(left.source.priority, right.source.priority) ||
    skillSourceIdentity(left).localeCompare(skillSourceIdentity(right))
  );
}

function compareSourceKind(left: "system" | "mcp" | "standalone", right: "system" | "mcp" | "standalone"): number {
  return sourceKindRank(left) - sourceKindRank(right);
}

function sourceKindRank(kind: "system" | "mcp" | "standalone"): number {
  return kind === "system" ? 0 : 1;
}

function compareDescending(left: number | undefined, right: number | undefined): number {
  return (right ?? 0) - (left ?? 0);
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
