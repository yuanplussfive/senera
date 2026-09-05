import path from "node:path";
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
import { AgentPiPromptTemplateProjector } from "./AgentPiPromptTemplateProjector.js";
import { projectSelectedPromptTemplateFrame } from "./AgentPiPromptFrameProjector.js";
import { AgentPiDiagnosticSources, emitAgentPiDiagnostic, type AgentPiDiagnosticSink } from "./AgentPiDiagnostics.js";
import { resolveAgentLoopConfig, resolveAgentPromptConfig, resolveToolExecutionConfig } from "../AgentDefaults.js";
import type {
  AgentPiModelProjection,
  AgentPiProviderProjection,
  AgentPiToolDefinition,
  AgentPiToolProjectionContext,
} from "./AgentPiTypes.js";
import type { RegisteredSkill } from "../Skills/AgentSkillTypes.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import { AgentPiContextPolicy } from "./AgentPiContextPolicy.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { createAgentDefaultToolResourceCapabilities } from "../ToolRuntime/AgentToolResourceCapabilities.js";
import { AgentToolResourceClaimProjector } from "../ToolRuntime/AgentToolResourceClaimProjector.js";
import { AgentToolExecutionScheduler } from "../ToolRuntime/AgentToolExecutionScheduler.js";
import { AgentTurnTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { AgentToolExposureState } from "../ToolRuntime/AgentToolExposureState.js";
import { AgentPiCodingAgentSessionPool } from "./AgentPiCodingAgentSessionPool.js";
import { resolveAgentPiSessionSystemPrompt } from "./AgentPiSessionSystemPrompt.js";
import { sha256Hex } from "../Core/AgentHash.js";
import type {
  AgentPiSessionCompactionResult,
  AgentPiSessionExportFormat,
  AgentPiSessionExportResult,
  AgentPiSessionRuntimeStatus,
} from "./AgentPiSessionManagement.js";
import type { AgentPiRuntimeService, AgentPiSessionOptions, AgentPiSessionResult } from "./AgentPiRuntimeTypes.js";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import type { AgentPiPlanningCompilerFactory } from "./AgentPiPlanningCompiler.js";
import { projectSeneraProcessBackendsToToolTargets } from "../ToolRuntime/AgentToolExecutionPlan.js";
import type { AgentResidentSpeechSessionRuntime } from "../ResidentSpeech/AgentResidentSpeechTypes.js";

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
  workspaceRoot: string;
  config: AgentSystemConfig;
  modelProvider: ResolvedAgentModelProviderConfig;
  planningCompilerFactory: AgentPiPlanningCompilerFactory;
  residentSpeech?: AgentResidentSpeechSessionRuntime;
  registry: AgentExtensionRegistry;
  toolCallExecutor: AgentPiToolCallExecutorPort;
  artifactRecorder: AgentPiArtifactRecorderPort;
  executionEnv: SeneraExecutionEnv;
  resourcesPath?: string;
  toolPermissionGate?: AgentToolPermissionGate;
  sessionPool?: AgentPiCodingAgentSessionPool;
  diagnostics?: AgentPiDiagnosticSink;
  uploadStore?: AgentUploadStore;
  beforeCompaction?: (sessionId: string) => Promise<void>;
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
  private readonly provider: AgentPiProviderProjection;
  private readonly toolProjector: AgentPiToolRegistryProjector;
  private readonly permissionHook: AgentPiToolPermissionHook;
  private readonly promptTemplateProjector: AgentPiPromptTemplateProjector;
  private readonly sessionPool: AgentPiCodingAgentSessionPool;
  private readonly contextPolicy: AgentPiContextPolicy;
  private readonly maxConcurrentToolPreflights: number;

  constructor(private readonly options: AgentPiSubstrateOptions) {
    const piSessionsConfig = resolveAgentLoopConfig(options.config).PiSessions;
    this.provider = projectSeneraModelProviderToPi(options.modelProvider);
    this.contextPolicy = new AgentPiContextPolicy(options.modelProvider.Model);
    this.promptTemplateProjector = new AgentPiPromptTemplateProjector(options.registry);
    const systemResourcesRoot = path.resolve(options.resourcesPath ?? options.workspaceRoot);
    this.sessionPool =
      options.sessionPool ??
      new AgentPiCodingAgentSessionPool({
        workspaceRoot: options.workspaceRoot,
        sessionsRoot: piSessionsConfig.RootDir,
        systemSkillsRoot: path.join(systemResourcesRoot, "System", "Skills"),
        systemPromptPath: resolveAgentPiSessionSystemPrompt(systemResourcesRoot),
        additionalSkillPaths: options.registry.listSkills().map((skill) => skill.descriptionFile),
        provider: this.provider,
        modelProvider: options.modelProvider,
        planningCompilerFactory: options.planningCompilerFactory,
        residentSpeech: options.residentSpeech,
        maxIdleSessions: piSessionsConfig.MaxCachedSessions,
        compaction: piSessionsConfig.Compaction,
        diagnostics: options.diagnostics,
        beforeCompaction: options.beforeCompaction,
      });
    const resourceCapabilities = createAgentDefaultToolResourceCapabilities({
      config: options.config,
      workspaceRoot: options.workspaceRoot,
      executionEnv: options.executionEnv,
      uploadStore: options.uploadStore,
    });
    this.permissionHook = new AgentPiToolPermissionHook({
      registry: options.registry,
      permissionGate: options.toolPermissionGate,
      executionCapabilities: () => options.executionEnv.capabilities,
      resourceCapabilities,
    });
    const resourceClaims = new AgentToolResourceClaimProjector(resourceCapabilities);
    const toolExecution = resolveToolExecutionConfig(options.config);
    this.maxConcurrentToolPreflights = toolExecution.MaxConcurrentCallsPerRun;
    this.toolProjector = new AgentPiToolRegistryProjector({
      config: options.config,
      registry: options.registry,
      toolPlanningMode: this.provider.toolPlanningMode,
      execution: new AgentPiToolExecutionBridge({
        model: this.provider.model.id,
        modelSupportsImages: this.provider.model.input.includes("image"),
        executeToolCall: options.toolCallExecutor.execute.bind(options.toolCallExecutor),
        recordToolArtifacts: options.artifactRecorder.record.bind(options.artifactRecorder),
        attributionEnabled: () => resolveAgentPromptConfig(options.config).BamlToolAttribution,
        executionScheduler: new AgentToolExecutionScheduler({
          maxConcurrentCallsPerRun: toolExecution.MaxConcurrentCallsPerRun,
          resourceClaims,
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

  toolDefinitions(context: AgentPiToolProjectionContext = {}): AgentPiToolDefinition[] {
    return this.toolProjector.project(context);
  }

  activeToolNames(context: AgentPiToolProjectionContext = {}): string[] {
    const visibleToolNames =
      this.provider.toolPlanningMode === "native"
        ? context.toolAccessGrant?.authorizedToolNames
        : context.toolAccessGrant?.exposedToolNames;
    return this.toolProjector
      .createToolSet(visibleToolNames ?? context.visibleToolNames, context.toolAccessGrant?.preferredToolNames)
      .activeToolNames.slice();
  }

  async leaseTurn(options: AgentPiSessionOptions): Promise<AgentPiSessionResult> {
    throwIfAborted(options.signal);
    const leaseStartedAt = performance.now();
    const toolAccessGrant = options.toolAccessGrant;
    if (!toolAccessGrant) throw new AgentLocalizedError("toolAccess.missingGrant");
    const toolExposure = options.toolExposure ?? new AgentToolExposureState(toolAccessGrant);
    const activeToolSet = this.toolProjector.createToolSet(
      toolAccessGrant.authorizedToolNames,
      toolAccessGrant.preferredToolNames,
    );
    const allTools = this.toolProjector.createToolSet();
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
    const projectionMs = elapsedMilliseconds(leaseStartedAt);
    await this.emitSubstrateDiagnostic(options, "core.turn.lease.started", {
      model: this.provider.model.id,
      provider: this.provider.providerId,
      toolCount: activeToolSet.activeToolNames.length,
      skillCount: options.activeSkills?.length ?? 0,
      promptTemplateCount: promptTemplateProjection.promptTemplates.length,
      selectedPromptTemplateCount: selectedPromptTemplates.length,
      projectionMs,
    });
    throwIfAborted(options.signal);

    const sessionId = options.sessionId?.trim() || options.requestId?.trim();
    if (!sessionId) throw new Error("Pi Coding Agent requires a session or request identifier.");
    const sessionLeaseStartedAt = performance.now();
    const sessionLease = await this.sessionPool.lease({
      sessionId,
      signal: options.signal,
      allTools,
      activeToolNames: activeToolSet.activeToolNames,
      thinkingLevel: options.thinkingLevel,
      inheritProjectContext: options.inheritProjectContext ?? true,
      frame: {
        sessionId,
        requestId: options.requestId,
        step: options.step,
        onEvent: options.onEvent,
        diagnostics: options.diagnostics ?? this.options.diagnostics,
        systemPrompt: options.systemPrompt,
        turnContext: options.turnContext,
        turnState: options.turnState,
        activeSkills: options.activeSkills,
        roleplayPresetActive: options.roleplayPresetActive === true,
        prefaceRewriteEnabled: options.prefaceRewriteEnabled === true,
        skillCatalogFingerprint: skillCatalogFingerprint(this.options.registry.listSkills()),
        nativeProviderToolNames: this.provider.toolPlanningMode === "native" ? activeToolSet.activeToolNames : [],
        rootCommand: options.rootCommand,
        toolAccessGrant,
        toolExposure,
        selectedPromptTemplates,
        contextPolicy,
        tokenBudget:
          options.tokenBudget ??
          new AgentTurnTokenBudget({
            model: this.provider.model.id,
            contextWindowTokens: this.provider.model.contextWindow,
            outputReserveTokens: this.provider.model.maxTokens,
          }),
        signal: options.signal,
        preflight: (event) => {
          const preflight = async (candidate: typeof event) => {
            const turnDecision = options.turnState?.authorizeToolTurn();
            if (turnDecision?.block) return turnDecision;
            const projection = this.toolProjector.projectPreflight(candidate, toolAccessGrant);
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
        historyMigrationRequired: sessionLease.historyMigrationRequired,
        activeToolCount: activeToolSet.activeToolNames.length,
        registeredToolCount: allTools.activeToolNames.length,
        toolNames: activeToolSet.activeToolNames,
        skillNames: options.activeSkills?.map((skill) => skill.name) ?? [],
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
        historyMigrationRequired: sessionLease.historyMigrationRequired,
      };
    } catch (error) {
      sessionLease.session.dispose();
      throw error;
    }
  }

  async resetSession(sessionId: string): Promise<boolean> {
    const reset = await this.sessionPool.reset(sessionId);
    this.options.residentSpeech?.resetSession(sessionId);
    return reset;
  }

  async rewindSession(sessionId: string, entryId: string): Promise<boolean> {
    const rewound = await this.sessionPool.rewind(sessionId, entryId);
    if (rewound) this.options.residentSpeech?.resetSession(sessionId);
    return rewound;
  }

  async forkSession(sourceSessionId: string, targetSessionId: string, entryId: string): Promise<boolean> {
    const forked = await this.sessionPool.fork(sourceSessionId, targetSessionId, entryId);
    if (forked) this.options.residentSpeech?.resetSession(targetSessionId);
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

function skillCatalogFingerprint(skills: readonly RegisteredSkill[]): string {
  const identities = skills
    .map((skill) => ({
      name: skill.name,
      descriptionFile: path.resolve(skill.descriptionFile),
      revision: skill.revision ?? skill.source.id,
    }))
    .sort(
      (left, right) => left.name.localeCompare(right.name) || left.descriptionFile.localeCompare(right.descriptionFile),
    );
  return sha256Hex(JSON.stringify(identities));
}
