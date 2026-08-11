import type { AgentSystemConfig } from "../../Source/AgentSystem/Types/AgentConfigTypes.js";

export interface DesktopRuntimeConfigPaths {
  sandboxRuntimeRoot: string;
}

export function projectDesktopRuntimeConfig(
  paths: DesktopRuntimeConfigPaths,
  config: AgentSystemConfig,
): AgentSystemConfig {
  return {
    ...config,
    SandboxRuntime: {
      ...config.SandboxRuntime,
      Provider: "auto",
      BaseDir: paths.sandboxRuntimeRoot,
    },
  };
}
