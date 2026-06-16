import { AgentPluginScanner } from "./AgentPluginScanner.js";
import {
  projectPluginConfigSnapshot,
  setPluginConfigEnabled,
  writePluginConfigToml,
} from "./AgentPluginConfig.js";
import type {
  AgentPluginConfigSnapshotItem,
  AgentSystemConfig,
  LoadedPlugin,
} from "./Types.js";

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

  updatePluginConfig(input: {
    pluginName: string;
    toml: string;
  }): AgentPluginConfigSnapshot {
    const plugin = this.findPlugin(input.pluginName);
    writePluginConfigToml(plugin.config.path, input.toml);
    return this.snapshot();
  }

  setPluginEnabled(input: {
    pluginName: string;
    enabled: boolean;
    toolName?: string;
  }): AgentPluginConfigSnapshot {
    const plugin = this.findPlugin(input.pluginName);
    const toml = setPluginConfigEnabled(plugin.config, {
      enabled: input.enabled,
      toolName: input.toolName,
    });
    writePluginConfigToml(plugin.config.path, toml);
    return this.snapshot();
  }

  private findPlugin(pluginName: string): LoadedPlugin {
    const plugin = this.configurablePlugins().find(
      (item) => item.manifest.Plugin.Name === pluginName,
    );
    if (!plugin) {
      throw new Error(`可配置插件不存在：${pluginName}`);
    }
    return plugin;
  }

  private configurablePlugins(): LoadedPlugin[] {
    return this.scanPlugins().filter((plugin) => plugin.rootKind === "User");
  }

  private scanPlugins(): LoadedPlugin[] {
    return new AgentPluginScanner(
      this.options.workspaceRoot,
      this.options.configSnapshot(),
    ).scan();
  }
}
