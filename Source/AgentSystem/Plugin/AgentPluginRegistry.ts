import type { RootCommandManifest } from "../Types/PluginManifestTypes.js";
import type {
  LoadedPlugin,
  RegisteredAgent,
  RegisteredAgentContextPack,
  RegisteredAgentMergePolicy,
  RegisteredAgentWorkflow,
  RegisteredDecisionAction,
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
  private readonly decisionActionsByRoot = new Map<string, RegisteredDecisionAction>();
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly skills = new Map<string, RegisteredSkill>();
  private readonly agents = new Map<string, RegisteredAgent>();
  private readonly contextPacks = new Map<string, RegisteredAgentContextPack>();
  private readonly mergePolicies = new Map<string, RegisteredAgentMergePolicy>();
  private readonly workflows = new Map<string, RegisteredAgentWorkflow>();
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

  getDecisionActionByRoot(root: string): RegisteredDecisionAction | undefined {
    return this.decisionActionsByRoot.get(root);
  }

  listDecisionActions(): RegisteredDecisionAction[] {
    return [...this.decisionActionsByRoot.values()];
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

  getAgent(name: string): RegisteredAgent | undefined {
    return this.agents.get(name);
  }

  listAgents(): RegisteredAgent[] {
    return [...this.agents.values()];
  }

  getAgentContextPack(name: string): RegisteredAgentContextPack | undefined {
    return this.contextPacks.get(name);
  }

  listAgentContextPacks(): RegisteredAgentContextPack[] {
    return [...this.contextPacks.values()];
  }

  getAgentMergePolicy(name: string): RegisteredAgentMergePolicy | undefined {
    return this.mergePolicies.get(name);
  }

  listAgentMergePolicies(): RegisteredAgentMergePolicy[] {
    return [...this.mergePolicies.values()];
  }

  getAgentWorkflow(name: string): RegisteredAgentWorkflow | undefined {
    return this.workflows.get(name);
  }

  listAgentWorkflows(): RegisteredAgentWorkflow[] {
    return [...this.workflows.values()];
  }

  validateAgentReferences(): void {
    for (const skill of this.skills.values()) {
      for (const agentName of skill.recommendedAgents) {
        this.assertKnown(this.agents, agentName, `技能 ${skill.name} 推荐了不存在的 Agent`);
      }
      for (const workflowName of skill.recommendedWorkflows) {
        this.assertKnown(this.workflows, workflowName, `技能 ${skill.name} 推荐了不存在的 Workflow`);
      }
    }

    for (const agent of this.agents.values()) {
      this.assertKnown(this.contextPacks, agent.contextPack, `Agent ${agent.name} 引用了不存在的 ContextPack`);
    }

    for (const workflow of this.workflows.values()) {
      this.assertKnown(this.mergePolicies, workflow.mergePolicy, `Workflow ${workflow.name} 引用了不存在的 MergePolicy`);
      for (const skillName of workflow.trigger.Skills ?? []) {
        this.assertKnown(this.skills, skillName, `Workflow ${workflow.name} 触发条件引用了不存在的 Skill`);
      }
      for (const agentName of workflow.trigger.Agents ?? []) {
        this.assertKnown(this.agents, agentName, `Workflow ${workflow.name} 触发条件引用了不存在的 Agent`);
      }
      for (const job of workflow.jobs) {
        this.assertKnown(this.agents, job.agent, `Workflow ${workflow.name} Job 引用了不存在的 Agent`);
        if (job.contextPack) {
          this.assertKnown(this.contextPacks, job.contextPack, `Workflow ${workflow.name} Job 引用了不存在的 ContextPack`);
        }
      }
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

  private registerRuntimeContributions(contributions: AgentPluginRuntimeContributions): void {
    this.registerUnique(
      this.decisionActionsByRoot,
      contributions.decisionActions,
      (action) => action.xmlRoot,
      "决策 XML 根标签重复",
    );
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
      this.contextPacks,
      contributions.contextPacks,
      (contextPack) => contextPack.name,
      "Agent ContextPack 名重复",
    );
    this.registerUnique(
      this.mergePolicies,
      contributions.mergePolicies,
      (mergePolicy) => mergePolicy.name,
      "Agent MergePolicy 名重复",
    );
    this.registerUnique(
      this.agents,
      contributions.agents,
      (agent) => agent.name,
      "Agent 名重复",
    );
    this.registerUnique(
      this.workflows,
      contributions.workflows,
      (workflow) => workflow.name,
      "Agent Workflow 名重复",
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

  private assertKnown<T>(
    values: ReadonlyMap<string, T>,
    name: string,
    message: string,
  ): void {
    if (!values.has(name)) {
      throw new Error(`${message}：${name}`);
    }
  }
}
