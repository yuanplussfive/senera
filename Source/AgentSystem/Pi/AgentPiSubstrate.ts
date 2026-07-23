import {
  type AgentEvent,
  type AgentHarnessResources,
  type AgentMessage,
  type AgentState,
  type PromptTemplate,
  type Skill,
} from "@earendil-works/pi-agent-core";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import type { AgentToolExecutionArtifactRecorder } from "../Artifacts/AgentToolExecutionArtifactRecorder.js";
import type { AgentToolPermissionGate } from "../Safety/AgentToolPermissionGate.js";
import type { AgentToolCallExecutor } from "../ToolRuntime/AgentToolCallExecutor.js";
import { AgentPiToolExecutionBridge } from "./AgentPiToolExecutionBridge.js";
import { AgentPiToolRegistryProjector } from "./AgentPiToolRegistryProjector.js";
import { AgentPiToolPermissionHook } from "./AgentPiToolPermissionHook.js";
import { projectSeneraModelProviderToPi } from "./AgentPiModelProjector.js";
import { AgentPiHarnessSessionPool, type AgentPiHarnessSessionPoolPort } from "./AgentPiHarnessSessionPool.js";
import { AgentPiSessionStore, type AgentPiSessionStorePort } from "./AgentPiSessionStore.js";
import { AgentPiResourceProjector } from "./AgentPiResourceProjector.js";
import { projectSelectedPromptTemplateFrame } from "./AgentPiPromptFrameProjector.js";
import { AgentPiDiagnosticSources, emitAgentPiDiagnostic, type AgentPiDiagnosticSink } from "./AgentPiDiagnostics.js";
import { resolveAgentLoopConfig } from "../AgentDefaults.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";
import type {
  AgentPiModelProjection,
  AgentPiProviderProjection,
  AgentPiToolDefinition,
  AgentPiToolProjectionContext,
} from "./AgentPiTypes.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import { AgentPiContextPolicy } from "./AgentPiContextPolicy.js";
import type { AgentPiCompactionRunResult } from "./AgentPiCompactionPolicy.js";
import { AgentPiCompactionPolicy } from "./AgentPiCompactionPolicy.js";
import type { AgentPiCompactionSummarizer } from "./AgentPiCompactionSummarizer.js";
import { AgentPiOpenAiPlanningProjector } from "../PiProxy/AgentPiOpenAiPlanningProjector.js";
import type { AgentPiToolCard } from "../PiProxy/AgentPiAssistantMessageTypes.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";

export interface AgentPiSubstrateOptions {
  workspaceRoot: string;
  config: AgentSystemConfig;
  modelProvider: ResolvedAgentModelProviderConfig;
  registry: AgentPluginRegistry;
  toolCallExecutor: AgentPiToolCallExecutorPort;
  artifactRecorder: AgentPiArtifactRecorderPort;
  executionEnv: SeneraExecutionEnv;
  toolPermissionGate?: AgentToolPermissionGate;
  sessionStore?: AgentPiSessionStorePort;
  harnessPool?: AgentPiHarnessSessionPoolPort;
  compactionSummarizer?: AgentPiCompactionSummarizer;
  diagnostics?: AgentPiDiagnosticSink;
}

export interface AgentPiToolCallExecutorPort {
  execute: AgentToolCallExecutor["execute"];
  projectToolInvocationSchema?: AgentToolCallExecutor["projectToolInvocationSchema"];
  projectToolDescription?: AgentToolCallExecutor["projectToolDescription"];
}

export interface AgentPiArtifactRecorderPort {
  record: AgentToolExecutionArtifactRecorder["record"];
}

export interface AgentPiSessionOptions extends AgentPiToolProjectionContext {
  input?: string;
  systemPrompt?: string;
  conversationEntries?: readonly AgentConversationEntry[];
  piProxyRuntimeContextId?: string;
  activeSkills?: readonly AgentActivatedSkill[];
  rootCommand?: AgentRootCommand;
  turnUnderstanding?: TurnUnderstanding;
  diagnostics?: AgentPiDiagnosticSink;
}

export type AgentPiSessionEventListener = (event: AgentEvent) => void | Promise<void>;

export interface AgentPiSession {
  readonly state: AgentState;
  readonly model: AgentState["model"];
  setHistory(messages: readonly AgentMessage[]): Promise<void> | void;
  prompt(text: string, options?: { expandPromptTemplates?: boolean; source?: string }): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  nextTurn(text: string): Promise<void>;
  markTurnBoundary(requestId: string): Promise<string>;
  compactIfNeeded?(signal?: AbortSignal): Promise<AgentPiCompactionRunResult | undefined>;
  setResources(resources: AgentHarnessResources<Skill, PromptTemplate>): Promise<void>;
  subscribe(listener: AgentPiSessionEventListener): () => void;
  abort(): Promise<void>;
  dispose(): void;
  getLastAssistantText(): string | undefined;
  getActiveToolNames(): string[];
}

export interface AgentPiSessionResult {
  session: AgentPiSession;
  piSessionId?: string;
  historyMigrationRequired?: boolean;
}

export interface AgentPiRuntimeService {
  model(): AgentPiModelProjection;
  toolDefinitions(context?: AgentPiToolProjectionContext): AgentPiToolDefinition[];
  activeToolNames(context?: AgentPiToolProjectionContext): string[];
  planningToolCards(context?: AgentPiToolProjectionContext): AgentPiToolCard[];
  leaseTurn(options?: AgentPiSessionOptions): Promise<AgentPiSessionResult>;
  rewindSession(sessionId: string, entryId: string): Promise<boolean>;
  resetSession(sessionId: string): Promise<boolean>;
}

export class AgentPiSubstrate implements AgentPiRuntimeService {
  private readonly provider: AgentPiProviderProjection;
  private readonly env: SeneraExecutionEnv;
  private readonly sessionStore: AgentPiSessionStorePort;
  private readonly toolProjector: AgentPiToolRegistryProjector;
  private readonly permissionHook: AgentPiToolPermissionHook;
  private readonly resourceProjector: AgentPiResourceProjector;
  private readonly harnessPool: AgentPiHarnessSessionPoolPort;
  private readonly contextPolicy: AgentPiContextPolicy;
  private readonly planningProjector: AgentPiOpenAiPlanningProjector;

  constructor(private readonly options: AgentPiSubstrateOptions) {
    const piSessionsConfig = resolveAgentLoopConfig(options.config).PiSessions;
    this.provider = projectSeneraModelProviderToPi(options.modelProvider, options.config);
    this.contextPolicy = new AgentPiContextPolicy(options.modelProvider.Model);
    this.planningProjector = new AgentPiOpenAiPlanningProjector({ modelProvider: options.modelProvider });
    this.env = options.executionEnv;
    this.sessionStore =
      options.sessionStore ??
      new AgentPiSessionStore({
        workspaceRoot: options.workspaceRoot,
        sessionsRoot: piSessionsConfig.RootDir,
        maxCachedSessions: piSessionsConfig.MaxCachedSessions,
        env: this.env,
      });
    this.resourceProjector = new AgentPiResourceProjector(options.registry);
    this.harnessPool =
      options.harnessPool ??
      new AgentPiHarnessSessionPool({
        env: this.env,
        provider: this.provider,
        modelProvider: options.modelProvider,
        maxIdleSessions: piSessionsConfig.MaxCachedSessions,
        compactionPolicy: piSessionsConfig.Compaction.Enabled
          ? new AgentPiCompactionPolicy(piSessionsConfig.Compaction, options.modelProvider)
          : undefined,
        compactionSummarizer: options.compactionSummarizer,
        diagnostics: options.diagnostics,
      });
    this.permissionHook = new AgentPiToolPermissionHook({
      registry: options.registry,
      permissionGate: options.toolPermissionGate,
    });
    this.toolProjector = new AgentPiToolRegistryProjector({
      config: options.config,
      registry: options.registry,
      execution: new AgentPiToolExecutionBridge({
        executeToolCall: options.toolCallExecutor.execute.bind(options.toolCallExecutor),
        recordToolArtifacts: options.artifactRecorder.record.bind(options.artifactRecorder),
        model: options.modelProvider.Model,
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
    return this.toolProjector.names(context.visibleToolNames);
  }

  planningToolCards(context: AgentPiToolProjectionContext = {}): AgentPiToolCard[] {
    const definitions = this.toolProjector.createToolSet(context.visibleToolNames).materialize(() => context);
    return this.planningProjector.projectToolCards(
      definitions.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
    );
  }

  async leaseTurn(options: AgentPiSessionOptions = {}): Promise<AgentPiSessionResult> {
    throwIfAborted(options.signal);
    const leaseStartedAt = performance.now();
    const toolSet = this.toolProjector.createToolSet(options.visibleToolNames);
    const contextPolicy = this.contextPolicy.createFrame({
      requestId: options.requestId,
      model: this.options.modelProvider.Model,
      conversationEntries: options.conversationEntries ?? [],
      registeredTools: this.options.registry.listTools(),
      visibleToolNames: options.visibleToolNames,
    });
    const resourceProjection = this.resourceProjector.project({
      input: options.input,
      activeSkills: options.activeSkills,
      rootCommand: options.rootCommand,
      turnUnderstanding: options.turnUnderstanding,
    });
    const resources = resourceProjection.harnessResources;
    const selectedPromptTemplates = resourceProjection.selection.promptTemplates.map((selection) =>
      projectSelectedPromptTemplateFrame({
        template: this.resourceProjector.projectPromptTemplate(selection.template),
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
      toolCount: toolSet.activeToolNames.length,
      skillCount: resources.skills?.length ?? 0,
      promptTemplateCount: resources.promptTemplates?.length ?? 0,
      selectedPromptTemplateCount: selectedPromptTemplates.length,
      projectionMs,
    });
    throwIfAborted(options.signal);

    const sessionOpenStartedAt = performance.now();
    const requestedSessionId = options.sessionId?.trim() || options.requestId?.trim();
    const pooledPersistentSession = requestedSessionId
      ? this.harnessPool.findPersistentSession(requestedSessionId)
      : undefined;
    const persistentSession = pooledPersistentSession
      ? {
          sessionId: requestedSessionId!,
          session: pooledPersistentSession,
          storage: "existing" as const,
        }
      : await this.sessionStore.openOrCreate({
          sessionId: options.sessionId,
          fallbackId: options.requestId,
          signal: options.signal,
        });
    throwIfAborted(options.signal);
    const sessionOpenMs = elapsedMilliseconds(sessionOpenStartedAt);
    const historyInspectionStartedAt = performance.now();
    const piSessionHasHistory = (await persistentSession.session.getLeafId()) !== null;
    throwIfAborted(options.signal);
    const historyInspectionMs = elapsedMilliseconds(historyInspectionStartedAt);
    const harnessLeaseStartedAt = performance.now();
    const harnessLease = await this.harnessPool.lease({
      sessionId: persistentSession.sessionId,
      session: persistentSession.session,
      signal: options.signal,
      toolSet,
      resources,
      resourceFingerprint: resourceProjection.fingerprint,
      frame: {
        sessionId: persistentSession.sessionId,
        requestId: options.requestId,
        step: options.step,
        onEvent: options.onEvent,
        diagnostics: options.diagnostics ?? this.options.diagnostics,
        systemPrompt: options.systemPrompt,
        piProxyRuntimeContextId: options.piProxyRuntimeContextId,
        activeSkills: options.activeSkills,
        rootCommand: options.rootCommand,
        turnUnderstanding: options.turnUnderstanding,
        selectedPromptTemplates,
        contextPolicy,
      },
      preflight: (event) => this.permissionHook.authorize(options, event),
    });
    try {
      throwIfAborted(options.signal);
      const harnessLeaseMs = elapsedMilliseconds(harnessLeaseStartedAt);
      await this.emitSubstrateDiagnostic(options, "core.turn.lease.completed", {
        piSessionId: persistentSession.sessionId,
        piSessionStorage: persistentSession.storage,
        harnessStorage: harnessLease.storage,
        piSessionHasHistory,
        historyMigrationRequired: !piSessionHasHistory,
        sessionOpenSource: pooledPersistentSession ? "harness_pool" : "session_store",
        activeToolCount: toolSet.activeToolNames.length,
        customToolCount: toolSet.activeToolNames.length,
        toolNames: toolSet.activeToolNames,
        skillNames: resources.skills?.map((skill) => skill.name) ?? [],
        promptTemplateNames: resources.promptTemplates?.map((template) => template.name) ?? [],
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
        sessionOpenMs,
        historyInspectionMs,
        harnessLeaseMs,
        durationMs: elapsedMilliseconds(leaseStartedAt),
        sessionOpenSource: pooledPersistentSession ? "harness_pool" : "session_store",
      });
      throwIfAborted(options.signal);

      return {
        session: harnessLease.session,
        piSessionId: persistentSession.sessionId,
        historyMigrationRequired: !piSessionHasHistory,
      };
    } catch (error) {
      harnessLease.session.dispose();
      throw error;
    }
  }

  async resetSession(sessionId: string): Promise<boolean> {
    await this.harnessPool.reset(sessionId);
    return this.sessionStore.reset(sessionId);
  }

  async rewindSession(sessionId: string, entryId: string): Promise<boolean> {
    if (await this.harnessPool.rewind(sessionId, entryId)) return true;
    return this.sessionStore.rewind(sessionId, entryId);
  }

  private resolveObjective(options: AgentPiSessionOptions): string | undefined {
    return options.rootCommand?.objective ?? options.turnUnderstanding?.standaloneRequest ?? options.input;
  }

  close(): Promise<void> {
    return this.harnessPool.close();
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
