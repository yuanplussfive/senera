import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentMcpPackage } from "./AgentMcpPackageTypes.js";

/**
 * Resolves the persisted activation intent for one declared MCP server.
 * Undeclared entries are enabled by the configuration contract, so bundled
 * and workspace packages do not need duplicate bootstrap records.
 */
export function isAgentMcpServerEnabled(config: AgentSystemConfig, serverId: string): boolean {
  return config.McpServers?.[serverId]?.Enabled !== false;
}

/**
 * Keeps descriptor discovery declarative: packages are scanned as usual, then
 * only the servers enabled by the current workspace configuration enter the
 * executable runtime catalog.
 */
export function filterEnabledAgentMcpPackageServers(
  config: AgentSystemConfig,
  packages: readonly AgentMcpPackage[],
): readonly AgentMcpPackage[] {
  return packages.flatMap((package_) => {
    const servers = package_.servers.filter((server) => isAgentMcpServerEnabled(config, server.name));
    return servers.length === 0 ? [] : [{ ...package_, servers }];
  });
}
