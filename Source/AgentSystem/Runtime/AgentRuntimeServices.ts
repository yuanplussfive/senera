import type { AgentToolCallExecutor } from "../ToolRuntime/AgentToolCallExecutor.js";
import type { AgentPromptContextBuilder } from "../Prompt/AgentPromptContextBuilder.js";
import type { AgentPresetManager } from "../Presets/AgentPresetManager.js";
import type { AgentSkillActivationService } from "../Skills/AgentSkillActivation.js";
import type { AgentToolExecutionArtifactRecorder } from "../Artifacts/AgentToolExecutionArtifactRecorder.js";
import type { AgentToolCatalogProjector } from "../ToolRuntime/AgentToolCatalogProjector.js";
import type { AgentToolSearchRuntime } from "../ToolSearch/AgentToolSearchRuntime.js";
import type { AgentPiSubstrate } from "../Pi/AgentPiSubstrate.js";
import type { AgentPiRuntimeService } from "../Pi/AgentPiRuntimeTypes.js";
import type { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";
import {
  EmptyAgentContinuityMemoryPromptContext,
  type AgentContinuityMemoryPromptContext,
} from "../Continuity/AgentContinuityMemoryTypes.js";
import type { AgentContinuityMemoryService } from "../Continuity/AgentContinuityMemoryService.js";
import type { AgentExecutionLedgerService } from "../Goals/AgentExecutionLedgerService.js";
import {
  EmptyAgentWorkflowPromptContext,
  type AgentWorkflowPromptContext,
} from "../Prompt/AgentWorkflowPromptContext.js";
import type { AgentWorkflowPromptProjector } from "../Prompt/AgentWorkflowPromptProjector.js";

export interface AgentRetrievalService {
  resolveInitialLoadedTools(
    ...args: Parameters<AgentToolSearchRuntime["resolveInitialLoadedTools"]>
  ): ReturnType<AgentToolSearchRuntime["resolveInitialLoadedTools"]>;
  resolvePlannedLoadedTools(
    options: Parameters<AgentToolSearchRuntime["resolvePlannedLoadedTools"]>[0],
  ): ReturnType<AgentToolSearchRuntime["resolvePlannedLoadedTools"]>;
  rememberAutoSearch(
    ...args: Parameters<AgentToolSearchRuntime["rememberAutoSearch"]>
  ): ReturnType<AgentToolSearchRuntime["rememberAutoSearch"]>;
  finishRequest(
    ...args: Parameters<AgentToolSearchRuntime["finishRequest"]>
  ): ReturnType<AgentToolSearchRuntime["finishRequest"]>;
  afterToolResults(
    options: Parameters<AgentToolSearchRuntime["afterToolResults"]>[0],
  ): ReturnType<AgentToolSearchRuntime["afterToolResults"]>;
  toolUsePatterns(
    options: Parameters<AgentToolSearchRuntime["toolUsePatterns"]>[0],
  ): ReturnType<AgentToolSearchRuntime["toolUsePatterns"]>;
}

export interface AgentPromptContextService {
  activateSkills(
    options: Parameters<AgentSkillActivationService["activate"]>[0],
  ): ReturnType<AgentSkillActivationService["activate"]>;
  recommendedSkillTools(
    skills: Parameters<AgentSkillActivationService["recommendedToolNames"]>[0],
  ): ReturnType<AgentSkillActivationService["recommendedToolNames"]>;
  buildBaseContext(
    options?: Parameters<AgentPromptContextBuilder["buildBaseContext"]>[0],
  ): ReturnType<AgentPromptContextBuilder["buildBaseContext"]>;
  buildRootCommand(
    options: Parameters<AgentPromptContextBuilder["buildRootCommand"]>[0],
  ): ReturnType<AgentPromptContextBuilder["buildRootCommand"]>;
  promptRoleplayPreset(userInput?: string): ReturnType<AgentPresetManager["promptContext"]>;
  toolCatalog(): ReturnType<AgentToolCatalogProjector["list"]>;
  promptContinuityMemory(input: {
    userInput: string;
    sessionId?: string;
    requestId?: string;
  }): Promise<AgentContinuityMemoryPromptContext>;
  promptWorkflow(sessionId?: string): AgentWorkflowPromptContext;
}

export interface AgentExecutionService {
  executeToolCall(...args: Parameters<AgentToolCallExecutor["execute"]>): ReturnType<AgentToolCallExecutor["execute"]>;
  recordToolArtifacts(
    options: Parameters<AgentToolExecutionArtifactRecorder["record"]>[0],
  ): ReturnType<AgentToolExecutionArtifactRecorder["record"]>;
}

export interface AgentRuntimeServices {
  execution: AgentExecutionService;
  pi: AgentPiRuntimeService;
  piSessions: AgentPiActiveSessionRegistry;
  retrieval: AgentRetrievalService;
  promptContext: AgentPromptContextService;
  executionLedger?: AgentExecutionLedgerService;
}

export interface AgentRuntimeServiceDependencies {
  artifactRecorder: AgentToolExecutionArtifactRecorder;
  toolCallExecutor: AgentToolCallExecutor;
  piSessionRegistry: AgentPiActiveSessionRegistry;
  presetManager: AgentPresetManager;
  promptContextBuilder: AgentPromptContextBuilder;
  piSubstrate: AgentPiSubstrate;
  skillActivation: AgentSkillActivationService;
  toolCatalog: AgentToolCatalogProjector;
  toolSearch: AgentToolSearchRuntime;
  continuityMemory?: AgentContinuityMemoryService;
  workflow?: AgentWorkflowPromptProjector;
  executionLedger?: AgentExecutionLedgerService;
}

export function createDefaultAgentRuntimeServices(dependencies: AgentRuntimeServiceDependencies): AgentRuntimeServices {
  return {
    execution: {
      executeToolCall: (...args) => dependencies.toolCallExecutor.execute(...args),
      recordToolArtifacts: (options) => dependencies.artifactRecorder.record(options),
    },
    pi: dependencies.piSubstrate,
    piSessions: dependencies.piSessionRegistry,
    retrieval: {
      resolveInitialLoadedTools: (...args) => dependencies.toolSearch.resolveInitialLoadedTools(...args),
      resolvePlannedLoadedTools: (options) => dependencies.toolSearch.resolvePlannedLoadedTools(options),
      rememberAutoSearch: (...args) => dependencies.toolSearch.rememberAutoSearch(...args),
      finishRequest: (...args) => dependencies.toolSearch.finishRequest(...args),
      afterToolResults: (options) => dependencies.toolSearch.afterToolResults(options),
      toolUsePatterns: (options) => dependencies.toolSearch.toolUsePatterns(options),
    },
    promptContext: {
      activateSkills: (options) => dependencies.skillActivation.activate(options),
      recommendedSkillTools: (skills) => dependencies.skillActivation.recommendedToolNames(skills),
      buildBaseContext: (options) => dependencies.promptContextBuilder.buildBaseContext(options),
      buildRootCommand: (options) => dependencies.promptContextBuilder.buildRootCommand(options),
      promptRoleplayPreset: (userInput) => dependencies.presetManager.promptContext(userInput),
      toolCatalog: () => dependencies.toolCatalog.list(),
      promptContinuityMemory: (input) =>
        dependencies.continuityMemory?.promptContext(input) ?? Promise.resolve(EmptyAgentContinuityMemoryPromptContext),
      promptWorkflow: (sessionId) => dependencies.workflow?.promptContext(sessionId) ?? EmptyAgentWorkflowPromptContext,
    },
    executionLedger: dependencies.executionLedger,
  };
}
