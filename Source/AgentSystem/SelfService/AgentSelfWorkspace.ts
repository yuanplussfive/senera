import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import type { AgentSelfServicePort, AgentSelfWorkspaceInfo } from "./AgentSelfServiceTypes.js";

const DataDomainNames = ["config", "credentials", "sessions", "memory", "memos", "orchestration", "channels"] as const;

export function projectAgentSelfWorkspaceInfo(port: AgentSelfServicePort): AgentSelfWorkspaceInfo {
  const layout = resolveAgentWorkspaceLayout(port.workspaceRoot);
  return {
    root: layout.root,
    stateRoot: layout.stateRoot,
    logsRoot: port.logs?.root() ?? layout.logsRoot,
    dataRoot: layout.dataRoot,
    skillRoot: layout.skillRoot,
    mcpRoot: layout.mcpRoot,
    databases: Object.fromEntries(DataDomainNames.map((domain) => [domain, layout.databases[domain]])),
    deployed: port.slice?.deployedModes ?? [],
  };
}

export function describeAgentSelfWorkspace(info: AgentSelfWorkspaceInfo): string {
  return [
    `workspace: ${info.root}`,
    `state: ${info.stateRoot}`,
    `logs: ${info.logsRoot}`,
    `data: ${info.dataRoot}`,
    `skills: ${info.skillRoot}`,
    `mcp: ${info.mcpRoot}`,
    ...(info.deployed.length > 0
      ? [`deployed: ${info.deployed.map((mode) => `${mode.name} (${mode.kind})`).join(", ")}`]
      : []),
  ].join("\n");
}
