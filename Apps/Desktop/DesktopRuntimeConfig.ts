import type { AgentSystemConfig } from "../../Source/AgentSystem/Types/AgentConfigTypes.js";

export interface DesktopRuntimeConfigPaths {
  sandboxRuntimeRoot: string;
}

export function projectDesktopRuntimeConfig(
  paths: DesktopRuntimeConfigPaths,
  config: AgentSystemConfig,
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
      BaseDir: paths.sandboxRuntimeRoot,
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
