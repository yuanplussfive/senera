import type { AgentToolCallExecutor } from "../ToolRuntime/AgentToolCallExecutor.js";
import type { AgentPromptContextBuilder } from "../Prompt/AgentPromptContextBuilder.js";
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
import type { AgentPersonaContext } from "../Prompt/AgentPersonaContext.js";
import type { AgentExplicitActivationReference } from "../Activation/AgentActivationTypes.js";

export interface AgentRetrievalService {
  createToolExposure: AgentToolSearchRuntime["createToolExposure"];
  resolveInitialLoadedTools(
    ...args: Parameters<AgentToolSearchRuntime["resolveInitialLoadedTools"]>
  ): ReturnType<AgentToolSearchRuntime["resolveInitialLoadedTools"]>;
  resolvePlannedLoadedTools(
    options: Parameters<AgentToolSearchRuntime["resolvePlannedLoadedTools"]>[0],
  ): ReturnType<AgentToolSearchRuntime["resolvePlannedLoadedTools"]>;
  finishRequest(
    ...args: Parameters<AgentToolSearchRuntime["finishRequest"]>
  ): ReturnType<AgentToolSearchRuntime["finishRequest"]>;
  afterToolResults(
    options: Parameters<AgentToolSearchRuntime["afterToolResults"]>[0],
  ): ReturnType<AgentToolSearchRuntime["afterToolResults"]>;
  resolveStateCard(
    options: Parameters<AgentToolSearchRuntime["resolveStateCard"]>[0],
  ): ReturnType<AgentToolSearchRuntime["resolveStateCard"]>;
  recordCompletedTurnScenario(
    observation: Parameters<AgentToolSearchRuntime["recordCompletedTurnScenario"]>[0],
  ): ReturnType<AgentToolSearchRuntime["recordCompletedTurnScenario"]>;
  reusableCapabilities?(
    options: Parameters<AgentToolSearchRuntime["reusableCapabilities"]>[0],
  ): ReturnType<AgentToolSearchRuntime["reusableCapabilities"]>;
  getReusableEvidence?(
    options: Parameters<AgentToolSearchRuntime["getReusableEvidence"]>[0],
  ): ReturnType<AgentToolSearchRuntime["getReusableEvidence"]>;
}

export interface AgentPromptContextService {
  activateSkills(
    options: Parameters<AgentSkillActivationService["activate"]>[0],
  ): ReturnType<AgentSkillActivationService["activate"]>;
  recommendedSkillToolRouting(
    skills: Parameters<AgentSkillActivationService["recommendedToolRouting"]>[0],
    explicitActivations?: readonly AgentExplicitActivationReference[],
  ): ReturnType<AgentSkillActivationService["recommendedToolRouting"]>;
  buildBaseContext(
    options?: Parameters<AgentPromptContextBuilder["buildBaseContext"]>[0],
  ): ReturnType<AgentPromptContextBuilder["buildBaseContext"]>;
  buildRootCommand(
    options: Parameters<AgentPromptContextBuilder["buildRootCommand"]>[0],
  ): ReturnType<AgentPromptContextBuilder["buildRootCommand"]>;
  promptPersona(): AgentPersonaContext;
  toolCatalog(): ReturnType<AgentToolCatalogProjector["list"]>;
  /** Current state plus the query-relevant memory delta for the active Pi turn. */
  liveContinuityMemory(input?: {
    sessionId?: string;
    userInput?: string;
    requestId?: string;
    signal?: AbortSignal;
    historicalTokenBudget?: import("../Continuity/AgentContinuityPromptBudget.js").AgentContinuityHistoricalTokenBudget;
  }): Promise<AgentContinuityMemoryPromptContext>;
  /** Records memory that was actually delivered after a successful Pi turn. */
  commitLiveContextDelivery?(input: {
    sessionId?: string;
    memory: AgentContinuityMemoryPromptContext;
    deliveredAt?: string;
  }): number;
  /** Clears delivery receipts after compaction, rewind, reset, or fork. */
  invalidateSessionContext?(sessionId: string): number;
  promptWorkflow(sessionId?: string): AgentWorkflowPromptContext;
  interactionToolNames?(
    interaction?: import("../Interaction/AgentInteractionContext.js").AgentInteractionContext,
  ): string[];
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
  personaProvider: () => AgentPersonaContext;
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
      createToolExposure: (grant) => dependencies.toolSearch.createToolExposure(grant),
      resolveInitialLoadedTools: (...args) => dependencies.toolSearch.resolveInitialLoadedTools(...args),
      resolvePlannedLoadedTools: (options) => dependencies.toolSearch.resolvePlannedLoadedTools(options),
      finishRequest: (...args) => dependencies.toolSearch.finishRequest(...args),
      afterToolResults: (options) => dependencies.toolSearch.afterToolResults(options),
      resolveStateCard: (options) => dependencies.toolSearch.resolveStateCard(options),
      recordCompletedTurnScenario: (observation) => dependencies.toolSearch.recordCompletedTurnScenario(observation),
      reusableCapabilities: (options) => dependencies.toolSearch.reusableCapabilities(options),
      getReusableEvidence: (options) => dependencies.toolSearch.getReusableEvidence(options),
    },
    promptContext: {
      activateSkills: (options) => dependencies.skillActivation.activate(options),
      recommendedSkillToolRouting: (skills, explicitActivations) =>
        dependencies.skillActivation.recommendedToolRouting(skills, explicitActivations),
      buildBaseContext: (options) => dependencies.promptContextBuilder.buildBaseContext(options),
      buildRootCommand: (options) => dependencies.promptContextBuilder.buildRootCommand(options),
      promptPersona: () => dependencies.personaProvider(),
      toolCatalog: () => dependencies.toolCatalog.list(),
      liveContinuityMemory: async (input) => {
        if (!dependencies.continuityMemory) return EmptyAgentContinuityMemoryPromptContext;
        return await dependencies.continuityMemory.liveContext(input);
      },
      commitLiveContextDelivery: (input) => dependencies.continuityMemory?.commitLiveContextDelivery(input) ?? 0,
      invalidateSessionContext: (sessionId) => dependencies.continuityMemory?.invalidateSessionContext(sessionId) ?? 0,
      promptWorkflow: (sessionId) => dependencies.workflow?.promptContext(sessionId) ?? EmptyAgentWorkflowPromptContext,
      interactionToolNames: (interaction) => dependencies.promptContextBuilder.interactionToolNames(interaction),
    },
    executionLedger: dependencies.executionLedger,
  };
}
