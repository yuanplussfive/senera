import type { AgentSystemConfig } from "../../Source/AgentSystem/Types/AgentConfigTypes.js";

export interface DesktopRuntimeConfigPaths {
  sandboxRuntimeRoot: string;
}

export interface DesktopRuntimeConfigProjectionOptions {
  packaged: boolean;
}

export function projectDesktopRuntimeConfig(
  paths: DesktopRuntimeConfigPaths,
  config: AgentSystemConfig,
  options: DesktopRuntimeConfigProjectionOptions,
): AgentSystemConfig {
  const provisioning = options.packaged
    ? ({ Kind: "ReleaseBundle" } as const)
    : (config.SandboxRuntime?.Provisioning ?? ({ Kind: "ReleaseBundle" } as const));
  return {
    ...config,
    SandboxRuntime: {
      ...config.SandboxRuntime,
      Provider: "microsandbox",
      BaseDir: paths.sandboxRuntimeRoot,
      ...(provisioning ? { Provisioning: provisioning } : {}),
    },
  };
}
