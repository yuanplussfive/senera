import {
  agentActionCapabilityNeeds,
  agentActionInstruction,
  agentActionPreferredTools,
  agentActionToolSearchQueries,
  type AgentActionCapabilityNeed,
  type AgentActionDecision,
} from "./ActionPlanner/AgentActionPlannerTypes.js";
import type { RegisteredTool } from "./Types/AgentToolRuntimeTypes.js";
import type {
  RootCommandManifest,
  RootCommandToolSelectorManifest,
  RootCommandVisibleOutputManifest,
  RootCommandVisibleOutputRuleManifest,
} from "./Types/AgentToolContractTypes.js";
import { AgentLocalizedError } from "./I18n/AgentLocalizedError.js";
import { createAgentToolAccessGrant, type AgentToolAccessGrant } from "./ToolRuntime/AgentToolAccessGrant.js";

export type AgentRootCommandToolAccess = RootCommandManifest["ToolAccess"];
export type AgentRootOutputMode = RootCommandManifest["OutputMode"];

export interface AgentRootCommand {
  authority: "senera_runtime_root";
  action: AgentActionDecision["action"];
  outputMode: AgentRootOutputMode;
  toolAccess: AgentRootCommandToolAccess;
  objective: string;
  instruction: string | null;
  toolAccessGrant: AgentToolAccessGrant;
  forbiddenOutputs: string[];
  insufficiencyPolicy: string;
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
  registeredTools: readonly Pick<RegisteredTool, "name" | "handler">[];
  policy: RootCommandManifest;
}): AgentRootCommand {
  if (options.policy.Action !== options.decision.action) {
    throw new AgentLocalizedError("rootCommand.policyActionMismatch", {
      policyAction: options.policy.Action,
      decisionAction: options.decision.action,
    });
  }

  const preferredTools = agentActionPreferredTools(options.decision);
  const toolSearchQueries = agentActionToolSearchQueries(options.decision);
  const instruction = agentActionInstruction(options.decision).trim();
  const authorizedToolNames = resolveAuthorizedToolNames(
    options.policy.AllowedTools,
    options.loadedTools,
    options.registeredTools,
  );
  const authorized = new Set(authorizedToolNames);
  const exposedToolNames = options.loadedTools.map((tool) => tool.name).filter((toolName) => authorized.has(toolName));
  const toolAccessGrant = createAgentToolAccessGrant({
    authorizedToolNames,
    exposedToolNames,
    preferredToolNames: preferredTools,
  });

  return {
    authority: "senera_runtime_root",
    action: options.decision.action,
    outputMode: options.policy.OutputMode,
    toolAccess: options.policy.ToolAccess,
    objective: options.policy.Objective,
    instruction: instruction.length > 0 ? instruction : null,
    toolAccessGrant,
    forbiddenOutputs: options.policy.ForbiddenOutputs,
    insufficiencyPolicy: options.policy.InsufficiencyPolicy,
    toolSearchQueries,
    needs: agentActionCapabilityNeeds(options.decision),
    includeToolCatalog: options.policy.IncludeToolCatalog,
    visibleOutput: projectVisibleOutput(options.policy.VisibleOutput),
  };
}

function projectVisibleOutput(value: RootCommandVisibleOutputManifest): AgentRootCommandVisibleOutput {
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

function projectVisibleOutputRule(value: RootCommandVisibleOutputRuleManifest): AgentRootCommandVisibleOutputRule {
  return {
    name: value.Name,
    value: value.Value,
    instruction: value.Instruction,
  };
}

function resolveAuthorizedToolNames(
  selectors: readonly RootCommandToolSelectorManifest[],
  loadedTools: readonly Pick<RegisteredTool, "name" | "handler">[],
  registeredTools: readonly Pick<RegisteredTool, "name" | "handler">[],
): string[] {
  const names = selectors.flatMap((selector) => readSelectorToolNames(selector, loadedTools, registeredTools));
  return [...new Set(names)];
}

function readSelectorToolNames(
  selector: RootCommandToolSelectorManifest,
  loadedTools: readonly Pick<RegisteredTool, "name" | "handler">[],
  registeredTools: readonly Pick<RegisteredTool, "name" | "handler">[],
): string[] {
  switch (selector.Source) {
    case "None":
      return [];
    case "Loaded":
      return loadedTools.map((tool) => tool.name);
    case "Registered":
      return registeredTools.map((tool) => tool.name);
    case "NamedLoaded": {
      const requested = new Set(selector.Names);
      return loadedTools.filter((tool) => requested.has(tool.name)).map((tool) => tool.name);
    }
    case "HostCapability":
      return registeredTools
        .filter((tool) => tool.handler.kind === "HostCapability" && tool.handler.capability === selector.Capability)
        .map((tool) => tool.name);
  }
}
