import { AgentPluginScanner } from "./AgentPluginScanner.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { projectPluginConfigSnapshot, setPluginConfigEnabled, writePluginConfigToml } from "./AgentPluginConfig.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentPluginConfigSnapshotItem } from "../Types/PluginConfigTypes.js";
import type { LoadedPlugin } from "../Types/PluginRuntimeTypes.js";

export interface AgentPluginConfigSnapshot {
  plugins: AgentPluginConfigSnapshotItem[];
}

export interface AgentPluginConfigManagerOptions {
  workspaceRoot: string;
  configSnapshot: () => AgentSystemConfig;
}

export class AgentPluginConfigManager {
  constructor(private readonly options: AgentPluginConfigManagerOptions) {}

  snapshot(): AgentPluginConfigSnapshot {
    return {
      plugins: this.configurablePlugins().map(projectPluginConfigSnapshot),
    };
  }

  updatePluginConfig(input: { pluginName: string; toml: string }): AgentPluginConfigSnapshot {
    const plugin = this.findPlugin(input.pluginName);
    writePluginConfigToml(plugin.config.path, input.toml);
    return this.snapshot();
  }

  setPluginEnabled(input: { pluginName: string; enabled: boolean; toolName?: string }): AgentPluginConfigSnapshot {
    const plugin = this.findPlugin(input.pluginName);
    const toml = setPluginConfigEnabled(plugin.config, {
      enabled: input.enabled,
      toolName: input.toolName,
    });
    writePluginConfigToml(plugin.config.path, toml);
    return this.snapshot();
  }

  private findPlugin(pluginName: string): LoadedPlugin {
    const plugin = this.configurablePlugins().find((item) => item.manifest.Plugin.Name === pluginName);
    if (!plugin) {
      throw new Error(agentErrorMessage("plugin.configurablePluginMissing", { pluginName }));
    }
    return plugin;
  }

  private configurablePlugins(): LoadedPlugin[] {
    return this.scanPlugins().filter((plugin) => plugin.rootKind === "User");
  }

  private scanPlugins(): LoadedPlugin[] {
    return new AgentPluginScanner(this.options.workspaceRoot, this.options.configSnapshot()).scan();
  }
}
