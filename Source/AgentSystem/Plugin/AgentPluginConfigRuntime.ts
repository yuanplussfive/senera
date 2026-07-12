import type {
  AgentPluginConfigSnapshotItem,
  LoadedPluginConfigDiagnostic,
  LoadedPluginRuntimeConfig,
} from "../Types/PluginConfigTypes.js";
import type { LoadedPlugin } from "../Types/PluginRuntimeTypes.js";
import { FrameworkRuntimeConfigSchema } from "./AgentPluginConfigSchema.js";

export function projectPluginRuntimeConfig(value: unknown): LoadedPluginRuntimeConfig {
  const framework = FrameworkRuntimeConfigSchema.parse(value ?? {});
  return {
    enabled: framework.enabled ?? true,
    tools: Object.fromEntries(
      Object.entries(framework.tools ?? {}).map(([name, tool]) => [
        name,
        {
          enabled: tool.enabled,
        },
      ]),
    ),
  };
}

export function disabledPluginRuntimeConfig(): LoadedPluginRuntimeConfig {
  return {
    enabled: false,
    tools: {},
  };
}

export function projectPluginConfigSnapshot(plugin: LoadedPlugin): AgentPluginConfigSnapshotItem {
  const manifest = plugin.manifest;
  const tools = (manifest.Tools ?? []).map((tool) => ({
    name: tool.Name,
    summary: tool.Search?.Summary,
    enabled: isLoadedPluginToolEnabled(plugin, tool.Name),
  }));

  return {
    name: manifest.Plugin.Name,
    title: manifest.Plugin.Title ?? manifest.Plugin.Name,
    kind: manifest.Plugin.Kind,
    rootKind: plugin.rootKind,
    description: manifest.Plugin.Description,
    rootPath: plugin.rootPath,
    manifestPath: plugin.manifestPath,
    configPath: plugin.config.path,
    configExists: plugin.config.exists,
    configSource: plugin.config.source,
    configTemplatePath: plugin.config.templatePath,
    configTemplateExists: plugin.config.templateExists,
    needsUserConfig: plugin.config.needsUserConfig,
    enabled: plugin.config.runtime.enabled,
    available: isLoadedPluginAvailable(plugin),
    toolCount: tools.length,
    enabledToolCount: tools.filter((tool) => tool.enabled).length,
    tools,
    sections: plugin.config.sections,
    toml: plugin.config.toml,
    diagnostics: plugin.config.diagnostics,
  };
}

export function isLoadedPluginAvailable(plugin: LoadedPlugin): boolean {
  if (plugin.rootKind === "System") {
    return !hasErrorDiagnostics(plugin.config.diagnostics);
  }

  return (
    plugin.config.runtime.enabled && !plugin.config.needsUserConfig && !hasErrorDiagnostics(plugin.config.diagnostics)
  );
}

export function isLoadedPluginToolEnabled(plugin: LoadedPlugin, toolName: string): boolean {
  if (plugin.rootKind === "System") {
    return true;
  }

  return plugin.config.runtime.tools[toolName]?.enabled !== false;
}

function hasErrorDiagnostics(diagnostics: readonly LoadedPluginConfigDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
