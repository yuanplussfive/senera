import { resolveFrom } from "../Core/AgentPath.js";
import { AgentJsonFileLoader } from "../Config/AgentJsonFileLoader.js";
import { isLoadedPluginToolEnabled } from "./AgentPluginConfig.js";
import { ToolArtifactPolicySchema } from "../Schemas/PluginManifestSchema.js";
import type {
  AgentWorkflowJobManifest,
  RootCommandManifest,
  ToolArtifactPolicyManifest,
  ToolManifest,
} from "../Types/PluginManifestTypes.js";
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
  RegisteredToolHandler,
} from "../Types/PluginRuntimeTypes.js";

export interface AgentPluginRuntimeContributions {
  decisionActions: RegisteredDecisionAction[];
  tools: RegisteredTool[];
  skills: RegisteredSkill[];
  agents: RegisteredAgent[];
  contextPacks: RegisteredAgentContextPack[];
  mergePolicies: RegisteredAgentMergePolicy[];
  workflows: RegisteredAgentWorkflow[];
  templates: RegisteredTemplate[];
  rootCommandPolicies: RootCommandManifest[];
}

export class AgentPluginRuntimeContractProjector {
  project(plugin: LoadedPlugin): AgentPluginRuntimeContributions {
    return {
      decisionActions: this.projectDecisionActions(plugin),
      tools: this.projectTools(plugin),
      skills: this.projectSkills(plugin),
      agents: this.projectAgents(plugin),
      contextPacks: this.projectContextPacks(plugin),
      mergePolicies: this.projectMergePolicies(plugin),
      workflows: this.projectWorkflows(plugin),
      templates: this.projectTemplates(plugin),
      rootCommandPolicies: plugin.manifest.RootCommands ?? [],
    };
  }

  private projectDecisionActions(plugin: LoadedPlugin): RegisteredDecisionAction[] {
    return (plugin.manifest.DecisionActions ?? []).map((action) => ({
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
      signatureType: action.SignatureType,
    }));
  }

  private projectTools(plugin: LoadedPlugin): RegisteredTool[] {
    return (plugin.manifest.Tools ?? [])
      .filter((tool) => isLoadedPluginToolEnabled(plugin, tool.Name))
      .map((tool) => ({
        plugin,
        name: tool.Name,
        descriptionFile: tool.DescriptionFile
          ? resolveFrom(plugin.rootPath, tool.DescriptionFile)
          : undefined,
        signatureFile: tool.SignatureFile
          ? resolveFrom(plugin.rootPath, tool.SignatureFile)
          : undefined,
        signatureType: tool.SignatureType,
        permissions: tool.Permissions ?? [],
        handler: readToolHandler(tool),
        search: tool.Search,
        evidenceCapabilities: tool.EvidenceCapabilities ?? [],
        artifactPolicy: readToolArtifactPolicy(plugin, tool),
      }));
  }

  private projectSkills(plugin: LoadedPlugin): RegisteredSkill[] {
    return (plugin.manifest.Skills ?? []).map((skill) => ({
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
    }));
  }

  private projectAgents(plugin: LoadedPlugin): RegisteredAgent[] {
    return (plugin.manifest.Agents ?? []).map((agent) => ({
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
    }));
  }

  private projectContextPacks(plugin: LoadedPlugin): RegisteredAgentContextPack[] {
    return (plugin.manifest.ContextPacks ?? []).map((contextPack) => ({
      plugin,
      name: contextPack.Name,
      description: contextPack.Description,
      templateFile: resolveFrom(plugin.rootPath, contextPack.TemplateFile),
      inputs: contextPack.Inputs,
      toolScope: contextPack.ToolScope,
      history: contextPack.History,
      artifacts: contextPack.Artifacts,
      evidence: contextPack.Evidence,
    }));
  }

  private projectMergePolicies(plugin: LoadedPlugin): RegisteredAgentMergePolicy[] {
    return (plugin.manifest.MergePolicies ?? []).map((mergePolicy) => ({
      plugin,
      name: mergePolicy.Name,
      description: mergePolicy.Description,
      strategy: mergePolicy.Strategy,
      templateFile: resolveFrom(plugin.rootPath, mergePolicy.TemplateFile),
      outputSchemaPath: mergePolicy.OutputSchema
        ? resolveFrom(plugin.rootPath, mergePolicy.OutputSchema)
        : undefined,
    }));
  }

  private projectWorkflows(plugin: LoadedPlugin): RegisteredAgentWorkflow[] {
    return (plugin.manifest.Workflows ?? []).map((workflow) => ({
      plugin,
      name: workflow.Name,
      title: workflow.Title,
      description: workflow.Description,
      trigger: workflow.Trigger,
      execution: workflow.Execution,
      jobs: workflow.Jobs.map((job) => registerWorkflowJob(plugin, job)),
      mergePolicy: workflow.MergePolicy,
      search: workflow.Search,
    }));
  }

  private projectTemplates(plugin: LoadedPlugin): RegisteredTemplate[] {
    return (plugin.manifest.Templates ?? []).map((template) => ({
      plugin,
      name: template.Name,
      path: resolveFrom(plugin.rootPath, template.Path),
    }));
  }
}

function registerWorkflowJob(
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

function readToolArtifactPolicy(
  plugin: LoadedPlugin,
  tool: ToolManifest,
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
  tool: ToolManifest,
): RegisteredToolHandler {
  const handler = tool.Handler;

  return handler?.Kind === "HostCapability"
    ? { kind: "HostCapability", capability: handler.Capability }
    : { kind: "PluginProcess" };
}
