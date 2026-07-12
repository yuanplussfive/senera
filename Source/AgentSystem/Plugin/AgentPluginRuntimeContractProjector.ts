import { resolveFrom } from "../Core/AgentPath.js";
import { AgentJsonFileLoader } from "../Config/AgentJsonFileLoader.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { isLoadedPluginToolEnabled } from "./AgentPluginConfig.js";
import { ToolArtifactPolicySchema } from "../Schemas/PluginManifestSchema.js";
import type { RootCommandManifest, ToolArtifactPolicyManifest, ToolManifest } from "../Types/PluginManifestTypes.js";
import type {
  LoadedPlugin,
  RegisteredSkill,
  RegisteredTemplate,
  RegisteredTool,
  RegisteredToolHandler,
} from "../Types/PluginRuntimeTypes.js";

export interface AgentPluginRuntimeContributions {
  tools: RegisteredTool[];
  skills: RegisteredSkill[];
  templates: RegisteredTemplate[];
  rootCommandPolicies: RootCommandManifest[];
}

export class AgentPluginRuntimeContractProjector {
  project(plugin: LoadedPlugin): AgentPluginRuntimeContributions {
    return {
      tools: this.projectTools(plugin),
      skills: this.projectSkills(plugin),
      templates: this.projectTemplates(plugin),
      rootCommandPolicies: plugin.manifest.RootCommands ?? [],
    };
  }

  private projectTools(plugin: LoadedPlugin): RegisteredTool[] {
    return (plugin.manifest.Tools ?? [])
      .filter((tool) => isLoadedPluginToolEnabled(plugin, tool.Name))
      .map((tool) => ({
        plugin,
        name: tool.Name,
        descriptionFile: tool.DescriptionFile ? resolveFrom(plugin.rootPath, tool.DescriptionFile) : undefined,
        signatureFile: tool.SignatureFile ? resolveFrom(plugin.rootPath, tool.SignatureFile) : undefined,
        signatureType: tool.SignatureType,
        permissions: tool.Permissions ?? [],
        handler: readToolHandler(tool),
        execution: tool.Execution,
        search: tool.Search,
        evidenceCapabilities: tool.EvidenceCapabilities ?? [],
        approval: tool.Approval,
        artifactPolicy: readToolArtifactPolicy(plugin, tool),
      }));
  }

  private projectSkills(plugin: LoadedPlugin): RegisteredSkill[] {
    return (plugin.manifest.Skills ?? []).map((skill) => ({
      plugin,
      name: skill.Name,
      title: skill.Title,
      descriptionFile: resolveFrom(plugin.rootPath, skill.DescriptionFile),
      recommendedTools: skill.RecommendedTools ?? [],
      evidenceRequirements: skill.EvidenceRequirements ?? [],
      search: skill.Search,
    }));
  }

  private projectTemplates(plugin: LoadedPlugin): RegisteredTemplate[] {
    return (plugin.manifest.Templates ?? []).map((template) => ({
      plugin,
      name: template.Name,
      path: resolveFrom(plugin.rootPath, template.Path),
      description: template.Description,
      exposeToPi: template.ExposeToPi === true,
      search: template.Search,
    }));
  }
}

function readToolArtifactPolicy(plugin: LoadedPlugin, tool: ToolManifest): ToolArtifactPolicyManifest | undefined {
  const fromFile = tool.ArtifactPolicyFile
    ? (new AgentJsonFileLoader().load(
        resolveFrom(plugin.rootPath, tool.ArtifactPolicyFile),
        ToolArtifactPolicySchema,
      ) as ToolArtifactPolicyManifest)
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

  const redactionKeys = [...(base?.Redact?.Keys ?? []), ...(override?.Redact?.Keys ?? [])];
  const redactionPaths = [...(base?.Redact?.Paths ?? []), ...(override?.Redact?.Paths ?? [])];
  const evidence = [...(base?.Evidence ?? []), ...(override?.Evidence ?? [])];
  const workspacePaths = [...(base?.Workspace?.Paths ?? []), ...(override?.Workspace?.Paths ?? [])];
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
      throw new Error(agentErrorMessage("plugin.artifactWorkspacePolicyMissingSource"));
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

function readToolHandler(tool: ToolManifest): RegisteredToolHandler {
  const handler = tool.Handler;

  const handlers = {
    HostCapability: () =>
      ({
        kind: "HostCapability",
        capability: handler?.Kind === "HostCapability" ? handler.Capability : "",
      }) satisfies RegisteredToolHandler,
    McpTool: () =>
      ({
        kind: "McpTool",
        server: handler?.Kind === "McpTool" ? handler.Server : "",
        tool: handler?.Kind === "McpTool" ? handler.Tool : "",
      }) satisfies RegisteredToolHandler,
    PluginProcess: () => ({ kind: "PluginProcess" }) satisfies RegisteredToolHandler,
  } satisfies Record<NonNullable<ToolManifest["Handler"]>["Kind"] | "PluginProcess", () => RegisteredToolHandler>;

  return handlers[handler?.Kind ?? "PluginProcess"]();
}
