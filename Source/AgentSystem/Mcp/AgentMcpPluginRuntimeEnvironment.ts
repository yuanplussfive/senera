import { ToolPluginEnvironmentVariables } from "@senera/tool-plugin-sdk/protocol";
import type { PluginManifest } from "../Types/PluginManifestTypes.js";
import type { ResolvedMcpServerManifest } from "./AgentMcpManifestResolver.js";

export function projectAgentMcpPluginRuntimeEnvironment(
  server: ResolvedMcpServerManifest,
  manifest: PluginManifest,
  serverId: string,
): ResolvedMcpServerManifest {
  const remoteJobTools = [
    ...new Set(
      (manifest.Tools ?? []).flatMap((tool) =>
        tool.Handler.Kind === "McpTool" && tool.Handler.Server === serverId && tool.Runtime.Lifecycle === "RemoteJob"
          ? [tool.Handler.Tool]
          : [],
      ),
    ),
  ].sort();
  if (remoteJobTools.length === 0) return server;

  return {
    ...server,
    env: {
      ...server.env,
      [ToolPluginEnvironmentVariables.RemoteJobTools]: JSON.stringify(remoteJobTools),
    },
  };
}
