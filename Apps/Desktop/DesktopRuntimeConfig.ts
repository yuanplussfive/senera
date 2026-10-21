import type { AgentSystemConfig } from "../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { resolveAgentWorkspaceLayout } from "../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";

export function projectDesktopRuntimeConfig(
  config: AgentSystemConfig,
  workspaceRoot: string,
  serverPort: number | undefined = readDesktopServerPort(process.env.SENERA_SERVER_PORT),
): AgentSystemConfig {
  return {
    ...config,
    ...(serverPort === undefined
      ? {}
      : {
          Server: {
            ...config.Server,
            Port: serverPort,
          },
        }),
    SandboxRuntime: {
      ...config.SandboxRuntime,
      Provider: "auto",
      BaseDir: resolveAgentWorkspaceLayout(workspaceRoot).desktopRuntimeRoot,
    },
  };
}

export function readDesktopServerPort(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SENERA_SERVER_PORT must be an integer between 1 and 65535.");
  }
  return port;
}
