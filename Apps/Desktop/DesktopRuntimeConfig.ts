import type { AgentSystemConfig } from "../../Source/AgentSystem/Types/AgentConfigTypes.js";

export interface DesktopPluginRoots {
  systemPluginRoot: string;
  userPluginRoot: string;
  sandboxRuntimeRoot: string;
  sandboxBundleRoot: string;
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
    SandboxRuntime: {
      ...config.SandboxRuntime,
      BaseDir: paths.sandboxRuntimeRoot,
      BundleDir: paths.sandboxBundleRoot,
    },
  };
}
