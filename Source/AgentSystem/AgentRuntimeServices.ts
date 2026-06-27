import type { AgentActionPlanner } from "./AgentActionPlanner.js";
import type { AgentDecisionExecutor } from "./AgentDecisionExecutor.js";
import type { AgentPromptContextBuilder } from "./AgentPromptContextBuilder.js";
import type { AgentPluginRegistry } from "./AgentPluginRegistry.js";
import type { AgentPresetManager } from "./Presets/AgentPresetManager.js";
import type { AgentSkillActivationService } from "./AgentSkillActivation.js";
import type { AgentToolExecutionArtifactRecorder } from "./Artifacts/AgentToolExecutionArtifactRecorder.js";
import type { AgentToolCatalogProjector } from "./AgentToolCatalogProjector.js";
import type { AgentToolSearchRuntime } from "./AgentToolSearchRuntime.js";
import {
  AgentWorkflowSelector,
  type AgentWorkflowSelectionResult,
} from "./AgentWorkflowSelector.js";

export interface AgentPlanningService {
  plan(options: Parameters<AgentActionPlanner["plan"]>[0]): ReturnType<AgentActionPlanner["plan"]>;
  routeWithInput(options: Parameters<AgentActionPlanner["routeWithInput"]>[0]): ReturnType<AgentActionPlanner["routeWithInput"]>;
  planToolCallOutcome(options: Parameters<AgentActionPlanner["planToolCallOutcome"]>[0]): ReturnType<AgentActionPlanner["planToolCallOutcome"]>;
}

export interface AgentRetrievalService {
  resolveInitialLoadedTools(...args: Parameters<AgentToolSearchRuntime["resolveInitialLoadedTools"]>): ReturnType<AgentToolSearchRuntime["resolveInitialLoadedTools"]>;
  resolvePlannedLoadedTools(options: Parameters<AgentToolSearchRuntime["resolvePlannedLoadedTools"]>[0]): ReturnType<AgentToolSearchRuntime["resolvePlannedLoadedTools"]>;
  rememberAutoSearch(...args: Parameters<AgentToolSearchRuntime["rememberAutoSearch"]>): ReturnType<AgentToolSearchRuntime["rememberAutoSearch"]>;
  afterToolResults(options: Parameters<AgentToolSearchRuntime["afterToolResults"]>[0]): ReturnType<AgentToolSearchRuntime["afterToolResults"]>;
  toolUsePatterns(options: Parameters<AgentToolSearchRuntime["toolUsePatterns"]>[0]): ReturnType<AgentToolSearchRuntime["toolUsePatterns"]>;
}

export interface AgentPromptContextService {
  activateSkills(options: Parameters<AgentSkillActivationService["activate"]>[0]): ReturnType<AgentSkillActivationService["activate"]>;
  buildBaseContext(options?: Parameters<AgentPromptContextBuilder["buildBaseContext"]>[0]): ReturnType<AgentPromptContextBuilder["buildBaseContext"]>;
  buildRootCommand(options: Parameters<AgentPromptContextBuilder["buildRootCommand"]>[0]): ReturnType<AgentPromptContextBuilder["buildRootCommand"]>;
  plannerRoleplayPreset(): ReturnType<AgentPresetManager["plannerContext"]>;
  promptRoleplayPreset(): ReturnType<AgentPresetManager["promptContext"]>;
  toolCatalog(): ReturnType<AgentToolCatalogProjector["list"]>;
}

export interface AgentWorkflowService {
  select(options: Parameters<AgentWorkflowSelector["select"]>[0]): AgentWorkflowSelectionResult[];
}

export interface AgentExecutionService {
  executeDecision(...args: Parameters<AgentDecisionExecutor["execute"]>): ReturnType<AgentDecisionExecutor["execute"]>;
  recordToolArtifacts(options: Parameters<AgentToolExecutionArtifactRecorder["record"]>[0]): ReturnType<AgentToolExecutionArtifactRecorder["record"]>;
}

export interface AgentRuntimeServices {
  execution: AgentExecutionService;
  planning: AgentPlanningService;
  retrieval: AgentRetrievalService;
  promptContext: AgentPromptContextService;
  workflow: AgentWorkflowService;
}

export interface AgentRuntimeServiceDependencies {
  actionPlanner: AgentActionPlanner;
  artifactRecorder: AgentToolExecutionArtifactRecorder;
  decisionExecutor: AgentDecisionExecutor;
  presetManager: AgentPresetManager;
  promptContextBuilder: AgentPromptContextBuilder;
  registry: AgentPluginRegistry;
  skillActivation: AgentSkillActivationService;
  toolCatalog: AgentToolCatalogProjector;
  toolSearch: AgentToolSearchRuntime;
}

export function createDefaultAgentRuntimeServices(
  dependencies: AgentRuntimeServiceDependencies,
): AgentRuntimeServices {
  const workflowSelector = new AgentWorkflowSelector(dependencies.registry);

  return {
    execution: {
      executeDecision: (...args) => dependencies.decisionExecutor.execute(...args),
      recordToolArtifacts: (options) => dependencies.artifactRecorder.record(options),
    },
    planning: {
      plan: (options) => dependencies.actionPlanner.plan(options),
      routeWithInput: (options) => dependencies.actionPlanner.routeWithInput(options),
      planToolCallOutcome: (options) => dependencies.actionPlanner.planToolCallOutcome(options),
    },
    retrieval: {
      resolveInitialLoadedTools: (...args) => dependencies.toolSearch.resolveInitialLoadedTools(...args),
      resolvePlannedLoadedTools: (options) => dependencies.toolSearch.resolvePlannedLoadedTools(options),
      rememberAutoSearch: (...args) => dependencies.toolSearch.rememberAutoSearch(...args),
      afterToolResults: (options) => dependencies.toolSearch.afterToolResults(options),
      toolUsePatterns: (options) => dependencies.toolSearch.toolUsePatterns(options),
    },
    promptContext: {
      activateSkills: (options) => dependencies.skillActivation.activate(options),
      buildBaseContext: (options) => dependencies.promptContextBuilder.buildBaseContext(options),
      buildRootCommand: (options) => dependencies.promptContextBuilder.buildRootCommand(options),
      plannerRoleplayPreset: () => dependencies.presetManager.plannerContext(),
      promptRoleplayPreset: () => dependencies.presetManager.promptContext(),
      toolCatalog: () => dependencies.toolCatalog.list(),
    },
    workflow: {
      select: (options) => workflowSelector.select(options),
    },
  };
}
