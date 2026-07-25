import type { AgentSystemConfig } from "../../Source/AgentSystem/Types/AgentConfigTypes.js";

export interface DesktopPluginRoots {
  systemPluginRoot: string;
  userPluginRoot: string;
  sandboxRuntimeRoot: string;
}

export interface DesktopRuntimeConfigProjectionOptions {
  packaged: boolean;
}

export function projectDesktopRuntimeConfig(
  paths: DesktopPluginRoots,
  config: AgentSystemConfig,
  options: DesktopRuntimeConfigProjectionOptions,
): AgentSystemConfig {
  const provisioning = options.packaged
    ? ({ Kind: "ReleaseBundle" } as const)
    : (config.SandboxRuntime?.Provisioning ?? ({ Kind: "ReleaseBundle" } as const));
  return {
    ...config,
    PluginRoots: {
      ...config.PluginRoots,
      System: [paths.systemPluginRoot],
      User: [paths.userPluginRoot],
    },
    SandboxRuntime: {
      ...config.SandboxRuntime,
      Provider: "microsandbox",
      BaseDir: paths.sandboxRuntimeRoot,
      ...(provisioning ? { Provisioning: provisioning } : {}),
    },
  };
}
