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
import { resolveAgentLoopConfig } from "../AgentDefaults.js";
import type {
  AgentPiModelProjection,
  AgentPiProviderProjection,
  AgentPiToolDefinition,
  AgentPiToolProjectionContext,
} from "./AgentPiTypes.js";
import type { RegisteredSkill } from "../Skills/AgentSkillTypes.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import { AgentPiContextPolicy } from "./AgentPiContextPolicy.js";
import type { AgentPiToolObservationDigester } from "./AgentPiToolObservationDigester.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { createAgentDefaultToolResourceCapabilities } from "../ToolRuntime/AgentToolResourceCapabilities.js";
import { AgentToolResourceClaimProjector } from "../ToolRuntime/AgentToolResourceClaimProjector.js";
import { AgentToolResourceScheduler } from "../ToolRuntime/AgentToolResourceScheduler.js";
import { AgentTurnTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { AgentToolExposureState } from "../ToolRuntime/AgentToolExposureState.js";
import { AgentPiCodingAgentSessionPool } from "./AgentPiCodingAgentSessionPool.js";
import { sha256Hex } from "../Core/AgentHash.js";
import type {
  AgentPiSessionCompactionResult,
  AgentPiSessionExportFormat,
  AgentPiSessionExportResult,
  AgentPiSessionRuntimeStatus,
} from "./AgentPiSessionManagement.js";
import type { AgentPiRuntimeService, AgentPiSessionOptions, AgentPiSessionResult } from "./AgentPiRuntimeTypes.js";
import type { AgentPiTurnContextStore } from "../PiShared/AgentPiTurnContext.js";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";

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
  registry: AgentExtensionRegistry;
  toolCallExecutor: AgentPiToolCallExecutorPort;
  artifactRecorder: AgentPiArtifactRecorderPort;
  executionEnv: SeneraExecutionEnv;
  resourcesPath?: string;
  toolPermissionGate?: AgentToolPermissionGate;
  sessionPool?: AgentPiCodingAgentSessionPool;
  toolObservationDigester?: AgentPiToolObservationDigester;
  diagnostics?: AgentPiDiagnosticSink;
  turnContexts: AgentPiTurnContextStore;
  uploadStore?: AgentUploadStore;
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
  private readonly env: SeneraExecutionEnv;
  private readonly toolProjector: AgentPiToolRegistryProjector;
  private readonly permissionHook: AgentPiToolPermissionHook;
  private readonly promptTemplateProjector: AgentPiPromptTemplateProjector;
  private readonly sessionPool: AgentPiCodingAgentSessionPool;
  private readonly contextPolicy: AgentPiContextPolicy;

  constructor(private readonly options: AgentPiSubstrateOptions) {
    const piSessionsConfig = resolveAgentLoopConfig(options.config).PiSessions;
    this.provider = projectSeneraModelProviderToPi(options.modelProvider, options.config);
    this.contextPolicy = new AgentPiContextPolicy(options.modelProvider.Model);
    this.env = options.executionEnv;
    this.promptTemplateProjector = new AgentPiPromptTemplateProjector(options.registry);
    this.sessionPool =
      options.sessionPool ??
      new AgentPiCodingAgentSessionPool({
        workspaceRoot: options.workspaceRoot,
        sessionsRoot: piSessionsConfig.RootDir,
        systemSkillsRoot: path.join(path.resolve(options.resourcesPath ?? options.workspaceRoot), "System", "Skills"),
        provider: this.provider,
        modelProvider: options.modelProvider,
        maxIdleSessions: piSessionsConfig.MaxCachedSessions,
        compaction: piSessionsConfig.Compaction,
        toolObservationDigester: options.toolObservationDigester,
        diagnostics: options.diagnostics,
      });
    this.permissionHook = new AgentPiToolPermissionHook({
      registry: options.registry,
      permissionGate: options.toolPermissionGate,
      turnContexts: options.turnContexts,
    });
    const resourceClaims = new AgentToolResourceClaimProjector(
      createAgentDefaultToolResourceCapabilities({
        config: options.config,
        workspaceRoot: options.workspaceRoot,
        executionEnv: options.executionEnv,
        uploadStore: options.uploadStore,
      }),
    );
    this.toolProjector = new AgentPiToolRegistryProjector({
      config: options.config,
      registry: options.registry,
      execution: new AgentPiToolExecutionBridge({
        model: this.provider.model.id,
        executeToolCall: options.toolCallExecutor.execute.bind(options.toolCallExecutor),
        recordToolArtifacts: options.artifactRecorder.record.bind(options.artifactRecorder),
        resourceScheduler: new AgentToolResourceScheduler(resourceClaims),
        turnContexts: options.turnContexts,
      }),
      runtimeContracts: {
        projectToolInvocationSchema: (tool, schema) =>
          options.toolCallExecutor.projectToolInvocationSchema?.call(options.toolCallExecutor, tool, schema) ??
          (schema as Record<string, unknown>),
        projectToolDescription: (tool, description) =>
          options.toolCallExecutor.projectToolDescription?.call(options.toolCallExecutor, tool, description) ??
          description,
      },
    });
  }

  model(): AgentPiModelProjection {
    return { ...this.provider.model };
  }

  toolDefinitions(context: AgentPiToolProjectionContext = {}): AgentPiToolDefinition[] {
    return this.toolProjector.project(context);
  }

  activeToolNames(context: AgentPiToolProjectionContext = {}): string[] {
    return this.toolProjector
      .createToolSet(
        context.toolAccessGrant?.exposedToolNames ?? context.visibleToolNames,
        context.toolAccessGrant?.preferredToolNames,
      )
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
      frame: {
        sessionId,
        requestId: options.requestId,
        step: options.step,
        onEvent: options.onEvent,
        diagnostics: options.diagnostics ?? this.options.diagnostics,
        systemPrompt: options.systemPrompt,
        piTurnContextId: options.piTurnContextId,
        activeSkills: options.activeSkills,
        skillCatalogFingerprint: skillCatalogFingerprint(this.options.registry.listSkills()),
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
        preflight: (event) => this.permissionHook.authorize({ ...options, toolExposure }, event),
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
    return this.sessionPool.reset(sessionId);
  }

  async rewindSession(sessionId: string, entryId: string): Promise<boolean> {
    return this.sessionPool.rewind(sessionId, entryId);
  }

  async forkSession(sourceSessionId: string, targetSessionId: string, entryId: string): Promise<boolean> {
    return this.sessionPool.fork(sourceSessionId, targetSessionId, entryId);
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

  close(): Promise<void> {
    return this.sessionPool.close();
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
