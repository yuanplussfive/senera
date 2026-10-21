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
import { projectAgentPiActivatedSkills, projectAgentPiSkillCatalog } from "./AgentPiSkillCatalog.js";
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
  private readonly runtimeExtensions: AgentPiRuntimeExtensionFactory;
  private readonly compactionSettings: ReturnType<typeof resolveAgentPiCompactionSettings>;

  constructor(private readonly options: AgentPiCodingAgentSessionPoolOptions) {
    this.workspaceLayout = options.workspaceLayout ?? resolveAgentWorkspaceLayout(options.workspaceRoot);
    this.runtimeExtensions = new AgentPiRuntimeExtensionFactory(options);
    this.compactionSettings = resolveAgentPiCompactionSettings(options.compaction, options.provider.model);
  }

  async create(
    input: AgentPiCodingAgentLeaseInput,
    sessionManager: SessionManager,
    lastAccess: number,
  ): Promise<AgentPiPooledCodingSession> {
    const frame = new AgentPiMutableSessionFrame(input.frame);
    const settingsManager = this.createSettingsManager();
    const projectContext = this.createProjectContext();
    const projectSnapshot = projectContext.refresh();
    const runtimeExtension = this.runtimeExtensions.create(frame, sessionManager);
    const resourceLoader = this.createResourceLoader(
      settingsManager,
      input.inheritProjectContext,
      runtimeExtension,
      frame,
      projectContext,
    );
    await resourceLoader.reload();
    frame.update(input.frame, projectAgentPiActivatedSkills(input.frame.activeSkills));
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
      registerDiscoveredTools: runtimeExtension.registerTools,
      session,
      sessionManager,
      frame,
      resourceLoader,
      projectContext,
      toolFingerprint: input.allTools.fingerprint,
      skillCatalogFingerprint: input.frame.skillCatalog.fingerprint,
      projectContextFingerprint: projectSnapshot.fingerprint,
      inheritProjectContext: input.inheritProjectContext,
      lastAccess,
    });
    this.bindToolExposure(pooled, input.frame.toolExposure, input.activeToolNames, input.allTools);
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
      personaActive: false,
      skillCatalog: projectAgentPiSkillCatalog([]),
      nativeProviderToolNames: [],
      toolAccessGrant,
      toolExposure: new AgentToolExposureState(toolAccessGrant),
      selectedPromptTemplates: [],
      tokenBudget: new AgentTurnTokenBudget({
        model: this.options.provider.model.id,
        contextWindowTokens: this.compactionSettings.contextWindowTokens,
        inputCapacityTokens: this.compactionSettings.inputCapacityTokens,
        windowHeadroomTokens: this.compactionSettings.reserveTokens,
      }),
      preflight: () => Promise.resolve(undefined),
    };
    const frame = new AgentPiMutableSessionFrame(frameValue);
    const settingsManager = this.createSettingsManager();
    const projectContext = this.createProjectContext();
    const projectSnapshot = projectContext.refresh();
    const runtimeExtension = this.runtimeExtensions.create(frame, sessionManager);
    const resourceLoader = this.createResourceLoader(settingsManager, true, runtimeExtension, frame, projectContext);
    await resourceLoader.reload();
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
      registerDiscoveredTools: runtimeExtension.registerTools,
      session,
      sessionManager,
      frame,
      resourceLoader,
      projectContext,
      toolFingerprint: "",
      skillCatalogFingerprint: frameValue.skillCatalog.fingerprint,
      projectContextFingerprint: projectSnapshot.fingerprint,
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
    const projectContext = pooled.projectContext.refresh();
    const resourcesChanged =
      pooled.skillCatalogFingerprint !== input.frame.skillCatalog.fingerprint ||
      pooled.projectContextFingerprint !== projectContext.fingerprint;
    pooled.frame.update(input.frame, projectAgentPiActivatedSkills(input.frame.activeSkills));
    if (resourcesChanged) {
      await pooled.session.reload();
      pooled.skillCatalogFingerprint = input.frame.skillCatalog.fingerprint;
      pooled.projectContextFingerprint = projectContext.fingerprint;
    }
    this.bindToolExposure(pooled, input.frame.toolExposure, input.activeToolNames, input.allTools);
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
    allTools?: AgentPiToolSet,
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
      if (allTools) {
        const registered = new Set(pooled.session.getAllTools().map((tool) => tool.name));
        const discovered = this.materializeTools(allTools.refresh(), pooled.frame).filter(
          (tool) => !registered.has(tool.name) && snapshot.exposedToolNames.includes(tool.name),
        );
        pooled.registerDiscoveredTools(discovered);
      }
      pooled.session.setActiveToolsByName([...snapshot.exposedToolNames]);
    });
    pooled.session.setActiveToolsByName([...exposure.snapshot().exposedToolNames]);
  }

  private createResourceLoader(
    settingsManager: SettingsManager,
    inheritProjectContext: boolean,
    runtimeExtension: AgentPiRuntimeExtensionRegistration,
    frame: AgentPiMutableSessionFrame,
    projectContext: AgentPiProjectContext,
  ): DefaultResourceLoader {
    return new DefaultResourceLoader({
      cwd: this.options.workspaceRoot,
      agentDir: this.workspaceLayout.stateRoot,
      settingsManager,
      systemPrompt: this.options.systemPromptPath,
      noSkills: true,
      skillsOverride: () => ({ skills: [...frame.snapshot().skillCatalog.skills], diagnostics: [] }),
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      agentsFilesOverride: () => (inheritProjectContext ? projectContext.agentsFiles() : { agentsFiles: [] }),
      extensionFactories: [runtimeExtension],
    });
  }

  private createProjectContext(): AgentPiProjectContext {
    return new AgentPiProjectContext(this.workspaceLayout.projectContextFile, {
      cwd: this.options.workspaceRoot,
      agentDir: this.workspaceLayout.stateRoot,
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
    return SettingsManager.inMemory({
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      compaction: {
        enabled: this.compactionSettings.enabled,
        reserveTokens: this.compactionSettings.reserveTokens,
        keepRecentTokens: this.compactionSettings.keepRecentTokens,
      },
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
