import { resolveFrom } from "./AgentPath.js";
import type {
  LoadedPlugin,
  RegisteredDecisionAction,
  RegisteredTemplate,
  RegisteredTool,
} from "./Types.js";

export class AgentPluginRegistry {
  private readonly plugins = new Map<string, LoadedPlugin>();
  private readonly decisionActionsByRoot = new Map<string, RegisteredDecisionAction>();
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly templates = new Map<string, RegisteredTemplate>();

  registerPlugin(plugin: LoadedPlugin): void {
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

function readToolHandler(
  tool: import("./Types.js").ToolManifest,
): import("./Types.js").RegisteredToolHandler {
  const handler = tool.Handler;

  return handler?.Kind === "HostCapability"
    ? { kind: "HostCapability", capability: handler.Capability }
    : { kind: "PluginProcess" };
}
