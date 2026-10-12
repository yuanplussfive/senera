import path from "node:path";
import type { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import { AgentConfigLoader } from "../Config/AgentConfigLoader.js";
import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { SeneraSandboxWorkerClient } from "../Execution/SeneraSandboxWorkerTypes.js";
import type { AgentExecutionResourceBroker } from "../ExecutionResources/AgentExecutionResourceBroker.js";
import type { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import type { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";
import type { AgentPiDiagnosticSink } from "../Pi/AgentPiDiagnostics.js";
import type { AgentSandboxRuntimeProvider } from "../Sandbox/AgentSandboxRuntimeTypes.js";
import { resolveAgentPromptConfig } from "../Defaults/AgentRuntimeDefaults.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentToolSearchScenarioSource } from "../ToolSearch/AgentToolSearchScenarioSource.js";
import type { AgentRuntimeModule } from "./AgentRuntimeModule.js";
import { AgentMcpPackageScanner, assertUniqueAgentMcpServerNames } from "../McpPackages/AgentMcpPackageScanner.js";
import { AgentMcpPackageDiscovery } from "../McpPackages/AgentMcpPackageDiscovery.js";
import { AgentMcpPackageSourceKinds } from "../McpPackages/AgentMcpPackageTypes.js";
import { isAgentMcpPackageToolNameForServer } from "../McpPackages/AgentMcpPackageIdentity.js";
import { AgentMcpPackageCatalog } from "../McpPackages/AgentMcpPackageCatalog.js";
import { AgentMcpPackageSchemaCache } from "../McpPackages/AgentMcpPackageSchemaCache.js";
import type { AgentMcpToolsChanged } from "../Mcp/AgentMcpToolCatalogChange.js";
import type { AgentExtensionValueResolver } from "../Extensions/AgentExtensionValueExpression.js";
import {
  composeAgentSystemRuntime,
  type AgentSystemRuntimeComposition,
  type AgentSystemRuntimeCompositionOptions,
} from "./AgentSystemRuntimeComposition.js";
import type { AgentWorkspaceRuntimeServices } from "./AgentWorkspaceRuntime.js";
import type { AgentSessionApprovalLeaseStore } from "../Safety/AgentSessionApprovalLeaseStore.js";
import type { AgentOrchestrationHostRuntime } from "../Orchestration/AgentOrchestrationHostTools.js";
import type { AgentContinuityMemoryService } from "../Continuity/AgentContinuityMemoryService.js";
import { AgentPromptTierRenderCache } from "../Prompt/AgentPromptTierRenderCache.js";
import type { AgentExecutionLedgerService } from "../Goals/AgentExecutionLedgerService.js";
import type { AgentTodoService } from "../Todos/AgentTodoService.js";
import type { AgentContinuityLifecyclePort } from "../Continuity/AgentContinuityLifecycle.js";
import type { AgentContinuityRecallService } from "../Continuity/AgentContinuityToolRuntime.js";
import type { AgentContinuityIdentityContext } from "../Continuity/AgentContinuityIdentityStore.js";
import type { AgentIdentityDisplayValues } from "../Text/AgentTextParts.js";
import type { AgentInferenceBudgetPort } from "../ModelEndpoints/AgentInferenceBudget.js";
import type { AgentPluginHost } from "../Plugins/AgentPluginHost.js";
import {
  assertAgentExplicitActivationsCurrent,
  createAgentActivationCatalog,
} from "../Activation/AgentActivationCatalog.js";
import type {
  AgentActivationCatalogEntryData,
  AgentActivationCatalogSnapshot,
  AgentExplicitActivationReference,
  AgentExplicitActivationSet,
} from "../Activation/AgentActivationTypes.js";
import { AgentSkillCatalogProjector } from "../Skills/AgentSkillCatalogProjector.js";
import type { AgentToolResourceLeaseCoordinator } from "../ToolRuntime/AgentToolResourceScheduler.js";
import type { AgentMcpHostCapabilitySnapshot } from "../McpPackages/AgentMcpHostRequirements.js";
import type { AgentContinuityMemOSRuntime } from "../Continuity/AgentContinuityMemOSRuntime.js";
import type { AgentMcpActivationCatalogEntry } from "../McpPackages/AgentMcpPackageTypes.js";

export interface AgentSystemRuntimeSharedOptions {
  modelProviderId?: string;
  runtimeModules?: readonly AgentRuntimeModule[];
  logger?: AgentLogger;
  piDiagnostics?: AgentPiDiagnosticSink;
  approvalRuntime?: AgentApprovalRuntime;
  sessionApprovals?: AgentSessionApprovalLeaseStore;
  interactionInput?: AgentInteractionInputRuntime;
  piSessionRegistry?: AgentPiActiveSessionRegistry;
  resourcesPath?: string;
  executionResources?: AgentExecutionResourceBroker;
  toolSearchScenarioSource?: AgentToolSearchScenarioSource;
  mcpInputs?: AgentExtensionValueResolver;
  workspaceRuntime?: AgentWorkspaceRuntimeServices;
  orchestration?: AgentOrchestrationHostRuntime;
  continuityMemory?: AgentContinuityMemoryService;
  continuityIdentity?: AgentContinuityIdentityContext;
  continuityLifecycle?: AgentContinuityLifecyclePort;
  continuityRecall?: AgentContinuityRecallService;
  continuityMemOS?: AgentContinuityMemOSRuntime;
  executionLedger?: AgentExecutionLedgerService;
  todos?: AgentTodoService;
  inferenceBudget?: AgentInferenceBudgetPort;
  identityDisplayValues?: () => AgentIdentityDisplayValues;
  /** Host services bound to the `senera` self-service command tool. */
  selfService?: import("../SelfService/AgentSelfServiceTypes.js").AgentSelfServicePort;
  /** Loaded plugin host; its tools/skills are applied per runtime composition. */
  pluginHost?: AgentPluginHost;
  resourceCoordinator?: AgentToolResourceLeaseCoordinator;
  mcpHostCapabilities?: AgentMcpHostCapabilitySnapshot;
  /** Shared management projection so composer and execution validate one catalog. */
  mcpActivationEntries?: () => readonly AgentMcpActivationCatalogEntry[];
  systemActivationEntries?: () => readonly AgentActivationCatalogEntryData[];
}

export interface AgentSystemRuntimeLoadOptions extends AgentSystemRuntimeSharedOptions {
  workspaceRoot?: string;
  configPath?: string;
}

export interface AgentSystemRuntimeFromConfigOptions extends AgentSystemRuntimeSharedOptions {
  workspaceRoot?: string;
  configPath?: string;
  config: AgentSystemConfig;
  sandboxRuntimeReady?: () => boolean;
  sandboxAvailable?: boolean;
  sandboxProvider?: AgentSandboxRuntimeProvider;
  dockerEngineWorker?: SeneraSandboxWorkerClient;
  sandboxGuestWorkspaceRoot?: string;
}

export class AgentSystemRuntime {
  readonly workspaceRoot: string;
  readonly configPath: string;
  readonly config: AgentSystemConfig;
  readonly modelProviderId: string | undefined;
  readonly runtimeModules: readonly AgentRuntimeModule[];
  readonly logger: AgentLogger | undefined;
  readonly piDiagnostics: AgentPiDiagnosticSink | undefined;
  readonly resourcesPath: string | undefined;
  private readonly composition: AgentSystemRuntimeComposition;
  private readonly mcpPackageCatalog: AgentMcpPackageCatalog;
  private readonly mcpSchemaCache: AgentMcpPackageSchemaCache;
  private readonly mcpHostCapabilities: AgentMcpHostCapabilitySnapshot | undefined;
  private readonly pluginHost: AgentPluginHost | undefined;
  private readonly mcpActivationEntries: (() => readonly AgentMcpActivationCatalogEntry[]) | undefined;
  private readonly systemActivationEntries: (() => readonly AgentActivationCatalogEntryData[]) | undefined;
  private readonly promptTierCache = new AgentPromptTierRenderCache();
  private closePromise: Promise<void> | undefined;
  private initialization: Promise<void> | undefined;
  private toolSearchPrewarm: AgentToolSearchPrewarmTask | undefined;

  private constructor(options: AgentSystemRuntimeCompositionOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.configPath = options.configPath;
    this.config = options.config;
    this.modelProviderId = options.modelProviderId;
    this.runtimeModules = options.runtimeModules ?? [];
    this.logger = options.logger;
    this.piDiagnostics = options.piDiagnostics;
    this.resourcesPath = options.resourcesPath;
    this.mcpHostCapabilities = options.mcpHostCapabilities;
    this.pluginHost = options.pluginHost;
    this.mcpActivationEntries = options.mcpActivationEntries;
    this.systemActivationEntries = options.systemActivationEntries;
    this.mcpSchemaCache = new AgentMcpPackageSchemaCache(
      (options.workspaceRuntime?.layout ?? resolveAgentWorkspaceLayout(this.workspaceRoot)).caches.mcpSchemas,
      this.logger,
    );
    this.composition = composeAgentSystemRuntime({
      ...options,
      onMcpToolsChanged: (change) => this.applyMcpToolsChanged(change),
      beforeToolSearch: (query, signal, services) => this.ensureMcpPackagesForQuery(query, signal, services),
      mcpServices: () => this.mcpPackageCatalog.services(),
    });
    this.mcpPackageCatalog = new AgentMcpPackageCatalog(
      this.registry,
      this.toolSearch,
      this.logger,
      this.mcpSchemaCache,
    );
  }

  get registry() {
    return this.composition.infrastructure.registry;
  }

  get schemaValidator() {
    return this.composition.infrastructure.schemaValidator;
  }

  get promptRenderer() {
    return this.composition.infrastructure.promptRenderer;
  }

  get conversationPolicy() {
    return this.composition.infrastructure.conversationPolicy;
  }

  get conversationProjector() {
    return this.composition.infrastructure.conversationProjector;
  }

  get approvalRuntime() {
    return this.composition.infrastructure.approvalRuntime;
  }

  get interactionInput() {
    return this.composition.infrastructure.interactionInput;
  }

  get piSessionRegistry() {
    return this.composition.infrastructure.piSessionRegistry;
  }

  get executionEnv() {
    return this.composition.infrastructure.executionEnv;
  }

  get toolExecutionEnv() {
    return this.composition.infrastructure.toolExecutionEnv;
  }

  get executionResources() {
    return this.composition.infrastructure.executionResources;
  }

  get uploadStore() {
    return this.composition.infrastructure.uploadStore;
  }

  get resourceResolver() {
    return this.composition.infrastructure.resourceResolver;
  }

  get modelProviderConfig() {
    return this.composition.infrastructure.modelProviderConfig;
  }

  get agentLoopConfig() {
    return this.composition.infrastructure.agentLoopConfig;
  }

  get promptConfig() {
    return resolveAgentPromptConfig(this.config);
  }

  get toolSearchConfig() {
    return this.composition.infrastructure.toolSearchConfig;
  }

  get artifactsConfig() {
    return this.composition.infrastructure.artifactsConfig;
  }

  get actionPlannerConfig() {
    return this.composition.infrastructure.actionPlannerConfig;
  }

  get xmlPolicy() {
    return this.composition.infrastructure.xmlPolicy;
  }

  get tokenEstimator() {
    return this.composition.agents.tokenEstimator;
  }

  get promptContextBuilder() {
    return this.composition.agents.promptContextBuilder;
  }

  get promptTierRenderCache(): AgentPromptTierRenderCache {
    return this.promptTierCache;
  }

  get skillActivation() {
    return this.composition.agents.skillActivation;
  }

  get toolSearch() {
    return this.composition.agents.toolSearch;
  }

  get toolCatalog() {
    return this.composition.agents.toolCatalog;
  }

  get artifactRecorder() {
    return this.composition.agents.artifactRecorder;
  }

  get toolPermissionGate() {
    return this.composition.agents.toolPermissionGate;
  }

  get toolCallExecutor() {
    return this.composition.agents.toolCallExecutor;
  }

  get piSubstrate() {
    return this.composition.agents.piSubstrate;
  }

  get services() {
    return this.composition.agents.services;
  }

  /** Current @ activation catalog projected from this runtime's live registry. */
  activationCatalog(): AgentActivationCatalogSnapshot {
    if (!this.pluginHost || !this.mcpActivationEntries || !this.systemActivationEntries) {
      throw new Error("The live activation catalog is unavailable in this runtime.");
    }
    return createAgentActivationCatalog(
      new AgentSkillCatalogProjector(this.registry).list(),
      this.pluginHost.list(),
      this.mcpActivationEntries(),
      this.systemActivationEntries(),
    );
  }

  /** Rejects stale composer selections before preparation or cache reuse. */
  validateExplicitActivations(activations: AgentExplicitActivationSet | undefined): void {
    if (!activations) return;
    assertAgentExplicitActivationsCurrent(activations, this.activationCatalog());
  }

  initialize(): Promise<void> {
    return (this.initialization ??= this.initializeMcpPackages());
  }

  /** Discovers explicitly selected deferred MCP servers before validation. */
  async ensureExplicitActivationCapabilities(
    activations: readonly AgentExplicitActivationReference[] | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    const serverIds = (activations ?? [])
      .filter((activation) => activation.kind === "mcp")
      .map((activation) => activation.id);
    if (serverIds.length === 0) return;
    await this.mcpPackageCatalog.discoverServices([...new Set(serverIds)], signal);
  }

  close(): Promise<void> {
    return (this.closePromise ??= this.closeResources());
  }

  static load(options: AgentSystemRuntimeLoadOptions = {}): AgentSystemRuntime {
    const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
    const configPath = path.resolve(workspaceRoot, options.configPath ?? "senera.config.json");
    return this.create({
      ...options,
      workspaceRoot,
      configPath,
      config: AgentConfigLoader.load(configPath),
    });
  }

  static fromConfig(options: AgentSystemRuntimeFromConfigOptions): AgentSystemRuntime {
    const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
    const configPath = path.resolve(workspaceRoot, options.configPath ?? "senera.config.json");
    return this.create({ ...options, workspaceRoot, configPath });
  }

  private static create(options: AgentSystemRuntimeCompositionOptions): AgentSystemRuntime {
    const runtime = new AgentSystemRuntime(options);
    // Capability vectors are content-addressed. Start with the static catalog
    // while MCP discovery is doing I/O; a later catalog revision retains these
    // vectors and derives only newly discovered capabilities. This overlaps
    // cold CPU work with startup rather than putting it on the first search.
    runtime.scheduleToolSearchPrewarm();
    return runtime;
  }

  private async initializeMcpPackages(): Promise<void> {
    const resourcesRoot = path.resolve(this.resourcesPath ?? this.workspaceRoot);
    const workspaceLayout = resolveAgentWorkspaceLayout(this.workspaceRoot);
    const scanner = new AgentMcpPackageScanner();
    const packages = [
      ...scanner.scanRoot(path.join(resourcesRoot, "McpServers"), AgentMcpPackageSourceKinds.Bundled),
      ...this.composition.infrastructure.systemMcpContributions.map((contribution) =>
        scanner.readPackage(
          path.dirname(contribution.descriptorPath),
          AgentMcpPackageSourceKinds.Bundled,
          contribution.extensionId,
        ),
      ),
      ...scanner.scanRoot(workspaceLayout.mcpRoot, AgentMcpPackageSourceKinds.Workspace),
    ];
    assertUniqueAgentMcpServerNames(packages);
    this.mcpPackageCatalog.registerPackages(packages);
    const packageDiscovery = new AgentMcpPackageDiscovery(this.config, this.executionEnv, {
      clientPool: this.composition.infrastructure.mcpClientPool,
      sampling: this.composition.infrastructure.mcpSampling,
      onToolsChanged: (change) => this.applyMcpToolsChanged(change),
      inputs: this.composition.infrastructure.mcpInputs,
      hostCapabilities: this.mcpHostCapabilities,
      schemaCache: this.mcpSchemaCache,
      logger: this.logger,
    });
    const discovery = await packageDiscovery.discoverCached(packages);
    this.mcpPackageCatalog.recordDiscoveryIssues(discovery);
    if (discovery.failures.length > 0) {
      this.logger?.warn("mcp.discovery.failed", {
        failures: discovery.failures.map((failure) => ({
          packageName: failure.packageName,
          serverName: failure.serverName,
          error: failure.error,
        })),
      });
    }
    if (discovery.unavailableServers.length > 0) {
      this.logger?.info("mcp.discovery.skipped", {
        servers: discovery.unavailableServers,
      });
    }
    const deferredMcpServerNames = new Set([
      ...discovery.deferredServers.map((server) => server.server.name),
      ...discovery.unavailableServers.map((server) => server.serverName),
      ...discovery.failures.map((failure) => failure.serverName),
    ]);
    await this.mcpPackageCatalog.install(discovery.servers, {
      isDeferredToolReference: (toolName) =>
        [...deferredMcpServerNames].some((serverName) => isAgentMcpPackageToolNameForServer(toolName, serverName)),
    });
    this.mcpPackageCatalog.registerDeferred(
      [...discovery.deferredServers, ...discovery.servers],
      {
        discover: (server, signal) =>
          packageDiscovery.discover(
            [
              {
                ...server.package_,
                servers: [server.server],
              },
            ],
            signal,
          ),
      },
      {
        isDeferredToolReference: (toolName) =>
          [...deferredMcpServerNames].some((serverName) => isAgentMcpPackageToolNameForServer(toolName, serverName)),
      },
    );
    this.logger?.info("mcp.discovery.deferred", {
      servers: discovery.deferredServers.map((server) => server.server.name),
      cachedServers: discovery.servers.map((server) => server.server.name),
    });
    // The active prewarm detects the revised catalog and retains any static
    // content-addressed vectors it already completed. If it finished during
    // discovery, this schedules just the missing MCP-derived inputs.
    this.scheduleToolSearchPrewarm();
  }

  private async ensureMcpPackagesForQuery(
    _query: string,
    signal?: AbortSignal,
    serviceIds?: readonly string[],
  ): Promise<void> {
    if (!serviceIds) throw new Error("MCP discovery requires a selection from the authorized capability catalog.");
    await this.mcpPackageCatalog.discoverServices(serviceIds, signal);
  }

  private async applyMcpToolsChanged(change: AgentMcpToolsChanged): Promise<void> {
    await this.mcpPackageCatalog.update(change);
    this.scheduleToolSearchPrewarm();
  }

  private scheduleToolSearchPrewarm(): void {
    if (this.closePromise || this.toolSearchPrewarm) return;

    const controller = new AbortController();
    const task: AgentToolSearchPrewarmTask = {
      controller,
      promise: yieldAgentToolSearchPrewarm()
        .then(() => this.prewarmToolSearch(controller.signal))
        .finally(() => {
          if (this.toolSearchPrewarm === task) this.toolSearchPrewarm = undefined;
        }),
    };
    this.toolSearchPrewarm = task;
  }

  private async prewarmToolSearch(signal: AbortSignal): Promise<void> {
    try {
      await this.toolSearch.prewarm(signal);
    } catch (error) {
      if (signal.aborted) return;
      this.logger?.warn("routing.embedding.prewarm_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async closeResources(): Promise<void> {
    const prewarm = this.stopToolSearchPrewarm();
    const infrastructure = this.composition.infrastructure;
    const closeOperations: Array<() => void | Promise<void>> = [
      () => this.piSubstrate.close(),
      () => this.toolCallExecutor.close(),
      () => infrastructure.browserRuntime.close(),
      ...(infrastructure.ownsMcpClientPool ? [() => infrastructure.mcpClientPool.close()] : []),
      () => this.toolSearch.close(),
      ...(infrastructure.ownsInteractionInput ? [() => this.interactionInput.close()] : []),
      ...(infrastructure.ownsExecutionResources ? [() => this.executionResources.close()] : []),
    ];
    const failures: unknown[] = [];
    try {
      await prewarm;
    } catch (error) {
      failures.push(error);
    }
    for (const close of closeOperations) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Agent runtime shutdown failed.");
  }

  private stopToolSearchPrewarm(): Promise<void> {
    const task = this.toolSearchPrewarm;
    if (!task) return Promise.resolve();
    task.controller.abort("Agent runtime is closing.");
    return task.promise;
  }
}

interface AgentToolSearchPrewarmTask {
  readonly controller: AbortController;
  readonly promise: Promise<void>;
}

function yieldAgentToolSearchPrewarm(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
