import { AgentToolChildGrantModes } from "../Types/AgentToolContractTypes.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { AgentExtensionRegistryLike } from "../Types/ToolRuntimeTypes.js";
import { AgentChildWorkspaceAccessModes, type AgentChildWorkspaceAccessMode } from "./AgentChildRunTypes.js";
import {
  AgentSubagentCapabilityCeilingVersion,
  type AgentSubagentCapabilityCeiling,
} from "./AgentSubagentContracts.js";

export interface AgentSubagentToolGrantProjectionOptions {
  readonly workspaceAccess: AgentChildWorkspaceAccessMode;
  readonly canDelegate: boolean;
  readonly allowedAgentNames: readonly string[];
  readonly inheritedCeiling?: AgentSubagentCapabilityCeiling;
}

export interface AgentSubagentToolGrantProjection {
  readonly effectiveToolNames: readonly string[];
  readonly capabilityCeiling: AgentSubagentCapabilityCeiling;
}

export class AgentSubagentToolGrantProjector {
  project(
    authorizedToolNames: readonly string[],
    registry: AgentExtensionRegistryLike,
    options: AgentSubagentToolGrantProjectionOptions,
  ): AgentSubagentToolGrantProjection {
    const registeredTools = requireRegisteredTools(registry);
    const toolsByName = new Map(registeredTools.map((tool) => [tool.name, tool]));
    const authorized = authorizedToolNames.map((name) => {
      const tool = toolsByName.get(name);
      if (!tool) throw new AgentSubagentToolGrantError("authorized_tool_unregistered", name);
      return tool;
    });
    const authorizedNames = new Set(authorized.map((tool) => tool.name));
    const candidates = uniqueTools([
      ...authorized,
      ...registeredTools.filter((tool) => tool.childGrant === AgentToolChildGrantModes.Internal),
    ]);
    const inheritedTools = options.inheritedCeiling ? new Set(options.inheritedCeiling.allowedTools) : undefined;
    const effectiveTools = candidates.filter(
      (tool) =>
        isWithinWorkspaceAccess(tool, options.workspaceAccess) &&
        (!inheritedTools || inheritedTools.has(tool.name)) &&
        isGrantedToChild(tool, authorizedNames, options.canDelegate),
    );
    const effectiveToolNames = effectiveTools.map((tool) => tool.name);
    const sources = [
      ...(options.inheritedCeiling?.sources ?? []),
      "senera.parent-run-tool-grant",
      `senera.workspace-access.${options.workspaceAccess}`,
      `senera.child-delegation.${options.canDelegate ? "allowed" : "denied"}`,
    ];

    return {
      effectiveToolNames,
      capabilityCeiling: {
        version: AgentSubagentCapabilityCeilingVersion,
        allowedTools: effectiveToolNames,
        allowedAgents: options.canDelegate ? uniqueSorted(options.allowedAgentNames) : [],
        denyExtensions: options.inheritedCeiling?.denyExtensions ?? false,
        sources: unique(sources),
      },
    };
  }
}

export class AgentSubagentToolGrantError extends Error {
  constructor(
    readonly code: "authorized_tool_unregistered",
    readonly toolName: string,
  ) {
    super(`Parent Tool grant references an unregistered Tool: ${toolName}.`);
    this.name = "AgentSubagentToolGrantError";
  }
}

function requireRegisteredTools(registry: AgentExtensionRegistryLike): readonly RegisteredTool[] {
  const tools = registry.listTools?.();
  if (!tools) throw new Error("Subagent Tool grant projection requires a registry Tool snapshot.");
  return tools;
}

function isGrantedToChild(
  tool: RegisteredTool,
  authorizedToolNames: ReadonlySet<string>,
  canDelegate: boolean,
): boolean {
  switch (tool.childGrant) {
    case AgentToolChildGrantModes.Internal:
      return true;
    case AgentToolChildGrantModes.Delegation:
      return canDelegate && authorizedToolNames.has(tool.name);
    case AgentToolChildGrantModes.Inherit:
      return authorizedToolNames.has(tool.name);
  }
}

function isWithinWorkspaceAccess(tool: RegisteredTool, workspaceAccess: AgentChildWorkspaceAccessMode): boolean {
  return workspaceAccess === AgentChildWorkspaceAccessModes.ReadWrite || tool.execution.Workspace === "ReadOnly";
}

function uniqueTools(tools: readonly RegisteredTool[]): RegisteredTool[] {
  return [...new Map(tools.map((tool) => [tool.name, tool])).values()];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueSorted(values: readonly string[]): string[] {
  return unique(values).sort((left, right) => left.localeCompare(right));
}
