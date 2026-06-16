import { resolveFrom } from "./AgentPath.js";
import type {
  LoadedPlugin,
  RegisteredDecisionAction,
  RegisteredTemplate,
  RegisteredTool,
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
  private readonly templates = new Map<string, RegisteredTemplate>();

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
        artifactPolicy: readToolArtifactPolicy(plugin, tool),
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

  getTemplate(name: string): RegisteredTemplate | undefined {
    return this.templates.get(name);
  }

  listTemplates(): RegisteredTemplate[] {
    return [...this.templates.values()];
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
