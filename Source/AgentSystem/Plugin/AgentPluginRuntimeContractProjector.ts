import crypto from "node:crypto";
import { resolveFrom } from "../Core/AgentPath.js";
import { AgentJsonFileLoader } from "../Config/AgentJsonFileLoader.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { isLoadedPluginToolEnabled } from "./AgentPluginConfig.js";
import { ToolArtifactPolicySchema } from "../Schemas/PluginManifestSchema.js";
import type { RootCommandManifest, ToolArtifactPolicyManifest, ToolManifest } from "../Types/PluginManifestTypes.js";
import { ToolLoadingModes } from "../Types/PluginToolManifestTypes.js";
import type {
  LoadedPlugin,
  RegisteredSkill,
  RegisteredTemplate,
  RegisteredTool,
  RegisteredToolHandler,
} from "../Types/PluginRuntimeTypes.js";
import { AgentToolContractBundleLoader } from "../ToolContracts/AgentToolContractBundleLoader.js";
import { AgentJsonSchemaPromptContractProjector } from "../ToolContracts/AgentJsonSchemaPromptContractProjector.js";

export interface AgentPluginRuntimeContributions {
  tools: RegisteredTool[];
  skills: RegisteredSkill[];
  templates: RegisteredTemplate[];
  rootCommandPolicies: RootCommandManifest[];
}

export class AgentPluginRuntimeContractProjector {
  private readonly contractBundles = new AgentToolContractBundleLoader();
  private readonly contractProjector = new AgentJsonSchemaPromptContractProjector();

  project(plugin: LoadedPlugin): AgentPluginRuntimeContributions {
    return {
      tools: this.projectTools(plugin),
      skills: this.projectSkills(plugin),
      templates: this.projectTemplates(plugin),
      rootCommandPolicies: plugin.manifest.RootCommands ?? [],
    };
  }

  private projectTools(plugin: LoadedPlugin): RegisteredTool[] {
    this.assertToolContractCoverage(plugin);
    return (plugin.manifest.Tools ?? [])
      .filter((tool) => isLoadedPluginToolEnabled(plugin, tool.Name))
      .map((tool) => ({
        plugin,
        name: tool.Name,
        loading: tool.Loading ?? ToolLoadingModes.Dynamic,
        descriptionFile: tool.DescriptionFile ? resolveFrom(plugin.rootPath, tool.DescriptionFile) : undefined,
        contract: this.projectToolContract(plugin, tool),
        permissions: tool.Permissions ?? [],
        handler: readToolHandler(tool),
        execution: tool.Execution,
        runtime: tool.Runtime,
        observation: tool.Observation,
        search: tool.Search,
        evidenceCapabilities: tool.EvidenceCapabilities ?? [],
        approval: tool.Approval,
        artifactPolicy: readToolArtifactPolicy(plugin, tool),
      }));
  }

  private assertToolContractCoverage(plugin: LoadedPlugin): void {
    const tools = plugin.manifest.Tools ?? [];
    if (tools.length === 0) return;
    const contractFile = plugin.manifest.Contracts?.File;
    if (!contractFile) {
      throw new Error(`Plugin ${plugin.manifest.Plugin.Name} does not declare a tool contract bundle.`);
    }
    const bundle = this.contractBundles.load(plugin.rootPath, contractFile);
    const declared = new Set(tools.map((tool) => tool.Name));
    const bundled = new Set(Object.keys(bundle.tools));
    const missing = [...declared].filter((name) => !bundled.has(name));
    const extraneous = [...bundled].filter((name) => !declared.has(name));
    if (missing.length === 0 && extraneous.length === 0) return;
    throw new Error(
      [
        `Tool contract bundle for ${plugin.manifest.Plugin.Name} does not match its manifest.`,
        ...(missing.length > 0 ? [`Missing: ${missing.join(", ")}`] : []),
        ...(extraneous.length > 0 ? [`Extraneous: ${extraneous.join(", ")}`] : []),
      ].join("\n"),
    );
  }

  private projectToolContract(plugin: LoadedPlugin, tool: ToolManifest) {
    const contractFile = plugin.manifest.Contracts?.File;
    if (!contractFile) throw new Error(`Plugin ${plugin.manifest.Plugin.Name} has no tool contract bundle.`);
    const definition = this.contractBundles.load(plugin.rootPath, contractFile).tools[tool.Name];
    if (!definition) {
      throw new Error(`Tool contract bundle for ${plugin.manifest.Plugin.Name} does not define ${tool.Name}.`);
    }
    const argumentsContract = this.contractProjector.project(definition.inputSchema);
    const digest = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          manifestVersion: plugin.manifest.ManifestVersion,
          plugin: plugin.manifest.Plugin.Name,
          pluginVersion: plugin.manifest.Plugin.Version,
          tool: tool.Name,
          contractSourceDigest: definition.source.sha256,
          observation: tool.Observation,
          arguments: argumentsContract,
        }),
      )
      .digest("hex");
    return deepFreeze({
      digest,
      arguments: argumentsContract,
    });
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

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
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
  const redactionStreams = [...new Set([...(base?.Redact?.Streams ?? []), ...(override?.Redact?.Streams ?? [])])];
  const redactionTransforms = [...(base?.Redact?.Transforms ?? []), ...(override?.Redact?.Transforms ?? [])];
  const evidence = [...(base?.Evidence ?? []), ...(override?.Evidence ?? [])];
  const workspacePaths = [...(base?.Workspace?.Paths ?? []), ...(override?.Workspace?.Paths ?? [])];
  const merged: ToolArtifactPolicyManifest = {};

  if (base?.Redact || override?.Redact) {
    merged.Redact = {
      ...(base?.Redact ?? {}),
      ...(override?.Redact ?? {}),
      ...(redactionKeys.length > 0 ? { Keys: redactionKeys } : {}),
      ...(redactionPaths.length > 0 ? { Paths: redactionPaths } : {}),
      ...(redactionStreams.length > 0 ? { Streams: redactionStreams } : {}),
      ...(redactionTransforms.length > 0 ? { Transforms: redactionTransforms } : {}),
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
  switch (handler.Kind) {
    case "HostCapability":
      return { kind: "HostCapability", capability: handler.Capability };
    case "McpTool":
      return {
        kind: "McpTool",
        server: handler.Server,
        tool: handler.Tool,
        resources: handler.Resources ?? [],
      };
  }
}
