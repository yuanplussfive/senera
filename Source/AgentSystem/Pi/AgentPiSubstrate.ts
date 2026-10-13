import path from "node:path";
import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type { AgentToolExecutionArtifactRecorder } from "../Artifacts/AgentToolExecutionArtifactRecorder.js";
import type { AgentToolPermissionGate } from "../Safety/AgentToolPermissionGate.js";
import type { AgentToolCallExecutor } from "../ToolRuntime/AgentToolCallExecutor.js";
import { AgentPiToolExecutionBridge } from "./AgentPiToolExecutionBridge.js";
import { AgentPiToolRegistryProjector } from "./AgentPiToolRegistryProjector.js";
import { AgentPiToolPermissionHook } from "./AgentPiToolPermissionHook.js";
import { projectSeneraModelProviderToPi } from "./AgentPiModelProjector.js";
import { resolveAgentNativeToolRoute } from "../ModelEndpoints/AgentModelEndpointContract.js";
import { clampAgentModelThinkingLevel, resolveAgentModelThinking } from "../ModelEndpoints/AgentModelThinking.js";
import { AgentPiPromptTemplateProjector } from "./AgentPiPromptTemplateProjector.js";
import { projectSelectedPromptTemplateFrame } from "./AgentPiPromptFrameProjector.js";
import { AgentPiDiagnosticSources, emitAgentPiDiagnostic, type AgentPiDiagnosticSink } from "./AgentPiDiagnostics.js";
import {
  resolveAgentLoopConfig,
  resolveAgentPromptConfig,
  resolveArtifactsConfig,
  resolveToolExecutionConfig,
} from "../AgentDefaults.js";
import type {
  AgentPiModelProjection,
  AgentPiProviderProjection,
  AgentPiToolDefinition,
  AgentPiToolProjectionContext,
} from "./AgentPiTypes.js";
import { projectAgentPiSkillCatalog } from "./AgentPiSkillCatalog.js";
import { projectAgentSkillLibraryCatalog } from "../Skills/AgentSkillLibraryCatalog.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import { AgentPiContextPolicy } from "./AgentPiContextPolicy.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { createAgentDefaultToolResourceCapabilities } from "../ToolRuntime/AgentToolResourceCapabilities.js";
import type { AgentToolResourceCapabilityRegistry } from "../ToolRuntime/AgentToolResourceCapabilityRegistry.js";
import {
  AgentToolResourceClaimProjector,
  type AgentToolResourceClaimProjectorPort,
} from "../ToolRuntime/AgentToolResourceClaimProjector.js";
import { AgentToolExecutionScheduler } from "../ToolRuntime/AgentToolExecutionScheduler.js";
import type { AgentToolResourceLeaseCoordinator } from "../ToolRuntime/AgentToolResourceScheduler.js";
import { AgentTurnTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { AgentToolExposureState } from "../ToolRuntime/AgentToolExposureState.js";
import { resolveAgentToolGrantNames } from "../ToolRuntime/AgentToolAccessGrant.js";
import { projectAgentToolEventOrigin } from "../ToolRuntime/AgentToolEventOrigin.js";
import { AgentPiCodingAgentSessionPool } from "./AgentPiCodingAgentSessionPool.js";
import { resolveAgentPiSessionSystemPrompt } from "./AgentPiSessionSystemPrompt.js";
import { createAgentPiLogicalCacheScope } from "./AgentPiPromptCache.js";
import type {
  AgentPiSessionCompactionResult,
  AgentPiSessionExportFormat,
  AgentPiSessionExportResult,
  AgentPiSessionRuntimeStatus,
} from "./AgentPiSessionManagement.js";
import type { AgentPiRuntimeService, AgentPiSessionOptions, AgentPiSessionResult } from "./AgentPiRuntimeTypes.js";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import type { AgentResourceResolverLike } from "../Resources/AgentResourceResolver.js";
import type { AgentPiPlanningCompilerFactory } from "./AgentPiPlanningCompiler.js";
import { projectSeneraProcessBackendsToToolTargets } from "../ToolRuntime/AgentToolExecutionPlan.js";
import type { AgentResidentSpeechSessionRuntime } from "../ResidentSpeech/AgentResidentSpeechTypes.js";
import { AgentToolResultObservationCompressor } from "../ToolRuntime/AgentToolResultObservationCompressor.js";
import { AgentPiToolObservationSummaryClient } from "./AgentPiToolObservationSummaryClient.js";
import { AgentArtifactCompactViewStore } from "../Artifacts/AgentArtifactCompactViewStore.js";
import type { AgentWorkspaceChangeObserverPort } from "../Artifacts/AgentWorkspaceChangeObserver.js";
import { resolveAgentPiCompactionSettings } from "./AgentPiCompactionSettings.js";
import type { AgentBackgroundLearningRequestLedger } from "../Memory/AgentBackgroundLearningRequestLedger.js";

export type {
  AgentPiRuntimeService,
  AgentPiSession,
  AgentPiSessionEventListener,
  AgentPiSessionOptions,
  AgentPiSessionResult,
} from "./AgentPiRuntimeTypes.js";

export type {
  AgentPiSessionCompactionResult,
  AgentPiSessionExportFormat,
  AgentPiSessionExportResult,
  AgentPiSessionRuntimeStatus,
} from "./AgentPiSessionManagement.js";

export interface AgentPiSubstrateOptions {
  workspaceLayout?: import("../Core/AgentWorkspaceLayout.js").AgentWorkspaceLayout;
  workspaceRoot: string;
  config: AgentSystemConfig;
  modelProvider: ResolvedAgentModelProviderConfig;
  planningCompilerFactory: AgentPiPlanningCompilerFactory;
  residentSpeech?: AgentResidentSpeechSessionRuntime;
  registry: AgentExtensionRegistry;
  toolCallExecutor: AgentPiToolCallExecutorPort;
  workspaceChangeObserver?: AgentWorkspaceChangeObserverPort;
  artifactRecorder: AgentPiArtifactRecorderPort;
  executionEnv: SeneraExecutionEnv;
  resourcesPath?: string;
  toolPermissionGate?: AgentToolPermissionGate;
  sessionPool?: AgentPiCodingAgentSessionPool;
  diagnostics?: AgentPiDiagnosticSink;
  uploadStore?: AgentUploadStore;
  resourceResolver?: AgentResourceResolverLike;
  /** Shared with delegated child runs so tool claims cross session boundaries. */
  resourceClaims?: AgentToolResourceClaimProjectorPort;
  resourceCapabilities?: AgentToolResourceCapabilityRegistry;
  resourceCoordinator?: AgentToolResourceLeaseCoordinator;
  beforeCompaction?: (sessionId: string) => Promise<void>;
  afterCompaction?: (sessionId: string) => Promise<void> | void;
  /** Clears request-local memory delivery receipts after a branch boundary. */
  onSessionContextInvalidated?: (sessionId: string) => Promise<void> | void;
  /** Shared durable ledger for detached model work such as observation compression. */
  learningRequests?: AgentBackgroundLearningRequestLedger;
}

export interface AgentPiToolCallExecutorPort {
  execute: AgentToolCallExecutor["execute"];
  projectToolInvocationSchema?: AgentToolCallExecutor["projectToolInvocationSchema"];
  projectToolDescription?: AgentToolCallExecutor["projectToolDescription"];
}

export interface AgentPiArtifactRecorderPort {
  record: AgentToolExecutionArtifactRecorder["record"];
}

export class AgentPiSubstrate implements AgentPiRuntimeService {
  readonly workspaceChangeObserver?: AgentWorkspaceChangeObserverPort;
  private readonly provider: AgentPiProviderProjection;
  private readonly thinkingProjection: ReturnType<typeof resolveAgentModelThinking>;
  private readonly toolProjector: AgentPiToolRegistryProjector;
  private readonly permissionHook: AgentPiToolPermissionHook;
  private readonly promptTemplateProjector: AgentPiPromptTemplateProjector;
  private readonly sessionPool: AgentPiCodingAgentSessionPool;
  private readonly contextPolicy: AgentPiContextPolicy;
  private readonly maxConcurrentToolPreflights: number;
  private readonly compactionSettings: ReturnType<typeof resolveAgentPiCompactionSettings>;
  private readonly observationCompressor: AgentToolResultObservationCompressor;

  constructor(private readonly options: AgentPiSubstrateOptions) {
    this.workspaceChangeObserver = options.workspaceChangeObserver;
    const piSessionsConfig = resolveAgentLoopConfig(options.config).PiSessions;
    this.provider = projectSeneraModelProviderToPi(options.modelProvider);
    this.compactionSettings = resolveAgentPiCompactionSettings(piSessionsConfig.Compaction, this.provider.model);
    const artifactConfig = resolveArtifactsConfig(options.config);
    const observationSummaryClient = new AgentPiToolObservationSummaryClient(
      options.modelProvider,
      this.compactionSettings,
      options.learningRequests,
    );
    const compactViewStore = new AgentArtifactCompactViewStore(options.workspaceRoot);
    this.observationCompressor = new AgentToolResultObservationCompressor({
      model: this.provider.model.id,
      stashDir: (options.workspaceLayout ?? resolveAgentWorkspaceLayout(options.workspaceRoot)).caches
        .toolObservationSift,
      summarize: observationSummaryClient.summarize.bind(observationSummaryClient),
      persistLlmSummary: compactViewStore.write.bind(compactViewStore),
    });
    this.thinkingProjection = resolveAgentModelThinking({
      api: resolveAgentNativeToolRoute(options.modelProvider.Endpoint, options.modelProvider.BaseUrl).api,
      provider: options.modelProvider.ProviderId,
      model: options.modelProvider.Model,
      capabilities: options.modelProvider.Capabilities,
      declaredCapabilities: options.modelProvider.DeclaredCapabilities,
      thinkingProfiles: options.modelProvider.ThinkingProfiles,
      defaultThinkingLevel: options.modelProvider.DefaultThinkingLevel,
    });
    this.contextPolicy = new AgentPiContextPolicy(options.modelProvider.Model);
    this.promptTemplateProjector = new AgentPiPromptTemplateProjector(options.registry);
    const systemResourcesRoot = path.resolve(options.resourcesPath ?? options.workspaceRoot);
    this.sessionPool =
      options.sessionPool ??
      new AgentPiCodingAgentSessionPool({
        workspaceLayout: options.workspaceLayout,
        workspaceRoot: options.workspaceRoot,
        sessionsRoot: piSessionsConfig.RootDir,
        systemPromptPath: resolveAgentPiSessionSystemPrompt(systemResourcesRoot),
        provider: this.provider,
        modelProvider: options.modelProvider,
        planningCompilerFactory: options.planningCompilerFactory,
        residentSpeech: options.residentSpeech,
        maxIdleSessions: piSessionsConfig.MaxCachedSessions,
        compaction: piSessionsConfig.Compaction,
        diagnostics: options.diagnostics,
        beforeCompaction: options.beforeCompaction,
        afterCompaction: options.afterCompaction,
        observationCompressor: this.observationCompressor,
        observationTokenBudget: artifactConfig.ToolObservationMaxTokens,
      });
    const resourceCapabilities =
      options.resourceCapabilities ??
      createAgentDefaultToolResourceCapabilities({
        config: options.config,
        workspaceRoot: options.workspaceRoot,
        executionEnv: options.executionEnv,
        uploadStore: options.uploadStore,
      });
    this.permissionHook = new AgentPiToolPermissionHook({
      registry: options.registry,
      toolPlanningMode: this.provider.toolPlanningMode,
      permissionGate: options.toolPermissionGate,
      executionCapabilities: () => options.executionEnv.capabilities,
      resourceCapabilities,
    });
    const resourceClaims = options.resourceClaims ?? new AgentToolResourceClaimProjector(resourceCapabilities);
    const toolExecution = resolveToolExecutionConfig(options.config);
    this.maxConcurrentToolPreflights = toolExecution.MaxConcurrentCallsPerRun;
    this.toolProjector = new AgentPiToolRegistryProjector({
      config: options.config,
      registry: options.registry,
      toolPlanningMode: this.provider.toolPlanningMode,
      execution: new AgentPiToolExecutionBridge({
        model: this.provider.model.id,
        observationTokenBudget: artifactConfig.ToolObservationMaxTokens,
        observationCompressor: this.observationCompressor,
        modelSupportsImages: this.provider.model.input.includes("image"),
        executeToolCall: options.toolCallExecutor.execute.bind(options.toolCallExecutor),
        recordToolArtifacts: options.artifactRecorder.record.bind(options.artifactRecorder),
        resourceResolver: options.resourceResolver,
        attributionEnabled: () => resolveAgentPromptConfig(options.config).BamlToolAttribution,
        executionScheduler: new AgentToolExecutionScheduler({
          maxConcurrentCallsPerRun: toolExecution.MaxConcurrentCallsPerRun,
          resourceClaims,
          resourceCoordinator: options.resourceCoordinator,
        }),
      }),
      runtimeContracts: {
        projectToolInvocationSchema: (tool, schema) =>
          options.toolCallExecutor.projectToolInvocationSchema?.call(options.toolCallExecutor, tool, schema) ??
          (schema as Record<string, unknown>),
        projectToolDescription: (tool, description) =>
          options.toolCallExecutor.projectToolDescription?.call(options.toolCallExecutor, tool, description) ??
          description,
      },
      availableExecutionTargets: () =>
        projectSeneraProcessBackendsToToolTargets(options.executionEnv.capabilities.processBackends),
    });
  }

  model(): AgentPiModelProjection {
    return { ...this.provider.model };
  }

  toolWorkspaceWritableLookup(toolName: string): boolean {
    return this.options.registry.getTool(toolName)?.execution.Workspace === "ReadWrite";
  }

  toolDefinitions(context: AgentPiToolProjectionContext = {}): AgentPiToolDefinition[] {
    return this.toolProjector.project(context);
  }

  activeToolNames(context: AgentPiToolProjectionContext = {}): string[] {
    const visibleToolNames =
      this.provider.toolPlanningMode === "native"
        ? context.toolAccessGrant
          ? resolveAgentToolGrantNames(context.toolAccessGrant, this.options.registry.listTools())
          : undefined
        : context.toolAccessGrant?.exposedToolNames;
    return this.toolProjector
      .createToolSet(
        visibleToolNames ?? context.visibleToolNames,
        context.toolAccessGrant?.preferredToolNames,
        context.interaction,
        context.nativeToolNames,
      )
      .activeToolNames.slice();
  }

  async leaseTurn(options: AgentPiSessionOptions): Promise<AgentPiSessionResult> {
    throwIfAborted(options.signal);
    const leaseStartedAt = performance.now();
    const toolAccessGrant = options.toolAccessGrant;
    if (!toolAccessGrant) throw new AgentLocalizedError("toolAccess.missingGrant");
    const toolExposure =
      options.toolExposure ?? AgentToolExposureState.forRegistry(toolAccessGrant, this.options.registry);
    const activeToolSet = this.toolProjector.createToolSet(
      this.provider.toolPlanningMode === "native"
        ? resolveAgentToolGrantNames(toolAccessGrant, this.options.registry.listTools())
        : toolExposure.snapshot().exposedToolNames,
      toolAccessGrant.preferredToolNames,
      options.interaction,
      options.nativeToolNames,
    );
    const missingNativeToolNames = (options.nativeToolNames ?? []).filter(
      (toolName) => !activeToolSet.activeToolNames.includes(toolName),
    );
    if (missingNativeToolNames.length > 0) {
      throw new Error(
        `Explicitly selected tool${missingNativeToolNames.length === 1 ? "" : "s"} cannot be exposed natively in this turn: ${missingNativeToolNames.join(", ")}.`,
      );
    }
    const allTools = this.toolProjector.createToolSet(undefined, [], undefined, options.nativeToolNames);
    const contextPolicy = this.contextPolicy.createFrame({
      requestId: options.requestId,
      model: this.options.modelProvider.Model,
      registeredTools: this.options.registry.listTools(),
      visibleToolNames: toolExposure.snapshot().exposedToolNames,
    });
    const promptTemplateProjection = this.promptTemplateProjector.project({
      input: options.input,
      activeSkills: options.activeSkills,
      rootCommand: options.rootCommand,
    });
    const selectedPromptTemplates = promptTemplateProjection.selection.promptTemplates.map((selection) =>
      projectSelectedPromptTemplateFrame({
        template: this.promptTemplateProjector.projectPromptTemplate(selection.template),
        matchedTerms: selection.matchedTerms,
        objective: this.resolveObjective(options),
        resourceKinds: selection.resourceKinds,
        workflowRoles: selection.workflowRoles,
        selectionScore: selection.score,
      }),
    );
    const skillLibraryCatalog = projectAgentSkillLibraryCatalog(this.options.registry);
    const skillCatalog = projectAgentPiSkillCatalog(this.options.registry.listSkills(), options.activeSkills);
    const projectionMs = elapsedMilliseconds(leaseStartedAt);
    await this.emitSubstrateDiagnostic(options, "core.turn.lease.started", {
      model: this.provider.model.id,
      provider: this.provider.providerId,
      toolCount: activeToolSet.activeToolNames.length,
      nativeToolNames: [...(options.nativeToolNames ?? [])],
      skillCount: options.activeSkills?.length ?? 0,
      skillLibraryCount: skillLibraryCatalog.entries.length,
      skillLibraryRevision: skillLibraryCatalog.revision,
      promptTemplateCount: promptTemplateProjection.promptTemplates.length,
      selectedPromptTemplateCount: selectedPromptTemplates.length,
      projectionMs,
    });
    throwIfAborted(options.signal);

    const sessionId = options.sessionId?.trim();
    if (!sessionId) {
      throw new Error("Pi Coding Agent requires a durable session identifier; requestId cannot be used as a session.");
    }
    const logicalCacheScope =
      options.logicalCacheScope?.trim() || createAgentPiLogicalCacheScope({ sessionId, family: "conversation" });
    const sessionLeaseStartedAt = performance.now();
    const sessionLease = await this.sessionPool.lease({
      sessionId,
      signal: options.signal,
      allTools,
      activeToolNames: activeToolSet.activeToolNames,
      thinkingLevel: clampAgentModelThinkingLevel(this.thinkingProjection, options.thinkingLevel),
      inheritProjectContext: options.inheritProjectContext ?? true,
      frame: {
        sessionId,
        logicalCacheScope,
        requestId: options.requestId,
        interaction: options.interaction,
        step: options.step,
        onEvent: options.onEvent,
        diagnostics: options.diagnostics ?? this.options.diagnostics,
        systemPrompt: options.systemPrompt,
        turnContext: options.turnContext,
        turnState: options.turnState,
        activeSkills: options.activeSkills,
        personaActive: options.personaActive === true,
        prefaceRewriteEnabled: options.prefaceRewriteEnabled === true,
        finalResponseRewriteEnabled: options.finalResponseRewriteEnabled === true,
        skillCatalog,
        skillLibraryCatalog,
        nativeProviderToolNames: this.provider.toolPlanningMode === "native" ? activeToolSet.activeToolNames : [],
        toolOriginLookup: (toolName) => {
          const tool = this.options.registry.getTool(toolName);
          return tool ? projectAgentToolEventOrigin(tool) : undefined;
        },
        toolWorkspaceWritableLookup: (toolName) => this.toolWorkspaceWritableLookup(toolName),
        rootCommand: options.rootCommand,
        toolAccessGrant,
        toolExposure,
        selectedPromptTemplates,
        contextPolicy,
        tokenBudget:
          options.tokenBudget ??
          new AgentTurnTokenBudget({
            model: this.provider.model.id,
            contextWindowTokens: this.compactionSettings.contextWindowTokens,
            inputCapacityTokens: this.compactionSettings.inputCapacityTokens,
            windowHeadroomTokens: this.compactionSettings.reserveTokens,
          }),
        signal: options.signal,
        preflight: (event) => {
          const preflight = async (candidate: typeof event) => {
            const turnDecision = options.turnState?.authorizeToolTurn();
            if (turnDecision?.block) return turnDecision;
            const projection = this.toolProjector.projectPreflight(
              candidate,
              toolAccessGrant,
              options.turnState?.context.reusableCapabilities,
              toolExposure,
              options.turnState?.context.reusableCapabilityLookup,
            );
            return this.permissionHook.authorize({ ...options, toolExposure }, projection.event, {
              requireExposure: !projection.bridged,
            });
          };
          if (options.turnState) {
            return options.turnState.preflightToolCall(event, this.maxConcurrentToolPreflights, preflight);
          }
          return preflight(event);
        },
      },
    });
    try {
      throwIfAborted(options.signal);
      const sessionLeaseMs = elapsedMilliseconds(sessionLeaseStartedAt);
      await this.emitSubstrateDiagnostic(options, "core.turn.lease.completed", {
        piSessionId: sessionId,
        sessionStorage: sessionLease.storage,
        activeToolCount: activeToolSet.activeToolNames.length,
        registeredToolCount: allTools.activeToolNames.length,
        toolNames: activeToolSet.activeToolNames,
        nativeToolNames: [...(options.nativeToolNames ?? [])],
        skillNames: options.activeSkills?.map((skill) => skill.name) ?? [],
        skillLibraryRevision: skillLibraryCatalog.revision,
        promptTemplateNames: promptTemplateProjection.promptTemplates.map((template) => template.name),
        selectedPromptTemplateNames: selectedPromptTemplates.map((template) => template.name),
        selectedPromptTemplates: selectedPromptTemplates.map((template) => ({
          name: template.name,
          resourceKinds: template.resourceKinds,
          workflowRoles: template.workflowRoles,
          matchedTerms: template.matchedTerms,
          selectionScore: template.selectionScore,
        })),
      });
      await this.emitSubstrateDiagnostic(options, "core.turn.lease.timing", {
        projectionMs,
        sessionLeaseMs,
        durationMs: elapsedMilliseconds(leaseStartedAt),
      });
      throwIfAborted(options.signal);

      return {
        session: sessionLease.session,
        piSessionId: sessionId,
      };
    } catch (error) {
      sessionLease.session.dispose();
      throw error;
    }
  }

  async resetSession(sessionId: string): Promise<boolean> {
    const reset = await this.sessionPool.reset(sessionId);
    if (reset) await this.options.onSessionContextInvalidated?.(sessionId);
    this.options.residentSpeech?.resetSession(sessionId);
    return reset;
  }

  async rewindSession(sessionId: string, entryId: string): Promise<boolean> {
    const rewound = await this.sessionPool.rewind(sessionId, entryId);
    if (rewound) {
      await this.options.onSessionContextInvalidated?.(sessionId);
      this.options.residentSpeech?.resetSession(sessionId);
    }
    return rewound;
  }

  async forkSession(sourceSessionId: string, targetSessionId: string, entryId: string): Promise<boolean> {
    const forked = await this.sessionPool.fork(sourceSessionId, targetSessionId, entryId);
    if (forked) {
      await this.options.onSessionContextInvalidated?.(targetSessionId);
      this.options.residentSpeech?.resetSession(targetSessionId);
    }
    return forked;
  }

  compactSession(sessionId: string, customInstructions?: string): Promise<AgentPiSessionCompactionResult | undefined> {
    return this.sessionPool.compact(sessionId, customInstructions);
  }

  sessionStatus(sessionId: string): Promise<AgentPiSessionRuntimeStatus | undefined> {
    return this.sessionPool.status(sessionId);
  }

  exportSession(
    sessionId: string,
    format: AgentPiSessionExportFormat,
  ): Promise<AgentPiSessionExportResult | undefined> {
    return this.sessionPool.export(sessionId, format);
  }

  private resolveObjective(options: AgentPiSessionOptions): string | undefined {
    return options.rootCommand?.objective ?? options.input;
  }

  async close(): Promise<void> {
    try {
      await this.sessionPool.close();
    } finally {
      this.options.residentSpeech?.close();
    }
  }

  private async emitSubstrateDiagnostic(
    options: AgentPiSessionOptions,
    eventType: string,
    payload: unknown,
  ): Promise<void> {
    await emitAgentPiDiagnostic(options.diagnostics ?? this.options.diagnostics, {
      context: {
        sessionId: options.sessionId,
        requestId: options.requestId,
        step: options.step,
      },
      source: AgentPiDiagnosticSources.Substrate,
      name: eventType,
      details: payload,
    });
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
