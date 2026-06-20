import { resolveFrom } from "./AgentPath.js";
import type {
  AgentWorkflowJobManifest,
  LoadedPlugin,
  RegisteredAgent,
  RegisteredAgentContextPack,
  RegisteredAgentMergePolicy,
  RegisteredAgentWorkflow,
  RegisteredDecisionAction,
  RegisteredSkill,
  RegisteredTemplate,
  RegisteredTool,
  RootCommandManifest,
  ToolArtifactPolicyManifest,
} from "./Types.js";
import { AgentJsonFileLoader } from "./AgentJsonFileLoader.js";
import { ToolArtifactPolicySchema } from "./Schemas/PluginManifestSchema.js";
import {
  isLoadedPluginAvailable,
  isLoadedPluginToolEnabled,
} from "./AgentPluginConfig.js";

export class AgentPluginRegistry {
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

    for (const action of plugin.manifest.DecisionActions ?? []) {
      if (this.decisionActionsByRoot.has(action.XmlRoot)) {
        throw new Error(`决策 XML 根标签重复：${action.XmlRoot}`);
      }

      this.decisionActionsByRoot.set(action.XmlRoot, {
        plugin,
        name: action.Name,
        kind: action.Kind,
        xmlRoot: action.XmlRoot,
        schemaPath: resolveFrom(plugin.rootPath, action.Schema),
        descriptionFile: action.DescriptionFile
          ? resolveFrom(plugin.rootPath, action.DescriptionFile)
          : undefined,
        signatureFile: action.SignatureFile
          ? resolveFrom(plugin.rootPath, action.SignatureFile)
          : undefined,
      });
    }

    for (const tool of plugin.manifest.Tools ?? []) {
      if (!isLoadedPluginToolEnabled(plugin, tool.Name)) {
        continue;
      }

      if (this.tools.has(tool.Name)) {
        throw new Error(`工具名重复：${tool.Name}`);
      }

      this.tools.set(tool.Name, {
        plugin,
        name: tool.Name,
        descriptionFile: tool.DescriptionFile
          ? resolveFrom(plugin.rootPath, tool.DescriptionFile)
          : undefined,
        signatureFile: tool.SignatureFile
          ? resolveFrom(plugin.rootPath, tool.SignatureFile)
          : undefined,
        permissions: tool.Permissions ?? [],
        handler: readToolHandler(tool),
        search: tool.Search,
        evidenceCapabilities: tool.EvidenceCapabilities ?? [],
        artifactPolicy: readToolArtifactPolicy(plugin, tool),
      });
    }

    for (const skill of plugin.manifest.Skills ?? []) {
      if (this.skills.has(skill.Name)) {
        throw new Error(`技能名重复：${skill.Name}`);
      }

      this.skills.set(skill.Name, {
        plugin,
        name: skill.Name,
        title: skill.Title,
        descriptionFile: resolveFrom(plugin.rootPath, skill.DescriptionFile),
        workflowFile: skill.WorkflowFile
          ? resolveFrom(plugin.rootPath, skill.WorkflowFile)
          : undefined,
        recommendedTools: skill.RecommendedTools ?? [],
        recommendedAgents: skill.RecommendedAgents ?? [],
        recommendedWorkflows: skill.RecommendedWorkflows ?? [],
        evidenceRequirements: skill.EvidenceRequirements ?? [],
        search: skill.Search,
      });
    }

    for (const contextPack of plugin.manifest.ContextPacks ?? []) {
      if (this.contextPacks.has(contextPack.Name)) {
        throw new Error(`Agent ContextPack 名重复：${contextPack.Name}`);
      }

      this.contextPacks.set(contextPack.Name, {
        plugin,
        name: contextPack.Name,
        description: contextPack.Description,
        templateFile: resolveFrom(plugin.rootPath, contextPack.TemplateFile),
        inputs: contextPack.Inputs,
        toolScope: contextPack.ToolScope,
        history: contextPack.History,
        artifacts: contextPack.Artifacts,
        evidence: contextPack.Evidence,
      });
    }

    for (const mergePolicy of plugin.manifest.MergePolicies ?? []) {
      if (this.mergePolicies.has(mergePolicy.Name)) {
        throw new Error(`Agent MergePolicy 名重复：${mergePolicy.Name}`);
      }

      this.mergePolicies.set(mergePolicy.Name, {
        plugin,
        name: mergePolicy.Name,
        description: mergePolicy.Description,
        strategy: mergePolicy.Strategy,
        templateFile: resolveFrom(plugin.rootPath, mergePolicy.TemplateFile),
        outputSchemaPath: mergePolicy.OutputSchema
          ? resolveFrom(plugin.rootPath, mergePolicy.OutputSchema)
          : undefined,
      });
    }

    for (const agent of plugin.manifest.Agents ?? []) {
      if (this.agents.has(agent.Name)) {
        throw new Error(`Agent 名重复：${agent.Name}`);
      }

      this.agents.set(agent.Name, {
        plugin,
        name: agent.Name,
        title: agent.Title,
        descriptionFile: resolveFrom(plugin.rootPath, agent.DescriptionFile),
        instructionsFile: resolveFrom(plugin.rootPath, agent.InstructionsFile),
        recommendedTools: agent.RecommendedTools ?? [],
        contextPack: agent.ContextPack,
        outputSchemaPath: resolveFrom(plugin.rootPath, agent.OutputSchema),
        runtimeProfile: agent.RuntimeProfile,
        search: agent.Search,
      });
    }

    for (const workflow of plugin.manifest.Workflows ?? []) {
      if (this.workflows.has(workflow.Name)) {
        throw new Error(`Agent Workflow 名重复：${workflow.Name}`);
      }

      this.workflows.set(workflow.Name, {
        plugin,
        name: workflow.Name,
        title: workflow.Title,
        description: workflow.Description,
        trigger: workflow.Trigger,
        execution: workflow.Execution,
        jobs: workflow.Jobs.map((job) => this.registerWorkflowJob(plugin, job)),
        mergePolicy: workflow.MergePolicy,
        search: workflow.Search,
      });
    }

    for (const template of plugin.manifest.Templates ?? []) {
      if (this.templates.has(template.Name)) {
        throw new Error(`模板名重复：${template.Name}`);
      }

      this.templates.set(template.Name, {
        plugin,
        name: template.Name,
        path: resolveFrom(plugin.rootPath, template.Path),
      });
    }

    for (const policy of plugin.manifest.RootCommands ?? []) {
      if (this.rootCommandPolicies.has(policy.Action)) {
        throw new Error(`RootCommand action 策略重复：${policy.Action}`);
      }

      this.rootCommandPolicies.set(policy.Action, policy);
    }
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

  private registerWorkflowJob(
    plugin: LoadedPlugin,
    job: AgentWorkflowJobManifest,
  ): RegisteredAgentWorkflow["jobs"][number] {
    return {
      agent: job.Agent,
      taskFile: resolveFrom(plugin.rootPath, job.TaskFile),
      contextPack: job.ContextPack,
      required: job.Required,
    };
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

function readToolArtifactPolicy(
  plugin: LoadedPlugin,
  tool: import("./Types.js").ToolManifest,
): ToolArtifactPolicyManifest | undefined {
  const fromFile = tool.ArtifactPolicyFile
    ? new AgentJsonFileLoader().load(
        resolveFrom(plugin.rootPath, tool.ArtifactPolicyFile),
        ToolArtifactPolicySchema,
      ) as ToolArtifactPolicyManifest
    : undefined;

  return mergeArtifactPolicy(fromFile, tool.Artifacts);
}

function mergeArtifactPolicy(
  base: ToolArtifactPolicyManifest | undefined,
  override: ToolArtifactPolicyManifest | undefined,
): ToolArtifactPolicyManifest | undefined {
  if (!base && !override) {
    return undefined;
  }

  const redactionKeys = [
    ...(base?.Redact?.Keys ?? []),
    ...(override?.Redact?.Keys ?? []),
  ];
  const redactionPaths = [
    ...(base?.Redact?.Paths ?? []),
    ...(override?.Redact?.Paths ?? []),
  ];
  const evidence = [
    ...(base?.Evidence ?? []),
    ...(override?.Evidence ?? []),
  ];
  const workspacePaths = [
    ...(base?.Workspace?.Paths ?? []),
    ...(override?.Workspace?.Paths ?? []),
  ];
  const merged: ToolArtifactPolicyManifest = {};

  if (base?.Redact || override?.Redact) {
    merged.Redact = {
      ...(base?.Redact ?? {}),
      ...(override?.Redact ?? {}),
      ...(redactionKeys.length > 0 ? { Keys: redactionKeys } : {}),
      ...(redactionPaths.length > 0 ? { Paths: redactionPaths } : {}),
    };
  }

  if (evidence.length > 0) {
    merged.Evidence = evidence;
  }

  const summary = override?.Summary ?? base?.Summary;
  if (summary) {
    merged.Summary = summary;
  }

  if (base?.Workspace || override?.Workspace) {
    const workspaceSource = override?.Workspace ?? base?.Workspace;
    if (!workspaceSource) {
      throw new Error("Artifact Workspace 策略缺少来源。");
    }
    merged.Workspace = {
      ...(base?.Workspace ?? {}),
      ...(override?.Workspace ?? {}),
      PatchContextLines: workspaceSource.PatchContextLines,
      ...(workspacePaths.length > 0 ? { Paths: workspacePaths } : {}),
    };
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function readToolHandler(
  tool: import("./Types.js").ToolManifest,
): import("./Types.js").RegisteredToolHandler {
  const handler = tool.Handler;

  return handler?.Kind === "HostCapability"
    ? { kind: "HostCapability", capability: handler.Capability }
    : { kind: "PluginProcess" };
}
