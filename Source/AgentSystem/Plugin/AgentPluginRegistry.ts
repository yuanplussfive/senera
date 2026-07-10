import type { RootCommandManifest } from "../Types/PluginManifestTypes.js";
import type {
  LoadedPlugin,
  RegisteredSkill,
  RegisteredTemplate,
  RegisteredTool,
} from "../Types/PluginRuntimeTypes.js";
import { isLoadedPluginAvailable } from "./AgentPluginConfig.js";
import {
  AgentPluginRuntimeContractProjector,
  type AgentPluginRuntimeContributions,
} from "./AgentPluginRuntimeContractProjector.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

export class AgentPluginRegistry {
  private readonly contractProjector = new AgentPluginRuntimeContractProjector();
  private readonly plugins = new Map<string, LoadedPlugin>();
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly skills = new Map<string, RegisteredSkill>();
  private readonly templates = new Map<string, RegisteredTemplate>();
  private readonly rootCommandPolicies = new Map<string, RootCommandManifest>();
  private readonly rootCommandPolicyPlugins = new Map<string, LoadedPlugin>();

  registerPlugin(plugin: LoadedPlugin): void {
    if (!isLoadedPluginAvailable(plugin)) {
      return;
    }

    const pluginName = plugin.manifest.Plugin.Name;
    if (this.plugins.has(pluginName)) {
      throw new Error(agentErrorMessage("plugin.duplicateName", { pluginName }));
    }

    this.plugins.set(pluginName, plugin);
    this.registerRuntimeContributions(plugin, this.contractProjector.project(plugin));
  }

  getPlugin(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name);
  }

  getTool(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  listTools(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  getSkill(name: string): RegisteredSkill | undefined {
    return this.skills.get(name);
  }

  listSkills(): RegisteredSkill[] {
    return [...this.skills.values()];
  }

  validateAgentReferences(): void {
    const issues = [
      ...this.validateSkillToolReferences(),
      ...this.validateRootCommandToolReferences(),
    ];

    if (issues.length > 0) {
      throw new Error([
        agentErrorMessage("plugin.referenceValidationFailed"),
        ...issues.map((issue) => `- ${issue}`),
      ].join("\n"));
    }
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

  private registerRuntimeContributions(
    plugin: LoadedPlugin,
    contributions: AgentPluginRuntimeContributions,
  ): void {
    this.registerUnique(
      this.tools,
      contributions.tools,
      (tool) => tool.name,
      (toolName) => agentErrorMessage("plugin.duplicateToolName", { toolName }),
    );
    this.registerUnique(
      this.skills,
      contributions.skills,
      (skill) => skill.name,
      (skillName) => agentErrorMessage("plugin.duplicateSkillName", { skillName }),
    );
    this.registerUnique(
      this.templates,
      contributions.templates,
      (template) => template.name,
      (templateName) => agentErrorMessage("plugin.duplicateTemplateName", { templateName }),
    );
    this.registerRootCommandPolicies(plugin, contributions.rootCommandPolicies);
  }

  private registerUnique<T>(
    target: Map<string, T>,
    values: readonly T[],
    keyOf: (value: T) => string,
    duplicateMessage: (key: string) => string,
  ): void {
    for (const value of values) {
      const key = keyOf(value);
      if (target.has(key)) {
        throw new Error(duplicateMessage(key));
      }
      target.set(key, value);
    }
  }

  private registerRootCommandPolicies(
    plugin: LoadedPlugin,
    policies: readonly RootCommandManifest[],
  ): void {
    for (const policy of policies) {
      if (this.rootCommandPolicies.has(policy.Action)) {
        throw new Error(agentErrorMessage("plugin.duplicateRootCommandAction", { action: policy.Action }));
      }
      this.rootCommandPolicies.set(policy.Action, policy);
      this.rootCommandPolicyPlugins.set(policy.Action, plugin);
    }
  }

  private validateSkillToolReferences(): string[] {
    const issues: string[] = [];
    for (const skill of this.skills.values()) {
      for (const toolName of skill.recommendedTools) {
        if (!this.tools.has(toolName)) {
          issues.push(
            agentErrorMessage("plugin.skillRecommendedToolMissing", {
              member: this.describePluginMember("Skill", skill.plugin, skill.name),
              toolName,
            }),
          );
        }
      }
    }
    return issues;
  }

  private validateRootCommandToolReferences(): string[] {
    const issues: string[] = [];
    for (const policy of this.rootCommandPolicies.values()) {
      const plugin = this.rootCommandPolicyPlugins.get(policy.Action);
      for (const selector of policy.AllowedTools) {
        switch (selector.Source) {
          case "NamedLoaded": {
            for (const toolName of selector.Names) {
              if (!this.tools.has(toolName)) {
                issues.push(
                  agentErrorMessage("plugin.rootCommandNamedToolMissing", {
                    member: this.describePluginMember("RootCommand", plugin, policy.Action),
                    toolName,
                  }),
                );
              }
            }
            break;
          }

          case "HostCapability": {
            if (!this.hasHostCapabilityTool(selector.Capability)) {
              issues.push(
                agentErrorMessage("plugin.rootCommandHostCapabilityMissing", {
                  member: this.describePluginMember("RootCommand", plugin, policy.Action),
                  capability: selector.Capability,
                }),
              );
            }
            break;
          }

          case "Loaded":
          case "None":
          case "PreferredLoaded":
          case "PreferredLoadedOrLoaded":
            break;
        }
      }
    }
    return issues;
  }

  private hasHostCapabilityTool(capability: string): boolean {
    return [...this.tools.values()].some((tool) =>
      tool.handler.kind === "HostCapability"
      && tool.handler.capability === capability
    );
  }

  private describePluginMember(
    kind: string,
    plugin: LoadedPlugin | undefined,
    name: string,
  ): string {
    const pluginName = plugin?.manifest.Plugin.Name ?? "unknown";
    return `${kind} "${name}" in plugin "${pluginName}"`;
  }

}
