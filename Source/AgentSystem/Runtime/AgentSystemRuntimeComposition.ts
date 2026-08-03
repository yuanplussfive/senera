import path from "node:path";
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
import type { SeneraGvisorWorkerClient } from "../Execution/SeneraGvisorTypes.js";
import type { SeneraMicrosandboxSdkAdapter } from "../Execution/SeneraMicrosandboxTypes.js";
import { AgentExecutionResourceBroker } from "../ExecutionResources/AgentExecutionResourceBroker.js";
import { resolveAgentExecutionResourceLimits } from "../ExecutionResources/AgentExecutionResourceConfig.js";
import { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";
import { AgentPiToolObservationDigester } from "../Pi/AgentPiToolObservationDigester.js";
import type { AgentPiDiagnosticSink } from "../Pi/AgentPiDiagnostics.js";
import { AgentPiSubstrate } from "../Pi/AgentPiSubstrate.js";
import { resolveAgentPiModelMaxTokens } from "../Pi/AgentPiModelProjector.js";
import { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import { AgentPresetManager } from "../Presets/AgentPresetManager.js";
import { AgentPromptContextBuilder } from "../Prompt/AgentPromptContextBuilder.js";
import { AgentPromptRenderer } from "../Prompt/AgentPromptRenderer.js";
import { AgentPromptAssetCatalog } from "../Prompt/AgentPromptAssetCatalog.js";
import { AgentResourceAccessPolicy } from "../Safety/AgentResourceAccessPolicy.js";
import { createAgentBamlToolRiskAuditor } from "../Safety/AgentBamlToolRiskAuditor.js";
import { AgentSeneraOpaPolicyClient } from "../Safety/AgentSeneraOpaPolicyClient.js";
import { AgentToolPermissionGate } from "../Safety/AgentToolPermissionGate.js";
import { createAgentToolApprovalPolicy } from "../Safety/AgentToolApprovalPolicyFactory.js";
import { selectAgentSandboxProvider } from "../Sandbox/AgentSandboxProviderSelection.js";
import {
  readAgentSandboxDistributionContract,
  resolveAgentSandboxDistributionTarget,
} from "../Sandbox/AgentSandboxDistributionContract.js";
import { resolveAgentSandboxRuntimePaths } from "../Sandbox/AgentSandboxRuntimePreparation.js";
import { AgentSandboxRuntimeProviders, type AgentSandboxRuntimeProvider } from "../Sandbox/AgentSandboxRuntimeTypes.js";
import { AgentGvisorWorkerSocketClient } from "../Sandbox/Gvisor/AgentGvisorWorkerClient.js";
import { resolveAgentGvisorWorkerSocketPath } from "../Sandbox/Gvisor/AgentGvisorRuntimePreparation.js";
import { AgentSkillActivationService } from "../Skills/AgentSkillActivation.js";
import {
  createDefaultHostCapabilityRegistry,
  listDefaultAgentHostCapabilityNames,
} from "../AgentDefaultHostCapabilities.js";
import { registerAgentSystemToolHandlers, systemToolCapability } from "../SystemTools/AgentSystemToolCatalog.js";
import { createAgentSystemTools } from "../SystemTools/AgentSystemTools.js";
import { AgentSystemExtensionCatalog } from "../SystemTools/AgentSystemToolSource.js";
import { AgentModelTokenEstimator } from "../Text/AgentTextBudget.js";
import { AgentToolCallExecutor } from "../ToolRuntime/AgentToolCallExecutor.js";
import { AgentToolCatalogProjector } from "../ToolRuntime/AgentToolCatalogProjector.js";
import { AgentToolSearchRuntime } from "../ToolSearch/AgentToolSearchRuntime.js";
import type { AgentToolSearchMemoryStore } from "../ToolSearch/AgentToolSearchMemoryTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { createXmlProtocolPolicy } from "../Xml/AgentXmlPolicy.js";
import { AgentRuntimeModuleComposer, type AgentRuntimeModule } from "./AgentRuntimeModule.js";
import { createDefaultAgentRuntimeServices } from "./AgentRuntimeServices.js";
import type { AgentMcpToolsChangedHandler } from "../Mcp/AgentMcpToolCatalogChange.js";
import { AgentMcpToolClientPool } from "../Mcp/AgentMcpToolClientPool.js";
import { AgentVectorModelClient } from "../Vector/AgentVectorModelClient.js";
import type { AgentExtensionValueResolver } from "../Extensions/AgentExtensionValueExpression.js";
import { AgentPiTurnContextRegistry, type AgentPiTurnContextStore } from "../PiShared/AgentPiTurnContext.js";
import type { AgentMcpSamplingHandler } from "../Mcp/AgentMcpSamplingRuntime.js";
import { createAgentMcpSamplingHandler } from "../Mcp/AgentMcpSamplingRuntime.js";
import type { AgentWorkspaceRuntimeServices } from "./AgentWorkspaceRuntime.js";
import { AgentUploadStore } from "../Uploads/AgentUploadStore.js";

export interface AgentSystemRuntimeCompositionOptions {
  workspaceRoot: string;
  configPath: string;
  config: AgentSystemConfig;
  modelProviderId?: string;
  runtimeModules?: readonly AgentRuntimeModule[];
  logger?: AgentLogger;
  piDiagnostics?: AgentPiDiagnosticSink;
  approvalRuntime?: AgentApprovalRuntime;
  interactionInput?: AgentInteractionInputRuntime;
  piSessionRegistry?: AgentPiActiveSessionRegistry;
  resourcesPath?: string;
  executionResources?: AgentExecutionResourceBroker;
  sandboxRuntimeReady?: () => boolean;
  microsandboxSdk?: SeneraMicrosandboxSdkAdapter;
  sandboxProvider?: AgentSandboxRuntimeProvider;
  gvisorWorker?: SeneraGvisorWorkerClient;
  toolSearchMemoryStore?: AgentToolSearchMemoryStore;
  onMcpToolsChanged?: AgentMcpToolsChangedHandler;
  mcpInputs?: AgentExtensionValueResolver;
  piTurnContexts?: AgentPiTurnContextStore;
  workspaceRuntime?: AgentWorkspaceRuntimeServices;
  mcpSampling?: AgentMcpSamplingHandler;
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
  const systemTools = createAgentSystemTools(options.config, options.modelProviderId);
  const resourcesRoot = path.resolve(options.resourcesPath ?? options.workspaceRoot);
  const systemExtensions = new AgentSystemExtensionCatalog();
  systemExtensions.registerRoot(registry, path.join(resourcesRoot, "System", "Extensions"), {
    capabilities: new Set([...listDefaultAgentHostCapabilityNames(), ...systemTools.map(systemToolCapability)]),
    configurations: options.config.Extensions,
  });
  new AgentPromptAssetCatalog().registerRoot(registry, path.join(resourcesRoot, "System", "Prompts"));
  const approvalRuntime = options.approvalRuntime ?? new AgentApprovalRuntime();
  const interactionInput = options.interactionInput ?? new AgentInteractionInputRuntime();
  const piSessionRegistry = options.piSessionRegistry ?? new AgentPiActiveSessionRegistry();
  const piTurnContexts = options.piTurnContexts ?? new AgentPiTurnContextRegistry();
  const authorizationPolicyClient = new AgentSeneraOpaPolicyClient({ registry });
  const sandboxRuntimeConfig = resolveSandboxRuntimeConfig(options.config);
  const sandboxRuntimePaths = tryResolveSandboxRuntimePaths(options.workspaceRoot, sandboxRuntimeConfig);
  const sandboxProvider =
    options.sandboxProvider ?? selectAgentSandboxProvider({ preference: sandboxRuntimeConfig.Provider });
  const gvisorWorker =
    options.gvisorWorker ??
    (sandboxProvider === AgentSandboxRuntimeProviders.Gvisor ||
    sandboxProvider === AgentSandboxRuntimeProviders.DockerEngine
      ? new AgentGvisorWorkerSocketClient({
          socketPath: resolveAgentGvisorWorkerSocketPath(options.workspaceRoot, sandboxRuntimeConfig),
        })
      : undefined);
  const executionResourceLimits = resolveAgentExecutionResourceLimits(options.config);
  const mcpClientPool = options.workspaceRuntime?.mcpClientPool ?? new AgentMcpToolClientPool();
  const uploadStore =
    options.workspaceRuntime?.uploadStore ??
    new AgentUploadStore({ workspaceRoot: options.workspaceRoot, config: resolveUploadsConfig(options.config) });
  const mcpSampling = options.mcpSampling ?? createAgentMcpSamplingHandler(options.config, options.modelProviderId);
  const executionEnvironments = createSeneraExecutionEnvironments({
    workspaceRoot: options.workspaceRoot,
    resourcesPath: options.resourcesPath,
    sandboxRuntimePaths,
    sandboxEnabled: sandboxRuntimeConfig.Enabled,
    sandboxRuntimeReady: options.sandboxRuntimeReady,
    microsandboxSdk: options.microsandboxSdk,
    sandboxProvider,
    gvisorWorker,
    microsandboxSettings: resolveRuntimeMicrosandboxSettings(sandboxRuntimeConfig),
    environmentPolicy: resolveToolExecutionConfig(options.config).Environment,
    terminationGraceMs: executionResourceLimits.terminationGraceMs,
    resourceAccessPolicy: new AgentResourceAccessPolicy(authorizationPolicyClient),
  });

  return {
    registry,
    schemaValidator: new AgentSchemaValidator(),
    promptRenderer: new AgentPromptRenderer(),
    conversationPolicy: new AgentConversationPolicy(),
    conversationProjector: new AgentConversationProjector(),
    approvalRuntime,
    interactionInput,
    piSessionRegistry,
    piTurnContexts,
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
    uploadStore,
    mcpSampling,
    mcpInputs: options.mcpInputs,
    ownsInteractionInput: !options.interactionInput,
    ownsExecutionResources: !options.executionResources,
    ownsMcpClientPool: !options.workspaceRuntime,
    modelProviderConfig,
    systemTools,
    systemSkillToolBindings: systemExtensions.skillToolBindings(),
    systemMcpContributions: systemExtensions.listMcpContributions(),
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
  const vectorClient = new AgentVectorModelClient(infrastructure.vectorModelsConfig);
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
    },
  );
  const skillActivation = new AgentSkillActivationService(infrastructure.registry, toolSearch);
  const promptContextBuilder = new AgentPromptContextBuilder(infrastructure.registry, options.workspaceRoot);
  const toolCatalog = new AgentToolCatalogProjector(infrastructure.registry);
  const artifactRecorder = new AgentToolExecutionArtifactRecorder({
    workspaceRoot: options.workspaceRoot,
    config: infrastructure.artifactsConfig,
    model: infrastructure.modelProviderConfig.Model,
  });
  const presetManager = new AgentPresetManager({
    workspaceRoot: options.workspaceRoot,
    config: infrastructure.presetsConfig,
  });
  const toolPermissionGate = new AgentToolPermissionGate({
    policy: createAgentToolApprovalPolicy({
      registry: infrastructure.registry,
      policyClient: infrastructure.authorizationPolicyClient,
      auditors: [
        createAgentBamlToolRiskAuditor({
          client: new AgentActionPlannerModelClient(
            infrastructure.modelProviderConfig,
            infrastructure.actionPlannerConfig.Client,
            { maxRepairAttempts: infrastructure.actionPlannerConfig.MaxRepairAttempts },
          ),
        }),
      ],
    }),
    approvalRuntime: infrastructure.approvalRuntime,
  });
  const hostCapabilities = createDefaultHostCapabilityRegistry({
    toolSearch,
    executionResources: infrastructure.executionResources,
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
    emitLifecycleEvents: false,
    interactionInput: infrastructure.interactionInput,
    modelProviderId: options.modelProviderId,
    onMcpToolsChanged: options.onMcpToolsChanged,
    mcpClientPool: infrastructure.mcpClientPool,
    mcpSampling: infrastructure.mcpSampling,
    uploadStore: infrastructure.uploadStore,
  });
  const observationModelClient = new AgentActionPlannerModelClient(
    infrastructure.modelProviderConfig,
    {
      ...infrastructure.actionPlannerConfig.Client,
      Temperature: 0,
      MaxTokens: resolveAgentPiModelMaxTokens(infrastructure.modelProviderConfig),
    },
    { maxRepairAttempts: infrastructure.actionPlannerConfig.MaxRepairAttempts },
  );
  const piSubstrate = new AgentPiSubstrate({
    workspaceRoot: options.workspaceRoot,
    config: options.config,
    modelProvider: infrastructure.modelProviderConfig,
    registry: infrastructure.registry,
    toolCallExecutor,
    artifactRecorder,
    executionEnv: infrastructure.executionEnv,
    resourcesPath: options.resourcesPath,
    toolPermissionGate,
    toolObservationDigester: new AgentPiToolObservationDigester({
      client: observationModelClient,
      model: infrastructure.modelProviderConfig.Model,
      contextWindowTokens: infrastructure.modelProviderConfig.ContextWindowTokens,
      outputReserveTokens: resolveAgentPiModelMaxTokens(infrastructure.modelProviderConfig),
    }),
    diagnostics: options.piDiagnostics,
    turnContexts: infrastructure.piTurnContexts,
    uploadStore: infrastructure.uploadStore,
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

function tryResolveSandboxRuntimePaths(workspaceRoot: string, config: ReturnType<typeof resolveSandboxRuntimeConfig>) {
  try {
    return resolveAgentSandboxRuntimePaths(workspaceRoot, config);
  } catch {
    return undefined;
  }
}

function resolveRuntimeMicrosandboxSettings(config: ReturnType<typeof resolveSandboxRuntimeConfig>) {
  if (config.Provisioning.Kind === "Oci") {
    const image = config.Provisioning.Images[0];
    if (!image) throw new Error("OCI sandbox provisioning requires at least one image.");
    return { image, pullPolicy: "if-missing" as const };
  }
  return {
    image: resolveAgentSandboxDistributionTarget(readAgentSandboxDistributionContract()).runtimeImage,
    pullPolicy: "never" as const,
  };
}
