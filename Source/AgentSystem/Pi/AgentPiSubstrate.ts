import {
  type AgentEvent,
  type AgentHarnessResources,
  type AgentMessage,
  type AgentState,
  type PromptTemplate,
  type Skill,
} from "@earendil-works/pi-agent-core";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type {
  ResolvedAgentModelProviderConfig,
} from "../Types/AgentConfigTypes.js";
import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import type { AgentToolExecutionArtifactRecorder } from "../Artifacts/AgentToolExecutionArtifactRecorder.js";
import type { AgentToolPermissionGate } from "../Safety/AgentToolPermissionGate.js";
import type { AgentToolCallExecutor } from "../ToolRuntime/AgentToolCallExecutor.js";
import { AgentPiToolExecutionBridge } from "./AgentPiToolExecutionBridge.js";
import { AgentPiToolRegistryProjector } from "./AgentPiToolRegistryProjector.js";
import { AgentPiToolPermissionHook } from "./AgentPiToolPermissionHook.js";
import {
  projectSeneraModelProviderToPi,
} from "./AgentPiModelProjector.js";
import { AgentPiHarnessSessionPool } from "./AgentPiHarnessSessionPool.js";
import { AgentPiSessionStore } from "./AgentPiSessionStore.js";
import { AgentPiResourceProjector } from "./AgentPiResourceProjector.js";
import {
  projectSelectedPromptTemplateFrame,
} from "./AgentPiPromptFrameProjector.js";
import { createPiTraceEvent } from "./AgentPiTraceProjector.js";
import { emitAgentEvent } from "../Events/AgentEvent.js";
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

export interface AgentPiSubstrateOptions {
  workspaceRoot: string;
  config: AgentSystemConfig;
  modelProvider: ResolvedAgentModelProviderConfig;
  registry: AgentPluginRegistry;
  toolCallExecutor: AgentToolCallExecutor;
  artifactRecorder: AgentToolExecutionArtifactRecorder;
  executionEnv: SeneraExecutionEnv;
  toolPermissionGate?: AgentToolPermissionGate;
}

export interface AgentPiSessionOptions extends AgentPiToolProjectionContext {
  sessionId?: string;
  input?: string;
  systemPrompt?: string;
  conversationEntries?: readonly AgentConversationEntry[];
  piProxyRuntimeContextId?: string;
  activeSkills?: readonly AgentActivatedSkill[];
  rootCommand?: AgentRootCommand;
  turnUnderstanding?: TurnUnderstanding;
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
  createSession(options?: AgentPiSessionOptions): Promise<AgentPiSessionResult>;
}

export class AgentPiSubstrate implements AgentPiRuntimeService {
  private readonly provider: AgentPiProviderProjection;
  private readonly env: SeneraExecutionEnv;
  private readonly sessionStore: AgentPiSessionStore;
  private readonly toolProjector: AgentPiToolRegistryProjector;
  private readonly permissionHook: AgentPiToolPermissionHook;
  private readonly resourceProjector: AgentPiResourceProjector;
  private readonly harnessPool: AgentPiHarnessSessionPool;
  private readonly contextPolicy: AgentPiContextPolicy;

  constructor(private readonly options: AgentPiSubstrateOptions) {
    this.provider = projectSeneraModelProviderToPi(options.modelProvider, options.config);
    this.contextPolicy = new AgentPiContextPolicy(options.modelProvider.Model);
    this.env = options.executionEnv;
    this.sessionStore = new AgentPiSessionStore({
      workspaceRoot: options.workspaceRoot,
      sessionsRoot: resolveAgentLoopConfig(options.config).PiSessions.RootDir,
      env: this.env,
    });
    this.resourceProjector = new AgentPiResourceProjector(options.registry);
    this.harnessPool = new AgentPiHarnessSessionPool({
      env: this.env,
      provider: this.provider,
      modelProvider: options.modelProvider,
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

  async createSession(options: AgentPiSessionOptions = {}): Promise<AgentPiSessionResult> {
    const tools = this.activeToolNames(options);
    const customTools = this.toolDefinitions(options);
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
      }));
    await this.emitSubstrateTrace(options, "core.agent.create.started", {
      model: this.provider.model.id,
      provider: this.provider.providerId,
      toolCount: tools.length,
      skillCount: resources.skills?.length ?? 0,
      promptTemplateCount: resources.promptTemplates?.length ?? 0,
      selectedPromptTemplateCount: selectedPromptTemplates.length,
    });

    const persistentSession = await this.sessionStore.openOrCreate({
      sessionId: options.sessionId,
      fallbackId: options.requestId,
    });
    const entryCount = (await persistentSession.session.getEntries()).length;
    const harnessLease = await this.harnessPool.lease({
      sessionId: persistentSession.sessionId,
      session: persistentSession.session,
      tools: customTools,
      activeToolNames: tools,
      resources,
      frame: {
        sessionId: persistentSession.sessionId,
        requestId: options.requestId,
        step: options.step,
        onEvent: options.onEvent,
        systemPrompt: options.systemPrompt,
        piProxyRuntimeContextId: options.piProxyRuntimeContextId,
        activeSkills: options.activeSkills,
        rootCommand: options.rootCommand,
        turnUnderstanding: options.turnUnderstanding,
        selectedPromptTemplates,
        contextPolicy,
      },
      preflight: (event) =>
        this.permissionHook.authorize(options, event),
    });
    await this.emitSubstrateTrace(options, "core.agent.create.completed", {
      piSessionId: persistentSession.sessionId,
      piSessionStorage: persistentSession.storage,
      harnessStorage: harnessLease.storage,
      piSessionEntryCount: entryCount,
      historyMigrationRequired: entryCount === 0,
      activeToolCount: tools.length,
      customToolCount: customTools.length,
      toolNames: tools,
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

    return {
      session: harnessLease.session,
      piSessionId: persistentSession.sessionId,
      historyMigrationRequired: entryCount === 0,
    };
  }

  private resolveObjective(options: AgentPiSessionOptions): string | undefined {
    return options.rootCommand?.objective
      ?? options.turnUnderstanding?.standaloneRequest
      ?? options.input;
  }

  close(): void {
    this.harnessPool.close();
  }

  private async emitSubstrateTrace(
    options: AgentPiSessionOptions,
    eventType: string,
    payload: unknown,
  ): Promise<void> {
    await emitAgentEvent(options.onEvent, createPiTraceEvent({
      sessionId: options.sessionId,
      requestId: options.requestId ?? "pi-substrate",
      step: options.step ?? 0,
      source: "substrate",
      eventType,
      payload,
    }));
  }
}
