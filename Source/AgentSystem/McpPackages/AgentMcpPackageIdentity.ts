const McpToolNameSeparator = "__";

export function agentMcpPackageToolName(serverName: string, toolName: string): string {
  return ["mcp", serverName, toolName].map(toIdentifierSegment).join(McpToolNameSeparator);
}

export function isAgentMcpPackageToolNameForServer(toolName: string, serverName: string): boolean {
  return toolName.startsWith(
    `${["mcp", serverName].map(toIdentifierSegment).join(McpToolNameSeparator)}${McpToolNameSeparator}`,
  );
}

function toIdentifierSegment(value: string): string {
  return value.replaceAll("-", "_");
}
