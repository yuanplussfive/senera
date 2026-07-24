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
  const provisioning =
    config.SandboxRuntime?.Provisioning ?? (options.packaged ? ({ Kind: "ReleaseBundle" } as const) : undefined);
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
      ...(provisioning ? { Provisioning: provisioning } : {}),
    },
  };
}
