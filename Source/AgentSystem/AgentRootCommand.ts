import {
  agentActionCapabilityNeeds,
  agentActionInstruction,
  agentActionPreferredTools,
  agentActionToolSearchQueries,
  type AgentActionCapabilityNeed,
  type AgentActionDecision,
} from "./ActionPlanner/AgentActionPlanner.js";
import type { RegisteredTool } from "./Types/PluginRuntimeTypes.js";
import type {
  RootCommandManifest,
  RootCommandToolSelectorManifest,
  RootCommandVisibleOutputManifest,
  RootCommandVisibleOutputRuleManifest,
} from "./Types/PluginManifestTypes.js";
import { agentErrorMessage } from "./I18n/AgentMessageCatalog.js";

export type AgentRootCommandToolAccess = RootCommandManifest["ToolAccess"];
export type AgentRootOutputMode = RootCommandManifest["OutputMode"];

export interface AgentRootCommand {
  authority: "senera_runtime_root";
  action: AgentActionDecision["action"];
  outputMode: AgentRootOutputMode;
  toolAccess: AgentRootCommandToolAccess;
  objective: string;
  instruction: string | null;
  allowedTools: string[];
  forbiddenOutputs: string[];
  insufficiencyPolicy: string;
  preferredTools: string[];
  toolSearchQueries: string[];
  needs: AgentActionCapabilityNeed[];
  includeToolCatalog: boolean;
  visibleOutput: AgentRootCommandVisibleOutput;
}

export interface AgentRootCommandVisibleOutput {
  audience: string;
  start: string;
  format: string;
  rules: AgentRootCommandVisibleOutputRule[];
  repair: AgentRootCommandVisibleOutputRepair;
}

export interface AgentRootCommandVisibleOutputRule {
  name: string;
  value: string;
  instruction?: string;
}

export interface AgentRootCommandVisibleOutputRepair {
  instruction: string;
  rules: AgentRootCommandVisibleOutputRule[];
}

export function buildAgentRootCommand(options: {
  decision: AgentActionDecision;
  loadedTools: readonly Pick<RegisteredTool, "name" | "handler">[];
  policy: RootCommandManifest;
}): AgentRootCommand {
  if (options.policy.Action !== options.decision.action) {
    throw new Error(
      agentErrorMessage("rootCommand.policyActionMismatch", {
        policyAction: options.policy.Action,
        decisionAction: options.decision.action,
      }),
    );
  }

  const preferredTools = agentActionPreferredTools(options.decision);
  const toolSearchQueries = agentActionToolSearchQueries(options.decision);
  const instruction = agentActionInstruction(options.decision).trim();
  const allowedTools = resolveAllowedToolNames(options.policy.AllowedTools, {
    loadedTools: options.loadedTools,
    preferredTools,
  });

  return {
    authority: "senera_runtime_root",
    action: options.decision.action,
    outputMode: options.policy.OutputMode,
    toolAccess: options.policy.ToolAccess,
    objective: options.policy.Objective,
    instruction: instruction.length > 0 ? instruction : null,
    allowedTools,
    forbiddenOutputs: options.policy.ForbiddenOutputs,
    insufficiencyPolicy: options.policy.InsufficiencyPolicy,
    preferredTools,
    toolSearchQueries,
    needs: agentActionCapabilityNeeds(options.decision),
    includeToolCatalog: options.policy.IncludeToolCatalog,
    visibleOutput: projectVisibleOutput(options.policy.VisibleOutput),
  };
}

function projectVisibleOutput(
  value: RootCommandVisibleOutputManifest,
): AgentRootCommandVisibleOutput {
  return {
    audience: value.Audience,
    start: value.Start,
    format: value.Format,
    rules: value.Rules.map(projectVisibleOutputRule),
    repair: {
      instruction: value.Repair.Instruction,
      rules: value.Repair.Rules.map(projectVisibleOutputRule),
    },
  };
}

function projectVisibleOutputRule(
  value: RootCommandVisibleOutputRuleManifest,
): AgentRootCommandVisibleOutputRule {
  return {
    name: value.Name,
    value: value.Value,
    instruction: value.Instruction,
  };
}

function resolveAllowedToolNames(
  selectors: readonly RootCommandToolSelectorManifest[],
  scope: RootCommandToolScope,
): string[] {
  const names = selectors.flatMap((selector) => readSelectorToolNames(selector, scope));
  return [...new Set(names)];
}

function readSelectorToolNames(
  selector: RootCommandToolSelectorManifest,
  scope: RootCommandToolScope,
): string[] {
  switch (selector.Source) {
    case "None":
      return [];
    case "Loaded":
      return scope.loadedTools.map((tool) => tool.name);
    case "NamedLoaded": {
      const requested = new Set(selector.Names);
      return scope.loadedTools
        .filter((tool) => requested.has(tool.name))
        .map((tool) => tool.name);
    }
    case "HostCapability":
      return scope.loadedTools
        .filter((tool) =>
          tool.handler.kind === "HostCapability"
          && tool.handler.capability === selector.Capability
        )
        .map((tool) => tool.name);
    case "PreferredLoaded":
      return filterPreferredLoadedToolNames(scope);
    case "PreferredLoadedOrLoaded": {
      const preferred = filterPreferredLoadedToolNames(scope);
      return preferred.length > 0
        ? preferred
        : scope.loadedTools.map((tool) => tool.name);
    }
  }
}

function filterPreferredLoadedToolNames(scope: RootCommandToolScope): string[] {
  const loaded = new Set(scope.loadedTools.map((tool) => tool.name));
  return [
      ...new Set([
        ...scope.preferredTools,
      ]),
  ].filter((toolName) => loaded.has(toolName));
}

interface RootCommandToolScope {
  loadedTools: readonly Pick<RegisteredTool, "name" | "handler">[];
  preferredTools: readonly string[];
}
