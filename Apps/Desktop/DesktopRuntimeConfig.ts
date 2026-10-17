import type { AgentSystemConfig } from "../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { resolveAgentWorkspaceLayout } from "../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";

export function projectDesktopRuntimeConfig(config: AgentSystemConfig, workspaceRoot: string): AgentSystemConfig {
  return {
    ...config,
    SandboxRuntime: {
      ...config.SandboxRuntime,
      Provider: "auto",
      BaseDir: resolveAgentWorkspaceLayout(workspaceRoot).desktopRuntimeRoot,
    },
  };
}
