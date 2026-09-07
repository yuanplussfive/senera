import {
  createAgentSession,
  DefaultResourceLoader,
  SettingsManager,
  type SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import { AgentTurnTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import { emptyAgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../ToolRuntime/AgentToolExposureState.js";
import {
  AgentPiMutableSessionFrame,
  agentPiDiagnosticContext,
  projectAgentPiToolContext,
  type AgentPiCodingAgentSessionFrame,
} from "./AgentPiCodingAgentSessionFrame.js";
import type {
  AgentPiCodingAgentLeaseInput,
  AgentPiCodingAgentSessionPoolOptions,
  AgentPiPooledCodingSession,
} from "./AgentPiCodingAgentSessionPoolContracts.js";
import { AgentPiDiagnosticSources, emitAgentPiDiagnostic } from "./AgentPiDiagnostics.js";
import { AgentPiModelRuntimeOwner } from "./AgentPiModelRuntimeOwner.js";
import { AgentPiProjectContext } from "./AgentPiProjectContext.js";
import {
  AgentPiRuntimeExtensionFactory,
  type AgentPiRuntimeExtensionRegistration,
} from "./AgentPiRuntimeExtensionFactory.js";
import { AgentPiSkillResolver } from "./AgentPiSkillResolver.js";
import { resolveAgentPiCompactionSettings } from "./AgentPiCompactionSettings.js";
import type { AgentPiToolSet } from "./AgentPiToolRegistryProjector.js";

const NativeProviderRetryAttempts = 0;
const SessionDiagnosticEventTypes = new Set([
  "compaction_start",
  "compaction_end",
  "auto_retry_start",
  "auto_retry_end",
  "summarization_retry_scheduled",
  "summarization_retry_attempt_start",
  "summarization_retry_finished",
]);

/** Materializes and reconfigures Pi Coding Agent sessions for the pool. */
export class AgentPiCodingAgentSessionFactory {
  private readonly workspaceLayout;
  private readonly projectContext: AgentPiProjectContext;
  private readonly runtimeExtensions: AgentPiRuntimeExtensionFactory;
  private readonly skillResolver = new AgentPiSkillResolver();

  constructor(private readonly options: AgentPiCodingAgentSessionPoolOptions) {
    this.workspaceLayout = resolveAgentWorkspaceLayout(options.workspaceRoot);
    this.projectContext = new AgentPiProjectContext(this.workspaceLayout.projectContextFile);
    this.runtimeExtensions = new AgentPiRuntimeExtensionFactory(options);
  }

  async create(
    input: AgentPiCodingAgentLeaseInput,
    sessionManager: SessionManager,
    lastAccess: number,
  ): Promise<AgentPiPooledCodingSession> {
    const frame = new AgentPiMutableSessionFrame(input.frame);
    const settingsManager = this.createSettingsManager();
    const projectContext = this.projectContext.refresh();
    const runtimeExtension = this.runtimeExtensions.create(frame, sessionManager);
    const resourceLoader = this.createResourceLoader(settingsManager, input.inheritProjectContext, runtimeExtension);
    await resourceLoader.reload();
    await this.emitResourceDiagnostics(frame.snapshot(), resourceLoader);
    frame.update(input.frame, this.skillResolver.resolve(input.frame.activeSkills, resourceLoader.getSkills()));
    const session = await this.createCodingSession({
      sessionManager,
      settingsManager,
      resourceLoader,
      tools: this.materializeTools(input.allTools, frame),
      activeToolNames: input.activeToolNames,
      frame,
      thinkingLevel: input.thinkingLevel,
      runtimeExtension,
    });
    const pooled = this.pooledSession({
      session,
      sessionManager,
      frame,
      resourceLoader,
      toolFingerprint: input.allTools.fingerprint,
      skillCatalogFingerprint: input.frame.skillCatalogFingerprint,
      projectContextFingerprint: projectContext.fingerprint,
      inheritProjectContext: input.inheritProjectContext,
      lastAccess,
    });
    this.bindToolExposure(pooled, input.frame.toolExposure, input.activeToolNames);
    return pooled;
  }

  async createManagement(
    sessionId: string,
    sessionManager: SessionManager,
    lastAccess: number,
  ): Promise<AgentPiPooledCodingSession> {
    const toolAccessGrant = emptyAgentToolAccessGrant();
    const frameValue: AgentPiCodingAgentSessionFrame = {
      sessionId,
      roleplayPresetActive: false,
      skillCatalogFingerprint: "",
      nativeProviderToolNames: [],
      toolAccessGrant,
      toolExposure: new AgentToolExposureState(toolAccessGrant),
      selectedPromptTemplates: [],
      tokenBudget: new AgentTurnTokenBudget({
        model: this.options.provider.model.id,
        contextWindowTokens: this.options.provider.model.contextWindow,
        outputReserveTokens: this.options.provider.model.maxTokens,
      }),
      preflight: () => Promise.resolve(undefined),
    };
    const frame = new AgentPiMutableSessionFrame(frameValue);
    const settingsManager = this.createSettingsManager();
    const projectContext = this.projectContext.refresh();
    const runtimeExtension = this.runtimeExtensions.create(frame, sessionManager);
    const resourceLoader = this.createResourceLoader(settingsManager, true, runtimeExtension);
    await resourceLoader.reload();
    await this.emitResourceDiagnostics(frameValue, resourceLoader);
    frame.update(frameValue, []);
    const session = await this.createCodingSession({
      sessionManager,
      settingsManager,
      resourceLoader,
      tools: [],
      activeToolNames: [],
      frame,
      thinkingLevel: "off",
      runtimeExtension,
    });
    const pooled = this.pooledSession({
      session,
      sessionManager,
      frame,
      resourceLoader,
      toolFingerprint: "",
      skillCatalogFingerprint: frameValue.skillCatalogFingerprint,
      projectContextFingerprint: projectContext.fingerprint,
      inheritProjectContext: true,
      lastAccess,
    });
    this.bindToolExposure(pooled, frameValue.toolExposure, []);
    return pooled;
  }

  async configure(pooled: AgentPiPooledCodingSession, input: AgentPiCodingAgentLeaseInput): Promise<void> {
    await pooled.session.waitForIdle();
    throwIfAborted(input.signal);
    if (pooled.toolFingerprint !== input.allTools.fingerprint) {
      throw new Error("Pi Coding Agent tool registry changed inside an active runtime snapshot.");
    }
    if (pooled.inheritProjectContext !== input.inheritProjectContext) {
      throw new Error("Pi project-context inheritance cannot change inside one persisted session.");
    }
    const projectContext = this.projectContext.refresh();
    const resourcesChanged =
      pooled.skillCatalogFingerprint !== input.frame.skillCatalogFingerprint ||
      pooled.projectContextFingerprint !== projectContext.fingerprint;
    if (resourcesChanged) {
      await pooled.session.reload();
      await this.emitResourceDiagnostics(input.frame, pooled.resourceLoader);
      pooled.skillCatalogFingerprint = input.frame.skillCatalogFingerprint;
      pooled.projectContextFingerprint = projectContext.fingerprint;
    }
    const skills = this.skillResolver.resolve(input.frame.activeSkills, pooled.resourceLoader.getSkills());
    pooled.frame.update(input.frame, skills);
    this.bindToolExposure(pooled, input.frame.toolExposure, input.activeToolNames);
    pooled.session.setThinkingLevel(input.thinkingLevel ?? "off");
    throwIfAborted(input.signal);
  }

  private pooledSession(
    input: Omit<AgentPiPooledCodingSession, "activeLeases" | "disposeDiagnostics" | "disposeToolExposure">,
  ): AgentPiPooledCodingSession {
    return {
      ...input,
      disposeDiagnostics: input.session.subscribe((event) => {
        void this.emitSessionDiagnostic(input.frame.snapshot(), event).catch(() => undefined);
      }),
      disposeToolExposure: () => undefined,
      activeLeases: 0,
    };
  }

  private bindToolExposure(
    pooled: AgentPiPooledCodingSession,
    exposure: AgentToolExposureState,
    activeToolNames: readonly string[],
  ): void {
    if (this.options.provider.toolPlanningMode === "native") {
      pooled.disposeToolExposure();
      pooled.disposeToolExposure = () => undefined;
      pooled.toolExposure = exposure;
      pooled.session.setActiveToolsByName([...activeToolNames]);
      return;
    }
    if (pooled.toolExposure === exposure) {
      pooled.session.setActiveToolsByName([...exposure.snapshot().exposedToolNames]);
      return;
    }
    pooled.disposeToolExposure();
    pooled.toolExposure = exposure;
    pooled.disposeToolExposure = exposure.subscribe((snapshot) => {
      pooled.session.setActiveToolsByName([...snapshot.exposedToolNames]);
    });
    pooled.session.setActiveToolsByName([...exposure.snapshot().exposedToolNames]);
  }

  private createResourceLoader(
    settingsManager: SettingsManager,
    inheritProjectContext: boolean,
    runtimeExtension: AgentPiRuntimeExtensionRegistration,
  ): DefaultResourceLoader {
    return new DefaultResourceLoader({
      cwd: this.options.workspaceRoot,
      agentDir: this.workspaceLayout.stateRoot,
      settingsManager,
      systemPrompt: this.options.systemPromptPath,
      additionalSkillPaths: [...new Set([this.options.systemSkillsRoot, ...(this.options.additionalSkillPaths ?? [])])],
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      agentsFilesOverride: () => (inheritProjectContext ? this.projectContext.agentsFiles() : { agentsFiles: [] }),
      extensionFactories: [runtimeExtension],
    });
  }

  private async createCodingSession(input: {
    sessionManager: SessionManager;
    settingsManager: SettingsManager;
    resourceLoader: DefaultResourceLoader;
    tools: ToolDefinition[];
    activeToolNames: readonly string[];
    frame: AgentPiMutableSessionFrame;
    thinkingLevel?: ModelThinkingLevel;
    runtimeExtension: AgentPiRuntimeExtensionRegistration;
  }) {
    const registeredModel = await new AgentPiModelRuntimeOwner(
      {
        provider: this.options.provider,
        modelProvider: this.options.modelProvider,
        compilerFactory: this.options.planningCompilerFactory,
        residentSpeech: this.options.residentSpeech,
      },
      input.frame,
    ).get();
    const created = await createAgentSession({
      cwd: this.options.workspaceRoot,
      agentDir: this.workspaceLayout.stateRoot,
      modelRuntime: registeredModel.runtime,
      model: registeredModel.model,
      thinkingLevel: input.thinkingLevel ?? "off",
      noTools: "builtin",
      customTools: input.tools,
      resourceLoader: input.resourceLoader,
      settingsManager: input.settingsManager,
      sessionManager: input.sessionManager,
    });
    created.session.setActiveToolsByName([...input.activeToolNames]);
    input.runtimeExtension.install(created.session, input.settingsManager.getCompactionSettings());
    return created.session;
  }

  private materializeTools(toolSet: AgentPiToolSet, frame: AgentPiMutableSessionFrame): ToolDefinition[] {
    return toolSet
      .materialize(() => projectAgentPiToolContext(frame.snapshot()))
      .map((tool) => ({
        ...tool,
        execute: (toolCallId, params, signal, onUpdate) => tool.execute(toolCallId, params, signal, onUpdate),
      }));
  }

  private createSettingsManager(): SettingsManager {
    const compaction = resolveAgentPiCompactionSettings(this.options.compaction, this.options.provider.model);
    return SettingsManager.inMemory({
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      compaction: { ...compaction },
      retry: {
        enabled: this.options.modelProvider.MaxNetworkRetries > 0,
        maxRetries: this.options.modelProvider.MaxNetworkRetries,
        provider: {
          timeoutMs: this.options.modelProvider.TimeoutMs,
          maxRetries: NativeProviderRetryAttempts,
        },
      },
    });
  }

  private async emitResourceDiagnostics(
    frame: AgentPiCodingAgentSessionFrame,
    resourceLoader: DefaultResourceLoader,
  ): Promise<void> {
    const diagnostics = resourceLoader.getSkills().diagnostics;
    if (diagnostics.length === 0) return;
    await emitAgentPiDiagnostic(frame.diagnostics ?? this.options.diagnostics, {
      context: agentPiDiagnosticContext(frame),
      source: AgentPiDiagnosticSources.Session,
      name: "resources.skills.diagnostics",
      details: diagnostics,
    });
  }

  private async emitSessionDiagnostic(frame: AgentPiCodingAgentSessionFrame, event: { type: string }): Promise<void> {
    if (!SessionDiagnosticEventTypes.has(event.type)) return;
    await emitAgentPiDiagnostic(frame.diagnostics ?? this.options.diagnostics, {
      context: agentPiDiagnosticContext(frame),
      source: AgentPiDiagnosticSources.Session,
      name: event.type,
      details: event,
    });
  }
}
