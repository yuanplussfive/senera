import type { AgentActionPlanner } from "../ActionPlanner/AgentActionPlanner.js";
import type { AgentToolCallExecutor } from "../ToolRuntime/AgentToolCallExecutor.js";
import type { AgentPromptContextBuilder } from "../Prompt/AgentPromptContextBuilder.js";
import type { AgentPresetManager } from "../Presets/AgentPresetManager.js";
import type { AgentSkillActivationService } from "../Skills/AgentSkillActivation.js";
import type { AgentToolExecutionArtifactRecorder } from "../Artifacts/AgentToolExecutionArtifactRecorder.js";
import type { AgentToolCatalogProjector } from "../ToolRuntime/AgentToolCatalogProjector.js";
import type { AgentToolSearchRuntime } from "../ToolSearch/AgentToolSearchRuntime.js";
import type {
  AgentPiRuntimeService,
  AgentPiSubstrate,
} from "../Pi/AgentPiSubstrate.js";
import type { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";

export interface AgentPlanningService {
  understandTurn(options: Parameters<AgentActionPlanner["understandTurn"]>[0]): ReturnType<AgentActionPlanner["understandTurn"]>;
  routeWithInput(options: Parameters<AgentActionPlanner["routeWithInput"]>[0]): ReturnType<AgentActionPlanner["routeWithInput"]>;
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
  recommendedSkillTools(skills: Parameters<AgentSkillActivationService["recommendedToolNames"]>[0]): ReturnType<AgentSkillActivationService["recommendedToolNames"]>;
  buildBaseContext(options?: Parameters<AgentPromptContextBuilder["buildBaseContext"]>[0]): ReturnType<AgentPromptContextBuilder["buildBaseContext"]>;
  buildRootCommand(options: Parameters<AgentPromptContextBuilder["buildRootCommand"]>[0]): ReturnType<AgentPromptContextBuilder["buildRootCommand"]>;
  plannerRoleplayPreset(): ReturnType<AgentPresetManager["plannerContext"]>;
  promptRoleplayPreset(): ReturnType<AgentPresetManager["promptContext"]>;
  toolCatalog(): ReturnType<AgentToolCatalogProjector["list"]>;
}

export interface AgentExecutionService {
  executeToolCall(...args: Parameters<AgentToolCallExecutor["execute"]>): ReturnType<AgentToolCallExecutor["execute"]>;
  recordToolArtifacts(options: Parameters<AgentToolExecutionArtifactRecorder["record"]>[0]): ReturnType<AgentToolExecutionArtifactRecorder["record"]>;
}

export interface AgentRuntimeServices {
  execution: AgentExecutionService;
  pi: AgentPiRuntimeService;
  piSessions: AgentPiActiveSessionRegistry;
  planning: AgentPlanningService;
  retrieval: AgentRetrievalService;
  promptContext: AgentPromptContextService;
}

export interface AgentRuntimeServiceDependencies {
  actionPlanner: AgentActionPlanner;
  artifactRecorder: AgentToolExecutionArtifactRecorder;
  toolCallExecutor: AgentToolCallExecutor;
  piSessionRegistry: AgentPiActiveSessionRegistry;
  presetManager: AgentPresetManager;
  promptContextBuilder: AgentPromptContextBuilder;
  piSubstrate: AgentPiSubstrate;
  skillActivation: AgentSkillActivationService;
  toolCatalog: AgentToolCatalogProjector;
  toolSearch: AgentToolSearchRuntime;
}

export function createDefaultAgentRuntimeServices(
  dependencies: AgentRuntimeServiceDependencies,
): AgentRuntimeServices {
  return {
    execution: {
      executeToolCall: (...args) => dependencies.toolCallExecutor.execute(...args),
      recordToolArtifacts: (options) => dependencies.artifactRecorder.record(options),
    },
    pi: dependencies.piSubstrate,
    piSessions: dependencies.piSessionRegistry,
    planning: {
      understandTurn: (options) => dependencies.actionPlanner.understandTurn(options),
      routeWithInput: (options) => dependencies.actionPlanner.routeWithInput(options),
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
      recommendedSkillTools: (skills) => dependencies.skillActivation.recommendedToolNames(skills),
      buildBaseContext: (options) => dependencies.promptContextBuilder.buildBaseContext(options),
      buildRootCommand: (options) => dependencies.promptContextBuilder.buildRootCommand(options),
      plannerRoleplayPreset: () => dependencies.presetManager.plannerContext(),
      promptRoleplayPreset: () => dependencies.presetManager.promptContext(),
      toolCatalog: () => dependencies.toolCatalog.list(),
    },
  };
}
