import {
  agentActionCapabilityNeeds,
  agentActionInstruction,
  agentActionPreferredTools,
  agentActionToolSearchQueries,
  type AgentActionCapabilityNeed,
  type AgentActionDecision,
} from "./ActionPlanner/AgentActionPlanner.js";
import type { TaskFrame } from "./BamlClient/baml_client/types.js";
import type { AgentDecisionOutputContract } from "./Decision/AgentDecisionOutputResolver.js";
import type { RegisteredTool } from "./Types/PluginRuntimeTypes.js";
import type {
  RootCommandManifest,
  RootCommandToolSelectorManifest,
  RootCommandVisibleOutputManifest,
  RootCommandVisibleOutputRuleManifest,
} from "./Types/PluginManifestTypes.js";

export type AgentRootCommandToolAccess = RootCommandManifest["ToolAccess"];

export interface AgentRootCommand {
  authority: "senera_runtime_root";
  action: AgentActionDecision["action"];
  outputMode: AgentDecisionOutputContract;
  toolAccess: AgentRootCommandToolAccess;
  objective: string;
  instruction: string | null;
  allowedTools: string[];
  forbiddenOutputs: string[];
  insufficiencyPolicy: string;
  preferredTools: string[];
  workflowRecommendedTools: string[];
  workflowRecommendations: AgentRootCommandWorkflowRecommendation[];
  toolSearchQueries: string[];
  needs: AgentActionCapabilityNeed[];
  taskContract: AgentRootTaskContract | null;
  includeDecisionProtocol: boolean;
  includeToolCatalog: boolean;
  visibleOutput: AgentRootCommandVisibleOutput;
}

export interface AgentRootTaskContract {
  taskType: string;
  answerGoal: string;
  intentTags: string[];
  taskTags: string[];
  targetRefs: Array<{
    kind: string;
    value: string;
    status: string;
  }>;
  candidateTools: Array<{
    name: string;
    purpose: string;
    supports: string[];
  }>;
  discoveryQueries: string[];
  requiredEffects: Array<{
    id: string;
    effect: string;
    target: string;
    proof: string;
    reason: string;
  }>;
  requiredEvidence: Array<{
    id: string;
    need: string;
    scope: string;
    minimum: number;
    reason: string;
  }>;
  nextStepPurpose: string;
  completionCriteria: string[];
}

export interface AgentRootCommandWorkflowRecommendation {
  name: string;
  title?: string;
  description?: string;
  sources: string[];
  matchedSkills: string[];
  matchedAgents: string[];
  matchedTerms: string[];
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
  taskContract?: TaskFrame;
  workflowRecommendedTools?: readonly string[];
  workflowRecommendations?: readonly AgentRootCommandWorkflowRecommendation[];
}): AgentRootCommand {
  if (options.policy.Action !== options.decision.action) {
    throw new Error(
      `RootCommand policy 与行动不匹配：${options.policy.Action} != ${options.decision.action}`,
    );
  }

  const preferredTools = agentActionPreferredTools(options.decision);
  const workflowRecommendedTools = [...new Set(options.workflowRecommendedTools ?? [])];
  const workflowRecommendations = [...(options.workflowRecommendations ?? [])];
  const toolSearchQueries = agentActionToolSearchQueries(options.decision);
  const instruction = agentActionInstruction(options.decision).trim();
  const allowedTools = resolveAllowedToolNames(options.policy.AllowedTools, {
    loadedTools: options.loadedTools,
    preferredTools,
    workflowRecommendedTools,
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
    workflowRecommendedTools,
    workflowRecommendations,
    toolSearchQueries,
    needs: agentActionCapabilityNeeds(options.decision),
    taskContract: options.taskContract ? projectTaskContract(options.taskContract) : null,
    includeDecisionProtocol: options.policy.IncludeDecisionProtocol,
    includeToolCatalog: options.policy.IncludeToolCatalog,
    visibleOutput: projectVisibleOutput(options.policy.VisibleOutput),
  };
}

function projectTaskContract(taskFrame: TaskFrame): AgentRootTaskContract {
  return {
    taskType: taskFrame.taskType,
    answerGoal: taskFrame.answerGoal,
    intentTags: taskFrame.intentTags,
    taskTags: taskFrame.taskTags,
    targetRefs: taskFrame.targetRefs.map((target) => ({
      kind: target.kind,
      value: target.value,
      status: target.status,
    })),
    candidateTools: taskFrame.candidateTools.map((tool) => ({
      name: tool.name,
      purpose: tool.purpose,
      supports: tool.supports,
    })),
    discoveryQueries: taskFrame.discoveryQueries,
    requiredEffects: taskFrame.requiredEffects.map((effect) => ({
      id: effect.id,
      effect: effect.effect,
      target: effect.target,
      proof: effect.proof,
      reason: effect.reason,
    })),
    requiredEvidence: taskFrame.requiredEvidence.map((need) => ({
      id: need.id,
      need: need.need,
      scope: need.scope,
      minimum: need.minimum,
      reason: need.reason,
    })),
    nextStepPurpose: taskFrame.nextStepPurpose,
    completionCriteria: taskFrame.completionCriteria,
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
      ...scope.workflowRecommendedTools,
    ]),
  ].filter((toolName) => loaded.has(toolName));
}

interface RootCommandToolScope {
  loadedTools: readonly Pick<RegisteredTool, "name" | "handler">[];
  preferredTools: readonly string[];
  workflowRecommendedTools: readonly string[];
}
