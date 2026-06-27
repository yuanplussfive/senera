import type { AgentSystemConfig } from "../../Source/AgentSystem/Types/AgentConfigTypes.js";

export interface DesktopPluginRoots {
  systemPluginRoot: string;
  userPluginRoot: string;
}

export function projectDesktopRuntimeConfig(
  paths: DesktopPluginRoots,
  config: AgentSystemConfig,
): AgentSystemConfig {
  return {
    ...config,
    PluginRoots: {
      ...config.PluginRoots,
      System: [paths.systemPluginRoot],
      User: [paths.userPluginRoot],
    },
  };
}
