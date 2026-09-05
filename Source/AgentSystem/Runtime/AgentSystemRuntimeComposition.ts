import path from "node:path";
import process from "node:process";
import {
  resolveActionPlannerConfig,
  resolveAgentLoopConfig,
  resolveArtifactsConfig,
  resolveModelProviderConfig,
  resolvePresetsConfig,
  resolveSandboxRuntimeConfig,
  resolveToolExecutionConfig,
  resolveToolLearningConfig,
  resolveToolSearchConfig,
  resolveUploadsConfig,
  resolveVectorModelsConfig,
} from "../AgentDefaults.js";
import { AgentActionPlannerModelClient } from "../ActionPlanner/AgentActionPlannerModelClient.js";
import { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import { AgentToolExecutionArtifactRecorder } from "../Artifacts/AgentToolExecutionArtifactRecorder.js";
import { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import { AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import { AgentSchemaValidator } from "../Core/AgentSchemaValidator.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { createSeneraExecutionEnvironments } from "../Execution/SeneraExecutionEnvFactory.js";
import type { SeneraSandboxWorkerClient } from "../Execution/SeneraSandboxWorkerTypes.js";
import { AgentExecutionResourceBroker } from "../ExecutionResources/AgentExecutionResourceBroker.js";
import { resolveAgentExecutionResourceLimits } from "../ExecutionResources/AgentExecutionResourceConfig.js";
import { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";
import type { AgentPiDiagnosticSink } from "../Pi/AgentPiDiagnostics.js";
import { AgentPiSubstrate } from "../Pi/AgentPiSubstrate.js";
import { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import { AgentPresetManager } from "../Presets/AgentPresetManager.js";
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
import { AgentToolSearchRuntime } from "../ToolSearch/AgentToolSearchRuntime.js";
import type { AgentToolSearchMemoryStore } from "../ToolSearch/AgentToolSearchMemoryTypes.js";
import { AgentToolSemanticAuditModes, type AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { createXmlProtocolPolicy } from "../Xml/AgentXmlPolicy.js";
import { AgentRuntimeModuleComposer, type AgentRuntimeModule } from "./AgentRuntimeModule.js";
import { createDefaultAgentRuntimeServices } from "./AgentRuntimeServices.js";
import type { AgentMcpToolsChangedHandler } from "../Mcp/AgentMcpToolCatalogChange.js";
import { AgentMcpToolClientPool } from "../Mcp/AgentMcpToolClientPool.js";
import { AgentVectorModelClient } from "../Vector/AgentVectorModelClient.js";
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
import { AgentWorkflowPromptProjector } from "../Prompt/AgentWorkflowPromptProjector.js";
import type { AgentWorldSnapshotProvider } from "../World/AgentWorldTypes.js";
import type { AgentInferenceBudgetPort } from "../ModelEndpoints/AgentInferenceBudget.js";
import type { AgentIdentityTemplateValues } from "../Prompt/AgentIdentityTemplate.js";
import type { AgentAgendaService } from "../Agenda/AgentAgendaService.js";
import type { AgentContinuityIdentityContext } from "../Continuity/AgentContinuityIdentityStore.js";
import { AgentResidentSpeechRuntime } from "../ResidentSpeech/AgentResidentSpeechRuntime.js";
import { AgentResidentSpeechCapabilities } from "../ResidentSpeech/AgentResidentSpeechTypes.js";

export interface AgentSystemRuntimeCompositionOptions {
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
  toolSearchMemoryStore?: AgentToolSearchMemoryStore;
  onMcpToolsChanged?: AgentMcpToolsChangedHandler;
  mcpInputs?: AgentExtensionValueResolver;
  workspaceRuntime?: AgentWorkspaceRuntimeServices;
  mcpSampling?: AgentMcpSamplingHandler;
  orchestration?: AgentOrchestrationHostRuntime;
  continuityMemory?: AgentContinuityMemoryService;
  continuityIdentity?: AgentContinuityIdentityContext;
  continuityLifecycle?: AgentContinuityLifecyclePort;
  executionLedger?: AgentExecutionLedgerService;
  todos?: AgentTodoService;
  agenda?: AgentAgendaService;
  worldRuntime?: AgentWorldSnapshotProvider;
  inferenceBudget?: AgentInferenceBudgetPort;
  identityTemplateValues?: () => AgentIdentityTemplateValues;
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
  if (sandboxAvailable && (!sandboxProvider || !dockerEngineWorker)) {
    throw new Error("An available sandbox runtime requires an explicit Docker provider and Worker client.");
  }
  const executionResourceLimits = resolveAgentExecutionResourceLimits(options.config);
  const mcpClientPool = options.workspaceRuntime?.mcpClientPool ?? new AgentMcpToolClientPool();
  const uploadStore =
    options.workspaceRuntime?.uploadStore ??
    new AgentUploadStore({ workspaceRoot: options.workspaceRoot, config: resolveUploadsConfig(options.config) });
  const resourceResolver = new AgentResourceResolver({
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
  });
  const browserRuntime = new AgentBrowserRuntime({
    workspaceRoot: options.workspaceRoot,
    configuration: AgentBrowserConfigurationSchema.parse(
      options.config.Extensions?.["agent-browser"]?.Configuration ?? {},
    ),
  });
  const systemTools = createAgentSystemTools(options.config, options.modelProviderId, {
    browserRuntime,
  });
  const systemExtensions = new AgentSystemExtensionCatalog();
  systemExtensions.registerRoot(registry, path.join(resourcesRoot, "System", "Extensions"), {
    capabilities: new Set([...listDefaultAgentHostCapabilityNames(), ...systemTools.map(systemToolCapability)]),
    configurations: options.config.Extensions,
  });
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
    systemSkillToolBindings: systemExtensions.skillToolBindings(),
    systemMcpContributions: systemExtensions.listMcpContributions(),
    residentSpeech,
    agentLoopConfig: resolveAgentLoopConfig(options.config),
    toolSearchConfig: resolveToolSearchConfig(options.config),
    vectorModelsConfig: resolveVectorModelsConfig(options.config),
    toolLearningConfig: resolveToolLearningConfig(options.config),
    presetsConfig: resolvePresetsConfig(options.config),
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
  const continuityIdentity = options.continuityIdentity;
  const vectorClient = new AgentVectorModelClient(infrastructure.vectorModelsConfig, {
    inferenceBudget: options.inferenceBudget,
    inferenceBudgetScope:
      options.inferenceBudget && continuityIdentity ? () => continuityIdentity.workspaceId : undefined,
  });
  const embedding = infrastructure.vectorModelsConfig.Embedding.Enabled
    ? {
        client: vectorClient,
        model: infrastructure.vectorModelsConfig.Embedding.Model,
      }
    : undefined;
  const rerank = infrastructure.vectorModelsConfig.Rerank.Enabled ? { client: vectorClient } : undefined;
  const toolSearch = new AgentToolSearchRuntime(
    infrastructure.registry,
    infrastructure.toolSearchConfig,
    infrastructure.toolLearningConfig,
    options.workspaceRoot,
    infrastructure.modelProviderConfig,
    {
      logger: options.logger,
      memoryStore: options.toolSearchMemoryStore,
      embedding,
      rerank,
      availableExecutionTargets,
    },
  );
  const skillActivation = new AgentSkillActivationService(infrastructure.registry, toolSearch);
  const promptContextBuilder = new AgentPromptContextBuilder(
    infrastructure.registry,
    options.workspaceRoot,
    () => infrastructure.toolExecutionEnv.capabilities,
  );
  const toolCatalog = new AgentToolCatalogProjector(infrastructure.registry, availableExecutionTargets);
  const artifactRecorder = new AgentToolExecutionArtifactRecorder({
    workspaceRoot: options.workspaceRoot,
    config: infrastructure.artifactsConfig,
    model: infrastructure.modelProviderConfig.Model,
    logger: options.logger,
  });
  const presetManager = new AgentPresetManager({
    workspaceRoot: options.workspaceRoot,
    config: infrastructure.presetsConfig,
  });
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
    toolSearch,
    executionResources: infrastructure.executionResources,
    orchestration: options.orchestration,
  });
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
    identityTemplateValues: options.identityTemplateValues,
  });
  const piSubstrate = new AgentPiSubstrate({
    workspaceRoot: options.workspaceRoot,
    config: options.config,
    modelProvider: infrastructure.modelProviderConfig,
    planningCompilerFactory: createAgentPiPlanningModelAdapter(options.config, infrastructure.modelProviderConfig),
    residentSpeech: infrastructure.residentSpeech,
    registry: infrastructure.registry,
    toolCallExecutor,
    artifactRecorder,
    executionEnv: infrastructure.executionEnv,
    resourcesPath: options.resourcesPath,
    toolPermissionGate,
    diagnostics: options.piDiagnostics,
    uploadStore: infrastructure.uploadStore,
    beforeCompaction: options.continuityLifecycle
      ? (sessionId) => options.continuityLifecycle!.beforeCompaction(sessionId)
      : undefined,
  });
  const services = new AgentRuntimeModuleComposer().compose(
    createDefaultAgentRuntimeServices({
      artifactRecorder,
      toolCallExecutor,
      piSessionRegistry: infrastructure.piSessionRegistry,
      presetManager,
      promptContextBuilder,
      piSubstrate,
      skillActivation,
      toolCatalog,
      toolSearch,
      continuityMemory: options.continuityMemory,
      workflow: new AgentWorkflowPromptProjector({
        executionLedger: options.executionLedger,
        todos: options.todos,
        worldRuntime: options.worldRuntime,
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
    presetManager,
    toolPermissionGate,
    toolCallExecutor,
    piSubstrate,
    services,
  };
}
