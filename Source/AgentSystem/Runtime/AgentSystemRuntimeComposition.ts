import path from "node:path";
import process from "node:process";
import {
  resolveActionPlannerConfig,
  resolveAgentMcpConnectionsConfig,
  resolveAgentLoopConfig,
  resolveAgentPromptConfig,
  resolveArtifactsConfig,
  resolveModelProviderConfig,
  resolveSandboxRuntimeConfig,
  resolveStateCardConfig,
  resolveContinuityLearningConfig,
  resolveToolExecutionConfig,
  resolveToolSearchConfig,
  resolveUploadsConfig,
} from "../AgentDefaults.js";
import { AgentActionPlannerModelClient } from "../ActionPlanner/AgentActionPlannerModelClient.js";
import { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import { AgentToolExecutionArtifactRecorder } from "../Artifacts/AgentToolExecutionArtifactRecorder.js";
import { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import { AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import { AgentSchemaValidator } from "../Core/AgentSchemaValidator.js";
import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { registerAgentSkillCatalog } from "../Skills/AgentSkillCatalogRegistration.js";
import { createSeneraExecutionEnvironments } from "../Execution/SeneraExecutionEnvFactory.js";
import { resolveAgentDockerEngineGuestWorkspaceRoot } from "../Sandbox/DockerEngine/AgentDockerEngineRuntimeContract.js";
import type { SeneraSandboxWorkerClient } from "../Execution/SeneraSandboxWorkerTypes.js";
import { AgentExecutionResourceBroker } from "../ExecutionResources/AgentExecutionResourceBroker.js";
import { resolveAgentExecutionResourceLimits } from "../ExecutionResources/AgentExecutionResourceConfig.js";
import { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";
import type { AgentPiDiagnosticSink } from "../Pi/AgentPiDiagnostics.js";
import { AgentPiSubstrate } from "../Pi/AgentPiSubstrate.js";
import { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import { AgentPromptContextBuilder } from "../Prompt/AgentPromptContextBuilder.js";
import { AgentPromptRenderer } from "../Prompt/AgentPromptRenderer.js";
import { AgentPromptAssetCatalog } from "../Prompt/AgentPromptAssetCatalog.js";
import { AgentResourceAccessPolicy } from "../Safety/AgentResourceAccessPolicy.js";
import { createAgentBamlToolRiskAuditor } from "../Safety/AgentBamlToolRiskAuditor.js";
import { AgentSeneraOpaPolicyClient } from "../Safety/AgentSeneraOpaPolicyClient.js";
import { AgentToolPermissionGate } from "../Safety/AgentToolPermissionGate.js";
import { AgentSessionApprovalLeaseStore } from "../Safety/AgentSessionApprovalLeaseStore.js";
import { createAgentToolApprovalPolicy } from "../Safety/AgentToolApprovalPolicyFactory.js";
import type { AgentSandboxRuntimeProvider } from "../Sandbox/AgentSandboxRuntimeTypes.js";
import { AgentSkillActivationService } from "../Skills/AgentSkillActivation.js";
import {
  createDefaultHostCapabilityRegistry,
  listDefaultAgentHostCapabilityNames,
} from "../AgentDefaultHostCapabilities.js";
import { registerAgentSystemToolHandlers, systemToolCapability } from "../SystemTools/AgentSystemToolCatalog.js";
import { createAgentSystemTools } from "../SystemTools/AgentSystemTools.js";
import { AgentSystemExtensionCatalog } from "../SystemTools/AgentSystemToolSource.js";
import { AgentBrowserConfigurationSchema } from "../Browser/AgentBrowserConfiguration.js";
import { AgentBrowserRuntime } from "../Browser/AgentBrowserRuntime.js";
import { AgentModelTokenEstimator } from "../Text/AgentTextBudget.js";
import { AgentToolCallExecutor } from "../ToolRuntime/AgentToolCallExecutor.js";
import { AgentToolCatalogProjector } from "../ToolRuntime/AgentToolCatalogProjector.js";
import { createAgentDefaultToolResourceCapabilities } from "../ToolRuntime/AgentToolResourceCapabilities.js";
import { AgentToolResourceClaimProjector } from "../ToolRuntime/AgentToolResourceClaimProjector.js";
import type { AgentToolResourceLeaseCoordinator } from "../ToolRuntime/AgentToolResourceScheduler.js";
import { AgentToolSearchRuntime } from "../ToolSearch/AgentToolSearchRuntime.js";
import { AgentStateCardRuntime } from "../StateCard/AgentStateCardRuntime.js";
import { AgentLocalEmbeddingClient, AgentLocalEmbeddingModelName } from "../ToolSearch/AgentLocalEmbeddingClient.js";
import { AgentCapabilityEmbeddingFileStore } from "../ToolSearch/AgentCapabilityEmbeddingCache.js";
import type { AgentToolSearchScenarioSource } from "../ToolSearch/AgentToolSearchScenarioSource.js";
import { AgentToolSemanticAuditModes, type AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { createXmlProtocolPolicy } from "../Xml/AgentXmlPolicy.js";
import { AgentRuntimeModuleComposer, type AgentRuntimeModule } from "./AgentRuntimeModule.js";
import { createDefaultAgentRuntimeServices } from "./AgentRuntimeServices.js";
import type { AgentMcpToolsChangedHandler } from "../Mcp/AgentMcpToolCatalogChange.js";
import { AgentMcpToolClientPool } from "../Mcp/AgentMcpToolClientPool.js";
import type { AgentExtensionValueResolver } from "../Extensions/AgentExtensionValueExpression.js";
import type { AgentMcpSamplingHandler } from "../Mcp/AgentMcpSamplingRuntime.js";
import { createAgentMcpSamplingHandler } from "../Mcp/AgentMcpSamplingRuntime.js";
import type { AgentWorkspaceRuntimeServices } from "./AgentWorkspaceRuntime.js";
import { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import { AgentResourceResolver } from "../Resources/AgentResourceResolver.js";
import { createAgentPiPlanningModelAdapter } from "./AgentPiPlanningModelAdapter.js";
import type { AgentOrchestrationHostRuntime } from "../Orchestration/AgentOrchestrationHostTools.js";
import { projectSeneraProcessBackendsToToolTargets } from "../ToolRuntime/AgentToolExecutionPlan.js";
import type { AgentContinuityMemoryService } from "../Continuity/AgentContinuityMemoryService.js";
import type { AgentExecutionLedgerService } from "../Goals/AgentExecutionLedgerService.js";
import type { AgentTodoService } from "../Todos/AgentTodoService.js";
import type { AgentContinuityLifecyclePort } from "../Continuity/AgentContinuityLifecycle.js";
import type { AgentContinuityRecallService } from "../Continuity/AgentContinuityToolRuntime.js";
import { AgentWorkflowPromptProjector } from "../Prompt/AgentWorkflowPromptProjector.js";
import type { AgentInferenceBudgetPort } from "../ModelEndpoints/AgentInferenceBudget.js";
import type { AgentIdentityDisplayValues } from "../Text/AgentTextParts.js";
import type { AgentContinuityIdentityContext } from "../Continuity/AgentContinuityIdentityStore.js";
import { AgentResidentSpeechRuntime } from "../ResidentSpeech/AgentResidentSpeechRuntime.js";
import { AgentResidentSpeechCapabilities } from "../ResidentSpeech/AgentResidentSpeechTypes.js";
import type { AgentPluginHost } from "../Plugins/AgentPluginHost.js";
import type { AgentMcpHostCapabilitySnapshot } from "../McpPackages/AgentMcpHostRequirements.js";
import type { AgentBackgroundLearningRequestLedger } from "../Memory/AgentBackgroundLearningRequestLedger.js";
import type { AgentContinuityMemOSRuntime } from "../Continuity/AgentContinuityMemOSRuntime.js";
import type {
  AgentMcpActivationCatalogEntry,
  AgentMcpServiceDiscoveryEntry,
} from "../McpPackages/AgentMcpPackageTypes.js";
import type { AgentActivationCatalogEntryData } from "../Activation/AgentActivationTypes.js";
import { createAgentPersonaContext } from "../Prompt/AgentPersonaContext.js";

export interface AgentSystemRuntimeCompositionOptions {
  mcpServices?: () => readonly AgentMcpServiceDiscoveryEntry[];
  mcpActivationEntries?: () => readonly AgentMcpActivationCatalogEntry[];
  systemActivationEntries?: () => readonly AgentActivationCatalogEntryData[];
  workspaceRoot: string;
  configPath: string;
  config: AgentSystemConfig;
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
  sandboxRuntimeReady?: () => boolean;
  sandboxAvailable?: boolean;
  sandboxProvider?: AgentSandboxRuntimeProvider;
  dockerEngineWorker?: SeneraSandboxWorkerClient;
  /** Derived sandbox guest workspace root. Linux paths follow workspaceRoot; other hosts use the contract default. */
  sandboxGuestWorkspaceRoot?: string;
  toolSearchScenarioSource?: AgentToolSearchScenarioSource;
  onMcpToolsChanged?: AgentMcpToolsChangedHandler;
  mcpInputs?: AgentExtensionValueResolver;
  workspaceRuntime?: AgentWorkspaceRuntimeServices;
  mcpSampling?: AgentMcpSamplingHandler;
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
  /** Loaded plugin host whose tools/skills are applied to this composition's
   * registry; commands, hooks, and approval transports are process-level. */
  pluginHost?: AgentPluginHost;
  /** Shared with orchestration so delegated leases and Pi tool claims converge. */
  resourceCoordinator?: AgentToolResourceLeaseCoordinator;
  /** Shared durable ledger for temporal-memory and state-card model work. */
  learningRequests?: AgentBackgroundLearningRequestLedger;
  /** Host callback for query-driven publication of deferred capabilities. */
  beforeToolSearch?: (query: string, signal?: AbortSignal, serviceIds?: readonly string[]) => void | Promise<void>;
  /** Host capabilities used to preflight MCP packages before launch. */
  mcpHostCapabilities?: AgentMcpHostCapabilitySnapshot;
}

export function composeAgentSystemRuntime(options: AgentSystemRuntimeCompositionOptions) {
  const infrastructure = createAgentRuntimeInfrastructure(options);
  const agents = createAgentRuntimeAgentServices(options, infrastructure);
  return { infrastructure, agents };
}

export type AgentSystemRuntimeComposition = ReturnType<typeof composeAgentSystemRuntime>;
export type AgentRuntimeInfrastructure = ReturnType<typeof createAgentRuntimeInfrastructure>;

export function createAgentRuntimeInfrastructure(options: AgentSystemRuntimeCompositionOptions) {
  const registry = new AgentExtensionRegistry();
  const modelProviderConfig = resolveModelProviderConfig(options.config, options.modelProviderId);
  const resourcesRoot = path.resolve(options.resourcesPath ?? options.workspaceRoot);
  const approvalRuntime = options.approvalRuntime ?? new AgentApprovalRuntime();
  const interactionInput = options.interactionInput ?? new AgentInteractionInputRuntime();
  const piSessionRegistry = options.piSessionRegistry ?? new AgentPiActiveSessionRegistry();
  const authorizationPolicyClient = new AgentSeneraOpaPolicyClient({ registry });
  const sandboxRuntimeConfig = resolveSandboxRuntimeConfig(options.config);
  const sandboxEnabled =
    sandboxRuntimeConfig.Enabled && (process.platform !== "win32" || options.sandboxAvailable === true);
  const sandboxAvailable = sandboxEnabled && options.sandboxAvailable === true;
  const sandboxProvider = options.sandboxProvider;
  const dockerEngineWorker = options.dockerEngineWorker;
  const sandboxGuestWorkspaceRoot =
    sandboxAvailable && sandboxProvider
      ? (options.sandboxGuestWorkspaceRoot ??
        resolveAgentDockerEngineGuestWorkspaceRoot(options.workspaceRoot, sandboxProvider))
      : undefined;
  if (sandboxAvailable && (!sandboxProvider || !dockerEngineWorker)) {
    throw new Error("An available sandbox runtime requires an explicit Docker provider and Worker client.");
  }
  const executionResourceLimits = resolveAgentExecutionResourceLimits(options.config);
  const mcpClientPool =
    options.workspaceRuntime?.mcpClientPool ??
    new AgentMcpToolClientPool({
      policy: () => {
        const resolved = resolveAgentMcpConnectionsConfig(options.config);
        return { idleTtlMs: resolved.IdleTtlMs, sweepIntervalMs: resolved.SweepIntervalMs };
      },
      onCloseError: (error, connection) => {
        options.logger?.warn("mcp.connection.cleanup_failed", {
          serverId: connection.server.id,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
  const uploadStore =
    options.workspaceRuntime?.uploadStore ??
    new AgentUploadStore({ workspaceRoot: options.workspaceRoot, config: resolveUploadsConfig(options.config) });
  const resourceResolver = new AgentResourceResolver({
    artifactManifestIndex: options.workspaceRuntime?.artifactManifestIndex,
    workspaceRoot: options.workspaceRoot,
    config: options.config,
    uploadStore,
  });
  const mcpSampling = options.mcpSampling ?? createAgentMcpSamplingHandler(options.config, options.modelProviderId);
  const executionEnvironments = createSeneraExecutionEnvironments({
    workspaceRoot: options.workspaceRoot,
    resourcesPath: options.resourcesPath,
    sandboxAvailable,
    sandboxEnabled,
    sandboxRuntimeReady: options.sandboxRuntimeReady,
    sandboxProvider,
    dockerEngineWorker,
    environmentPolicy: resolveToolExecutionConfig(options.config).Environment,
    terminationGraceMs: executionResourceLimits.terminationGraceMs,
    resourceAccessPolicy: new AgentResourceAccessPolicy(authorizationPolicyClient),
    sandboxGuestWorkspaceRoot,
  });
  const resourceCapabilities = createAgentDefaultToolResourceCapabilities({
    config: options.config,
    workspaceRoot: options.workspaceRoot,
    executionEnv: executionEnvironments.tool,
    uploadStore,
  });
  const resourceClaims = new AgentToolResourceClaimProjector(resourceCapabilities);
  const browserRuntime = new AgentBrowserRuntime({
    workspaceRoot: options.workspaceRoot,
    configuration: AgentBrowserConfigurationSchema.parse(
      options.config.Extensions?.["agent-browser"]?.Configuration ?? {},
    ),
  });
  const systemTools = createAgentSystemTools(options.config, options.modelProviderId, {
    browserRuntime,
    selfService: options.selfService,
    approvalRuntime,
  });
  const systemExtensions = new AgentSystemExtensionCatalog();
  systemExtensions.registerRoot(registry, path.join(resourcesRoot, "System", "Extensions"), {
    capabilities: new Set([...listDefaultAgentHostCapabilityNames(), ...systemTools.map(systemToolCapability)]),
    configurations: options.config.Extensions,
  });
  options.pluginHost?.applyTools(registry);
  const skillDiagnostics = registerAgentSkillCatalog(registry, {
    systemRoot: path.join(resourcesRoot, "System", "Skills"),
    workspaceRoot: resolveAgentWorkspaceLayout(options.workspaceRoot).skillRoot,
    systemToolBindings: systemExtensions.skillToolBindings(),
  });
  for (const diagnostic of skillDiagnostics) {
    options.logger?.warn("resources.skills.invalid", { diagnostic });
  }
  new AgentPromptAssetCatalog().registerRoot(registry, path.join(resourcesRoot, "System", "Prompts"));
  const residentSpeech = AgentResidentSpeechCapabilities.some((capability) => registry.getSidecarTool(capability))
    ? new AgentResidentSpeechRuntime({ registry, modelProvider: modelProviderConfig })
    : undefined;

  return {
    registry,
    schemaValidator: new AgentSchemaValidator(),
    promptRenderer: new AgentPromptRenderer(),
    conversationPolicy: new AgentConversationPolicy(),
    conversationProjector: new AgentConversationProjector(),
    approvalRuntime,
    interactionInput,
    piSessionRegistry,
    authorizationPolicyClient,
    executionEnv: executionEnvironments.system,
    toolExecutionEnv: executionEnvironments.tool,
    resourceCapabilities,
    resourceClaims,
    sandboxGuestWorkspaceRoot,
    executionResources:
      options.executionResources ??
      new AgentExecutionResourceBroker({
        workspaceRoot: options.workspaceRoot,
        limits: executionResourceLimits,
      }),
    mcpClientPool,
    browserRuntime,
    uploadStore,
    resourceResolver,
    mcpSampling,
    mcpInputs: options.mcpInputs,
    ownsInteractionInput: !options.interactionInput,
    ownsExecutionResources: !options.executionResources,
    ownsMcpClientPool: !options.workspaceRuntime,
    modelProviderConfig,
    systemTools,
    systemMcpContributions: systemExtensions.listMcpContributions(),
    residentSpeech,
    agentLoopConfig: resolveAgentLoopConfig(options.config),
    toolSearchConfig: resolveToolSearchConfig(options.config),
    stateCardConfig: resolveStateCardConfig(options.config),
    promptConfig: resolveAgentPromptConfig(options.config),
    artifactsConfig: resolveArtifactsConfig(options.config),
    actionPlannerConfig: resolveActionPlannerConfig(options.config, options.modelProviderId),
    xmlPolicy: createXmlProtocolPolicy(options.config),
  };
}

export function createAgentRuntimeAgentServices(
  options: AgentSystemRuntimeCompositionOptions,
  infrastructure: AgentRuntimeInfrastructure,
) {
  const availableExecutionTargets = () =>
    projectSeneraProcessBackendsToToolTargets(infrastructure.toolExecutionEnv.capabilities.processBackends);
  const embedding = infrastructure.toolSearchConfig.Embedding.Enabled
    ? (() => {
        const workspaceEmbedding = options.workspaceRuntime?.embedding;
        const client = workspaceEmbedding?.client ?? new AgentLocalEmbeddingClient();
        const cacheStore = new AgentCapabilityEmbeddingFileStore(
          (options.workspaceRuntime?.layout ?? resolveAgentWorkspaceLayout(options.workspaceRoot)).caches
            .toolSearchEmbeddings,
          (error) =>
            options.logger?.warn("routing.embedding.cache_invalid", {
              message: error instanceof Error ? error.message : String(error),
            }),
        );
        return {
          client,
          model: workspaceEmbedding?.model ?? AgentLocalEmbeddingModelName,
          cacheStore,
          closeEmbedding: workspaceEmbedding ? undefined : () => Promise.resolve(client.close?.()),
        };
      })()
    : undefined;
  const semanticBudgets = resolveContinuityLearningConfig(options.config).MemOS;
  const stateCardRuntime = new AgentStateCardRuntime(
    infrastructure.modelProviderConfig,
    infrastructure.stateCardConfig,
    {
      maxRepairAttempts: infrastructure.actionPlannerConfig.MaxRepairAttempts,
      learningRequests: options.learningRequests,
      historyTurns: semanticBudgets.FragmentHistoryTurns,
      assistantPreviewTokens: semanticBudgets.AssistantPreviewTokens,
      ...(options.continuityMemOS
        ? { readHistory: options.continuityMemOS.readStateCardHistory.bind(options.continuityMemOS) }
        : {}),
    },
  );
  const toolSearch = new AgentToolSearchRuntime(
    infrastructure.registry,
    infrastructure.toolSearchConfig,
    options.workspaceRoot,
    infrastructure.modelProviderConfig,
    {
      logger: options.logger,
      scenarioSource: options.toolSearchScenarioSource,
      embedding,
      embeddingCacheStore: embedding?.cacheStore,
      closeEmbedding: embedding?.closeEmbedding,
      resourceDiscovery: infrastructure.resourceCapabilities,
      availableExecutionTargets,
      stateCardRuntime,
      memos: options.continuityMemOS,
      beforeSearch: options.beforeToolSearch,
      mcpServices: options.mcpServices,
    },
  );
  const skillActivation = new AgentSkillActivationService(infrastructure.registry, toolSearch);
  const promptContextBuilder = new AgentPromptContextBuilder(
    infrastructure.registry,
    infrastructure.modelProviderConfig.ToolPlanningMode,
    options.workspaceRoot,
    () => infrastructure.toolExecutionEnv.capabilities,
    infrastructure.sandboxGuestWorkspaceRoot,
    options.mcpServices,
  );
  const toolCatalog = new AgentToolCatalogProjector(infrastructure.registry, availableExecutionTargets);
  const artifactRecorder = new AgentToolExecutionArtifactRecorder({
    workspaceRoot: options.workspaceRoot,
    config: infrastructure.artifactsConfig,
    model: infrastructure.modelProviderConfig.Model,
    logger: options.logger,
  });
  const persona = createAgentPersonaContext(
    infrastructure.promptConfig.CorePersona,
    infrastructure.promptConfig.LanguageStyle,
  );
  const toolExecutionConfig = resolveToolExecutionConfig(options.config);
  const semanticAuditors =
    infrastructure.modelProviderConfig.ToolPlanningMode === "baml" &&
    toolExecutionConfig.SemanticAudit.Mode === AgentToolSemanticAuditModes.ApprovalSensitive
      ? [
          createAgentBamlToolRiskAuditor({
            client: new AgentActionPlannerModelClient(
              infrastructure.modelProviderConfig,
              infrastructure.actionPlannerConfig.Client,
              { maxRepairAttempts: infrastructure.actionPlannerConfig.MaxRepairAttempts },
            ),
            onFailure: (error) => options.logger?.warn("tool.semantic_audit.failed", { error }),
          }),
        ]
      : [];
  const toolPermissionGate = new AgentToolPermissionGate({
    policy: createAgentToolApprovalPolicy({
      registry: infrastructure.registry,
      policyClient: infrastructure.authorizationPolicyClient,
      semanticAuditors,
    }),
    approvalRuntime: infrastructure.approvalRuntime,
    sessionApprovals: options.sessionApprovals ?? new AgentSessionApprovalLeaseStore(),
    semanticAuditMode: toolExecutionConfig.SemanticAudit.Mode,
    toolPlanningMode: infrastructure.modelProviderConfig.ToolPlanningMode,
  });
  const hostCapabilities = createDefaultHostCapabilityRegistry({
    artifactManifestIndex: options.workspaceRuntime?.artifactManifestIndex,
    toolSearch,
    executionResources: infrastructure.executionResources,
    orchestration: options.orchestration,
    continuityRecall: options.continuityRecall,
  });
  options.orchestration?.delegation.bindResourceClaims(infrastructure.resourceClaims);
  registerAgentSystemToolHandlers(hostCapabilities, infrastructure.systemTools);
  const toolCallExecutor = new AgentToolCallExecutor({
    registry: infrastructure.registry,
    config: options.config,
    protocol: infrastructure.xmlPolicy.protocol,
    workspaceRoot: options.workspaceRoot,
    executionEnv: infrastructure.toolExecutionEnv,
    toolSearch,
    executionResources: infrastructure.executionResources,
    hostCapabilities,
    configPath: options.configPath,
    interactionInput: infrastructure.interactionInput,
    modelProviderId: options.modelProviderId,
    onMcpToolsChanged: options.onMcpToolsChanged,
    mcpClientPool: infrastructure.mcpClientPool,
    mcpSampling: infrastructure.mcpSampling,
    uploadStore: infrastructure.uploadStore,
    resourceResolver: infrastructure.resourceResolver,
    todoService: options.todos,
    continuityIdentity: options.continuityIdentity,
    identityDisplayValues: options.identityDisplayValues,
  });
  const piSubstrate = new AgentPiSubstrate({
    workspaceLayout: options.workspaceRuntime?.layout,
    workspaceRoot: options.workspaceRoot,
    config: options.config,
    modelProvider: infrastructure.modelProviderConfig,
    planningCompilerFactory: createAgentPiPlanningModelAdapter(options.config, infrastructure.modelProviderConfig),
    residentSpeech: infrastructure.residentSpeech,
    registry: infrastructure.registry,
    toolCallExecutor,
    workspaceChangeObserver: options.workspaceRuntime?.workspaceChangeObserver,
    artifactRecorder,
    executionEnv: infrastructure.executionEnv,
    resourceCapabilities: infrastructure.resourceCapabilities,
    resourceClaims: infrastructure.resourceClaims,
    resourceCoordinator: options.resourceCoordinator,
    resourcesPath: options.resourcesPath,
    toolPermissionGate,
    diagnostics: options.piDiagnostics,
    uploadStore: infrastructure.uploadStore,
    resourceResolver: infrastructure.resourceResolver,
    beforeCompaction: options.continuityLifecycle
      ? (sessionId) => options.continuityLifecycle!.beforeCompaction(sessionId)
      : undefined,
    afterCompaction: options.continuityLifecycle
      ? (sessionId) => options.continuityLifecycle!.afterCompaction?.(sessionId)
      : undefined,
    onSessionContextInvalidated: options.continuityLifecycle
      ? (sessionId) => options.continuityLifecycle!.invalidateSessionContext?.(sessionId)
      : options.continuityMemory
        ? (sessionId) => {
            options.continuityMemory!.invalidateSessionContext(sessionId);
          }
        : undefined,
    learningRequests: options.learningRequests,
  });
  const services = new AgentRuntimeModuleComposer().compose(
    createDefaultAgentRuntimeServices({
      artifactRecorder,
      toolCallExecutor,
      piSessionRegistry: infrastructure.piSessionRegistry,
      promptContextBuilder,
      piSubstrate,
      skillActivation,
      toolCatalog,
      toolSearch,
      continuityMemory: options.continuityMemory,
      workflow: new AgentWorkflowPromptProjector({
        executionLedger: options.executionLedger,
        todos: options.todos,
        delegation: options.orchestration?.delegation,
      }),
      executionLedger: options.executionLedger,
    }),
    options.runtimeModules ?? [],
  );

  return {
    tokenEstimator: new AgentModelTokenEstimator({ model: infrastructure.modelProviderConfig.Model }),
    promptContextBuilder,
    skillActivation,
    toolSearch,
    toolCatalog,
    artifactRecorder,
    persona,
    toolPermissionGate,
    toolCallExecutor,
    piSubstrate,
    services,
  };
}
