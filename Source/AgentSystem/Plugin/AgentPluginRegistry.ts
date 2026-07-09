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

export class AgentPluginRegistry {
  private readonly contractProjector = new AgentPluginRuntimeContractProjector();
  private readonly plugins = new Map<string, LoadedPlugin>();
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly skills = new Map<string, RegisteredSkill>();
  private readonly templates = new Map<string, RegisteredTemplate>();
  private readonly rootCommandPolicies = new Map<string, RootCommandManifest>();

  registerPlugin(plugin: LoadedPlugin): void {
    if (!isLoadedPluginAvailable(plugin)) {
      return;
    }

    const pluginName = plugin.manifest.Plugin.Name;
    if (this.plugins.has(pluginName)) {
      throw new Error(`插件名重复：${pluginName}`);
    }

    this.plugins.set(pluginName, plugin);
    this.registerRuntimeContributions(this.contractProjector.project(plugin));
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

  private registerRuntimeContributions(contributions: AgentPluginRuntimeContributions): void {
    this.registerUnique(
      this.tools,
      contributions.tools,
      (tool) => tool.name,
      "工具名重复",
    );
    this.registerUnique(
      this.skills,
      contributions.skills,
      (skill) => skill.name,
      "技能名重复",
    );
    this.registerUnique(
      this.templates,
      contributions.templates,
      (template) => template.name,
      "模板名重复",
    );
    this.registerUnique(
      this.rootCommandPolicies,
      contributions.rootCommandPolicies,
      (policy) => policy.Action,
      "RootCommand action 策略重复",
    );
  }

  private registerUnique<T>(
    target: Map<string, T>,
    values: readonly T[],
    keyOf: (value: T) => string,
    duplicateMessage: string,
  ): void {
    for (const value of values) {
      const key = keyOf(value);
      if (target.has(key)) {
        throw new Error(`${duplicateMessage}：${key}`);
      }
      target.set(key, value);
    }
  }

}
