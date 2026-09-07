import path from "node:path";
import fs from "node:fs";
import { Temporal } from "@js-temporal/polyfill";
import { AgentLoop } from "../Source/AgentSystem/Loop/AgentLoop.js";
import { AgentSessionManager } from "../Source/AgentSystem/Session/AgentSessionManager.js";
import { AgentSessionStore } from "../Source/AgentSystem/Session/AgentSessionStore.js";
import { AgentWebSocketServer } from "../Source/AgentSystem/WebSocket/AgentWebSocketServer.js";
import { AgentSqliteRunEventWriter } from "../Source/AgentSystem/WebSocket/AgentSqliteRunEventWriter.js";
import { AgentCallbackRunEventWriter } from "../Source/AgentSystem/WebSocket/AgentCallbackRunEventWriter.js";
import {
  resolvePersistenceConfig,
  resolveAgentLoopConfig,
  resolveArtifactsConfig,
  resolveSandboxRuntimeConfig,
  resolveServerConfig,
  resolveToolExecutionConfig,
  resolveAgentTodosConfig,
  resolvePresetsConfig,
  resolveUploadsConfig,
  resolveVectorModelsConfig,
  resolveAgentWorldConfig,
  resolveModelProviderConfig,
  resolveActionPlannerConfig,
  resolveAgentInferenceBudgetConfig,
} from "../Source/AgentSystem/AgentDefaults.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import { AgentUserProfileManager } from "../Source/AgentSystem/Session/AgentUserProfile.js";
import { AgentSkillScanner } from "../Source/AgentSystem/Skills/AgentSkillScanner.js";
import { AgentMcpPackageScanner } from "../Source/AgentSystem/McpPackages/AgentMcpPackageScanner.js";
import { createAgentContinuityRuntime } from "../Source/AgentSystem/Continuity/AgentContinuityRuntime.js";
import { AgentVectorModelClient } from "../Source/AgentSystem/Vector/AgentVectorModelClient.js";
import {
  createAgentWorldSnapshotEvent,
  createAgentWorldSnapshotEventFromProjection,
} from "../Source/AgentSystem/World/AgentWorldEventTypes.js";
import type { AgentWorldResidentWakeActionPort } from "../Source/AgentSystem/World/AgentWorldResidentWakeRuntime.js";
import { composeAgentWorldRuntime } from "../Source/AgentSystem/World/AgentWorldRuntimeComposition.js";
import { AgentSlidingWindowInferenceBudget } from "../Source/AgentSystem/ModelEndpoints/AgentInferenceBudget.js";
import { secondsToMilliseconds } from "../Source/AgentSystem/Defaults/AgentTimeDefaults.js";
import { AgentConfigService, type AgentConfigSourceOptions } from "../Source/AgentSystem/Config/AgentConfigService.js";
import { AgentEventKinds, emitAgentEvent, type AgentDomainEvent } from "../Source/AgentSystem/Events/AgentEvent.js";
import { serializeError } from "../Source/AgentSystem/Diagnostics/AgentErrorSerializer.js";
import { AgentLogger } from "../Source/AgentSystem/Diagnostics/AgentLogger.js";
import { AgentServerEventLogger } from "../Source/AgentSystem/Diagnostics/AgentServerEventLogger.js";
import { AgentApprovalRuntime } from "../Source/AgentSystem/Approvals/AgentApprovalRuntime.js";
import { AgentPiActiveSessionRegistry } from "../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import { AgentPiSessionMutationService } from "../Source/AgentSystem/Pi/AgentPiSessionMutationService.js";
import { createAgentPiDiagnosticLoggerForDetail } from "../Source/AgentSystem/Diagnostics/AgentPiDiagnostics.js";
import { AgentSystemRuntimeCache } from "../Source/AgentSystem/Runtime/AgentSystemRuntimeCache.js";
import { AgentSessionApprovalLeaseStore } from "../Source/AgentSystem/Safety/AgentSessionApprovalLeaseStore.js";
import { AgentSandboxRuntimeService } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimeService.js";
import { AgentExecutionResourceBroker } from "../Source/AgentSystem/ExecutionResources/AgentExecutionResourceBroker.js";
import { AgentInteractiveTerminalRuntime } from "../Source/AgentSystem/ExecutionResources/AgentInteractiveTerminalRuntime.js";
import { createSeneraExecutionEnvironments } from "../Source/AgentSystem/Execution/SeneraExecutionEnvFactory.js";
import { resolveAgentDockerEngineGuestWorkspaceRoot } from "../Source/AgentSystem/Sandbox/DockerEngine/AgentDockerEngineRuntimeContract.js";
import { resolveAgentExecutionResourceLimits } from "../Source/AgentSystem/ExecutionResources/AgentExecutionResourceConfig.js";
import { AgentInteractionInputRuntime } from "../Source/AgentSystem/Interaction/AgentInteractionInputRuntime.js";
import { createAgentRequestCancellationResource } from "../Source/AgentSystem/Session/AgentSessionRunResource.js";
import { AgentArtifactRetentionService } from "../Source/AgentSystem/Artifacts/AgentArtifactRetentionService.js";
import type { AgentSandboxRuntimeAvailability } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimeTypes.js";
import type { SeneraSandboxWorkerClient } from "../Source/AgentSystem/Execution/SeneraSandboxWorkerTypes.js";
import { readAgentProductMetadata } from "../Source/AgentSystem/Core/AgentProductMetadata.js";
import { AgentUpgradeSession } from "../Source/AgentSystem/Upgrade/AgentUpgradeSession.js";
import { errorMessage } from "../Source/AgentSystem/Core/AgentErrors.js";
import {
  migrateLegacyAgentWorkspaceLayout,
  resolveAgentWorkspaceLayout,
} from "../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { resolveServerConfigSource, resolveServerRuntimeConfigPath } from "./ServerRuntimeConfig.js";
import { AgentMcpInputService } from "../Source/AgentSystem/Credentials/AgentMcpInputService.js";
import { AgentMcpManagementService } from "../Source/AgentSystem/McpPackages/AgentMcpManagementService.js";
import { AgentWorkspaceRuntime } from "../Source/AgentSystem/Runtime/AgentWorkspaceRuntime.js";
import { AgentRunDispatchGateway } from "../Source/AgentSystem/Orchestration/AgentRunDispatchPort.js";
import { AgentActionPlannerModelClient } from "../Source/AgentSystem/ActionPlanner/AgentActionPlannerModelClient.js";
import { AgentGoalMicroLoopDispatchActionPort } from "../Source/AgentSystem/Agenda/AgentGoalMicroLoopDispatchActionPort.js";
import { AgentSessionRunDispatcher } from "../Source/AgentSystem/Session/AgentSessionRunDispatcher.js";
import { AgentOrchestrationDatabase } from "../Source/AgentSystem/Orchestration/AgentOrchestrationDatabase.js";
import { AgentSqliteChildRunRepository } from "../Source/AgentSystem/Orchestration/AgentSqliteChildRunRepository.js";
import { AgentSqliteWorkflowRepository } from "../Source/AgentSystem/Orchestration/AgentSqliteWorkflowRepository.js";
import { AgentSqliteScheduledTaskStore } from "../Source/AgentSystem/Orchestration/AgentSqliteScheduledTaskStore.js";
import { AgentOrchestrationEventRelay } from "../Source/AgentSystem/Orchestration/AgentOrchestrationEventRelay.js";
import {
  AgentDelegationService,
  type AgentDelegationCompletionPort,
} from "../Source/AgentSystem/Orchestration/AgentDelegationService.js";
import { AgentDelegationCompletionDelivery } from "../Source/AgentSystem/Orchestration/AgentDelegationCompletionDelivery.js";
import {
  createAgentDelegationSessionWakeHandler,
  isTerminalDetachedChildRun,
} from "../Source/AgentSystem/Orchestration/AgentDelegationSessionWake.js";
import { AgentWorkflowService } from "../Source/AgentSystem/Orchestration/AgentWorkflowService.js";
import { AgentSubagentRoleCatalog } from "../Source/AgentSystem/Orchestration/AgentSubagentRoleCatalog.js";
import { AgentScheduleRuntime } from "../Source/AgentSystem/Orchestration/AgentScheduleRuntime.js";
import { AgentPresetManager } from "../Source/AgentSystem/Presets/AgentPresetManager.js";
import type { AgentIdentityDisplayValues } from "../Source/AgentSystem/Text/AgentTextParts.js";
import {
  AgentScheduledTaskDeliveryGateway,
  AgentScheduledTaskExecutionSessionGateway,
  AgentScheduledTaskSourceContextGateway,
} from "../Source/AgentSystem/Orchestration/AgentScheduledTaskRunTypes.js";
import { AgentChannelsDatabase } from "../Source/AgentSystem/Channels/AgentChannelsDatabase.js";
import { ingestAgentChannelAttachment } from "../Source/AgentSystem/Channels/AgentChannelAttachmentIngestor.js";
import { parseAgentQqApprovalInteraction } from "../Source/AgentSystem/Channels/AgentQqApprovalInteraction.js";
import { AgentChannelSessionMappingStore } from "../Source/AgentSystem/Channels/AgentChannelSessionMappingStore.js";
import { AgentChannelService, type AgentChannelStatus } from "../Source/AgentSystem/Channels/AgentChannelService.js";
import { createAgentChannelFinalResponseRewriter } from "../Source/AgentSystem/Channels/AgentChannelFinalResponse.js";
import { createDefaultAgentChannelRegistry } from "../Source/AgentSystem/Channels/AgentChannelAdapterRegistry.js";
import { resolveAgentChannelsConfig } from "../Source/AgentSystem/Channels/AgentChannelsConfig.js";
import { AgentChannelWebhookApi } from "../Source/AgentSystem/Channels/AgentChannelWebhookApi.js";
import { AgentResourceResolver } from "../Source/AgentSystem/Resources/AgentResourceResolver.js";
import {
  resolveAgentDelegationConfiguration,
  resolveAgentSchedulerConfiguration,
} from "../Source/AgentSystem/Orchestration/AgentOrchestrationConfig.js";
import { AgentRuntimeUpdateDeployments } from "../Source/AgentSystem/Runtime/AgentRuntimeUpdateContract.js";
import {
  closeRuntimeInfrastructure,
  collectRejected,
  createRepository,
  createRuntimeUpdateOptions,
  disableSandboxRuntime,
  probeSeneraReadiness,
  resolveHealthCheckHost,
  resolveServerEventLogDetail,
  SeneraStartupCleanup,
  startSandboxRuntimePreparation,
} from "./ServerRuntimeSupport.js";

export { probeSeneraReadiness } from "./ServerRuntimeSupport.js";

export interface SeneraServerOptions {
  workspaceRoot?: string;
  configPath?: string;
  staticFrontendRoot?: string;
  /**
   * Root containing the application manifest. Electron keeps package.json in
   * app.asar while extraResources are exposed from the physical resources root.
   */
  applicationRoot?: string;
  resourcesPath?: string;
  configSource?: AgentConfigSourceOptions;
  runtimeConfigProjection?: (config: AgentSystemConfig) => AgentSystemConfig;
  /** Selects the process boundary owned by this deployment entrypoint. */
  deployment?: SeneraServerDeployment;
  /**
   * Set only by a deployment bootstrap that has already prepared and verified
   * the configured Docker Engine runtime before opening the web server.
   */
  sandboxRuntimePrepared?: boolean;
  sandboxRuntimeAvailability?: AgentSandboxRuntimeAvailability;
  dockerEngineWorker?: SeneraSandboxWorkerClient;
  /** Guest-side workspace root shared by the application and sandbox mounts. */
  sandboxGuestWorkspaceRoot?: string;
  /** Enables automatic loopback HTTP for container-local browser access. */
  automaticLoopbackHttp?: boolean;
  upgradeStateRoot?: string;
  upgradeDataRoots?: readonly string[];
  runtimeImageReference?: string;
  updateManifestUrl?: string;
  /** Resolves the user session eligible for a Resident idle notification. */
  residentInteractionTarget?: (
    sessions: readonly { sessionId: string; status: string; updatedAt: string }[],
  ) => string | undefined | Promise<string | undefined>;
  /** Optional host executor for explicit Resident wake requests. */
  residentWakeAction?: AgentWorldResidentWakeActionPort;
  /** Completion sinks supplied by channel adapters such as QQ or Telegram. */
  delegationCompletionPorts?: readonly AgentDelegationCompletionPort[];
}

export const SeneraServerDeployments = {
  Local: "local",
  Container: "container",
} as const;

export type SeneraServerDeployment = (typeof SeneraServerDeployments)[keyof typeof SeneraServerDeployments];

export interface SeneraServerHandle {
  workspaceRoot: string;
  configPath: string;
  websocketUrl: string;
  healthUrl: string;
  stop(): Promise<void>;
}

export async function startSeneraServer(options: SeneraServerOptions = {}): Promise<SeneraServerHandle> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const resourceRoot = path.resolve(options.resourcesPath ?? process.cwd());
  const applicationRoot = path.resolve(options.applicationRoot ?? resourceRoot);
  const product = readAgentProductMetadata(applicationRoot);
  const upgradeSession = new AgentUpgradeSession({
    workspaceRoot,
    stateRoot: options.upgradeStateRoot,
    allowedDataRoots: options.upgradeDataRoots,
    appVersion: product.version,
    imageReference: options.runtimeImageReference ?? process.env.SENERA_RUNTIME_IMAGE_REFERENCE,
  });
  const cleanup = new SeneraStartupCleanup();
  let handle: SeneraServerHandle | undefined;
  try {
    upgradeSession.recoverInterruptedUpgrade();
    migrateLegacyAgentWorkspaceLayout(workspaceRoot);
    handle = await startSeneraServerRuntime(options, workspaceRoot, upgradeSession, cleanup, product);
    await probeSeneraReadiness(handle.healthUrl);
    upgradeSession.markHealthy();
    cleanup.disarm();
    return handle;
  } catch (error) {
    const failures: unknown[] = [error];
    try {
      if (handle) await handle.stop();
      else await cleanup.run();
    } catch (cleanupError) {
      failures.push(cleanupError);
    }
    try {
      upgradeSession.failAndRollback(error);
    } catch (rollbackError) {
      failures.push(rollbackError);
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, "Senera startup and automatic upgrade rollback failed.", { cause: error });
    }
    throw error;
  }
}

async function startSeneraServerRuntime(
  options: SeneraServerOptions,
  workspaceRoot: string,
  upgradeSession: AgentUpgradeSession,
  startupCleanup: SeneraStartupCleanup,
  product: ReturnType<typeof readAgentProductMetadata>,
): Promise<SeneraServerHandle> {
  const resourceRoot = path.resolve(options.resourcesPath ?? process.cwd());
  const workspaceLayout = resolveAgentWorkspaceLayout(workspaceRoot);
  const startupResourceCleanups: Array<() => void> = [];
  const deferResourceCleanup = (callback: () => void | Promise<void>): (() => void) => {
    const cancel = startupCleanup.defer(callback);
    startupResourceCleanups.push(cancel);
    return cancel;
  };
  const configSource = resolveServerConfigSource(workspaceRoot, options);
  const configPath = resolveServerRuntimeConfigPath(workspaceRoot, configSource);
  let watchedConfigPath: string | undefined;
  const eventLogDetail = resolveServerEventLogDetail(process.env.SENERA_LOG_EVENTS);
  const logger = new AgentLogger({
    verbose: eventLogDetail === "verbose",
    eventDisplayMode: eventLogDetail,
  });
  const eventLogger = new AgentServerEventLogger({
    logger,
    detail: eventLogDetail,
  });
  const piDiagnostics = createAgentPiDiagnosticLoggerForDetail(logger, eventLogDetail);

  const configService = new AgentConfigService({
    workspaceRoot,
    source: configSource,
    upgradeSession,
  });
  deferResourceCleanup(() => configService.close());
  const approvalRuntime = new AgentApprovalRuntime();
  const interactionInput = new AgentInteractionInputRuntime();
  deferResourceCleanup(() => interactionInput.close());
  const piSessionRegistry = new AgentPiActiveSessionRegistry();
  const deployment = options.deployment;
  const projectRuntimeConfig = (config: AgentSystemConfig): AgentSystemConfig => {
    const projected = options.runtimeConfigProjection?.(config) ?? config;
    return deployment === SeneraServerDeployments.Local ? disableSandboxRuntime(projected) : projected;
  };
  const initialSnapshot = configService.snapshot();
  const initialConfig = projectRuntimeConfig(initialSnapshot.value);
  const configSnapshot = (): AgentSystemConfig => projectRuntimeConfig(configService.snapshot().value);
  const mcpInputs = AgentMcpInputService.open(workspaceRoot);
  deferResourceCleanup(() => mcpInputs.close());
  const mcpManagement = new AgentMcpManagementService({
    workspaceRoot,
    resourcesRoot: resourceRoot,
    inputs: mcpInputs,
    config: configSnapshot,
  });
  const runtimeSnapshot = () => {
    const snapshot = configService.snapshot();
    const config = projectRuntimeConfig(snapshot.value);
    return {
      version: snapshot.version,
      revision: snapshot.revision,
      sourceRevisions: {
        mcpPackages: AgentMcpPackageScanner.sourceRevision(path.join(resourceRoot, "McpServers")),
        workspaceMcp: AgentMcpPackageScanner.sourceRevision(workspaceLayout.mcpRoot),
        systemSkills: AgentSkillScanner.sourceRevision(path.join(resourceRoot, "System", "Skills")),
        workspaceSkills: AgentSkillScanner.sourceRevision(workspaceLayout.skillRoot),
        mcpInputs: mcpManagement.revision(),
      },
      config,
    };
  };
  const sandboxRuntimeService = new AgentSandboxRuntimeService({
    workspaceRoot,
    configSnapshot,
    availability: options.sandboxRuntimeAvailability,
    dockerEngineWorker: options.dockerEngineWorker,
  });
  const sandboxProvider = sandboxRuntimeService.runtimeProvider();
  const sandboxGuestWorkspaceRoot =
    options.sandboxGuestWorkspaceRoot ??
    (sandboxProvider ? resolveAgentDockerEngineGuestWorkspaceRoot(workspaceRoot, sandboxProvider) : workspaceRoot);
  const createRuntimeExecutionEnvironments = () => {
    const config = configSnapshot();
    return createSeneraExecutionEnvironments({
      workspaceRoot,
      resourcesPath: options.resourcesPath,
      sandboxEnabled: resolveSandboxRuntimeConfig(config).Enabled,
      sandboxAvailable: sandboxRuntimeService.sandboxBackendAvailable(),
      sandboxRuntimeReady: () => sandboxRuntimeService.snapshot().state === "ready",
      sandboxProvider: sandboxRuntimeService.runtimeProvider(),
      dockerEngineWorker: sandboxRuntimeService.dockerEngineWorkerClient(),
      environmentPolicy: resolveToolExecutionConfig(config).Environment,
      terminationGraceMs: resolveAgentExecutionResourceLimits(config).terminationGraceMs,
      sandboxGuestWorkspaceRoot,
    });
  };
  const executionResources = new AgentExecutionResourceBroker({
    workspaceRoot,
    limits: () => resolveAgentExecutionResourceLimits(configSnapshot()),
    onCleanupFailure: (failure) => {
      logger.error("后台执行资源清理失败", {
        resourceId: failure.resourceId,
        reason: failure.reason,
        error: errorMessage(failure.error),
      });
    },
  });
  deferResourceCleanup(() => executionResources.close());
  const workspaceRuntime = new AgentWorkspaceRuntime({
    workspaceRoot,
    uploads: () => resolveUploadsConfig(configSnapshot()),
  });
  deferResourceCleanup(() => workspaceRuntime.close());
  const goalMicroLoopConfig = () => resolveAgentWorldConfig(configSnapshot()).GoalMicroLoop;
  const residentIdleConfig = () => resolveAgentWorldConfig(configSnapshot()).ResidentIdle;
  const runDispatch = new AgentRunDispatchGateway();
  const residentSessionManagerRef: { current?: AgentSessionManager } = {};
  const channelServiceRef: { current?: AgentChannelService } = {};
  const goalMicroLoopActionPort = new AgentGoalMicroLoopDispatchActionPort({
    dispatch: runDispatch,
    allowedToolNames: () => goalMicroLoopConfig().AllowedToolNames,
    reviewDelayMs: () => Math.round(goalMicroLoopConfig().ReviewDelaySeconds * 1_000),
  });
  const orchestrationEvents = new AgentOrchestrationEventRelay();
  const orchestrationDatabase = new AgentOrchestrationDatabase(workspaceLayout.databases.orchestration, upgradeSession);
  deferResourceCleanup(() => orchestrationDatabase.close());
  const childRuns = new AgentSqliteChildRunRepository(orchestrationDatabase);
  const delegationCompletion = new AgentDelegationCompletionDelivery({
    database: orchestrationDatabase,
    repository: childRuns,
    onError: (error, portId) => {
      logger.error("后台任务渠道投递失败", {
        portId,
        error: errorMessage(error),
      });
    },
  });
  deferResourceCleanup(() => delegationCompletion.stop());
  const workflowRepository = new AgentSqliteWorkflowRepository(orchestrationDatabase);
  const subagentRoles = new AgentSubagentRoleCatalog({
    builtinRoot: path.join(resourceRoot, "System", "Extensions", "agent-delegation", "agents"),
  });
  const scheduledTasks = new AgentSqliteScheduledTaskStore(orchestrationDatabase);
  const schedulerConfiguration = resolveAgentSchedulerConfiguration(initialConfig);
  const delegation = new AgentDelegationService({
    workspaceRoot,
    configuration: () => {
      const snapshot = configService.snapshot();
      return {
        config: projectRuntimeConfig(snapshot.value),
        revision: snapshot.revision,
      };
    },
    repository: childRuns,
    dispatcher: runDispatch,
    events: orchestrationEvents,
    completion: delegationCompletion,
    roleCatalog: subagentRoles,
  });
  deferResourceCleanup(() => delegation.shutdown());
  const workflows = new AgentWorkflowService({
    repository: workflowRepository,
    delegation,
    events: orchestrationEvents,
    maxNodes: () => resolveAgentDelegationConfiguration(configSnapshot()).workflows.maxNodes,
  });
  deferResourceCleanup(() => workflows.shutdown());
  const scheduledTaskDelivery = new AgentScheduledTaskDeliveryGateway();
  const scheduledTaskSourceContext = new AgentScheduledTaskSourceContextGateway();
  const scheduledTaskExecutionSessions = new AgentScheduledTaskExecutionSessionGateway();
  const schedules = new AgentScheduleRuntime({
    workspaceRoot,
    config: configSnapshot,
    store: scheduledTasks,
    dispatcher: runDispatch,
    delivery: scheduledTaskDelivery,
    sourceContext: scheduledTaskSourceContext,
    executionSessions: scheduledTaskExecutionSessions,
    events: orchestrationEvents,
    pollIntervalMs: schedulerConfiguration.polling.intervalMs,
    claimDurationMs: schedulerConfiguration.polling.claimDurationMs,
    claimBatchSize: schedulerConfiguration.polling.claimBatchSize,
  });
  deferResourceCleanup(() => schedules.stop());
  const orchestration = { delegation, workflows, schedules };
  const persistence = resolvePersistenceConfig(initialConfig);
  const repository = createRepository(workspaceRoot, initialConfig, upgradeSession, logger);
  deferResourceCleanup(() => repository.close());
  let residentDisplayName = resolveAgentWorldConfig(initialConfig).Name;
  const identityDisplayValues = (): AgentIdentityDisplayValues => ({
    user: repository.loadUserProfile().name,
    resident: residentDisplayName,
  });
  const sessionStore = new AgentSessionStore({ repository });
  const sessionApprovals = new AgentSessionApprovalLeaseStore();
  const todoConfig = resolveAgentTodosConfig(initialConfig);
  const vectorModelsConfig = resolveVectorModelsConfig(initialConfig);
  const inferenceBudget = new AgentSlidingWindowInferenceBudget(() => {
    const policy = resolveAgentInferenceBudgetConfig(configSnapshot());
    return {
      enabled: policy.Enabled,
      windowMs: secondsToMilliseconds(policy.WindowSeconds),
      maxRequests: policy.MaxRequests,
      maxEstimatedInputTokens: policy.MaxEstimatedInputTokens,
      maxEstimatedOutputTokens: policy.MaxEstimatedOutputTokens,
      maxConcurrent: policy.MaxConcurrent,
      foregroundReserveFraction: policy.ForegroundReserveFraction,
      laneWeights: policy.LaneWeights,
    };
  });
  let inferenceBudgetScope = (): string => {
    throw new Error("Vector inference budget scope is not initialized.");
  };
  const vectorClient = new AgentVectorModelClient(vectorModelsConfig, {
    inferenceBudget,
    inferenceBudgetScope: () => {
      return inferenceBudgetScope();
    },
  });
  const continuityRuntime = createAgentContinuityRuntime({
    databasePath: workspaceLayout.databases.memory,
    identityPath: workspaceLayout.continuityIdentity,
    upgradeSession,
    configSnapshot,
    todoPolicy: {
      maxItems: todoConfig.MaxItems,
      maxContentCharacters: todoConfig.MaxContentCharacters,
      maxResultCharacters: todoConfig.MaxResultCharacters,
    },
    embeddingClient: vectorModelsConfig.Embedding.Enabled ? vectorClient : undefined,
    embeddingModel: () => resolveVectorModelsConfig(configSnapshot()).Embedding.Model,
    inferenceBudget,
    identityDisplayValues,
    logger,
  });
  inferenceBudgetScope = () => continuityRuntime.identity.workspaceId;
  deferResourceCleanup(() => continuityRuntime.close());
  const {
    learning: continuityLearning,
    memory: memoryService,
    promptContext: continuityMemory,
    lifecycle: continuityLifecycle,
    agenda,
    executionLedger,
    todos,
    temporalMemory,
  } = continuityRuntime;
  delegation.bindTodoService(todos);
  const goalModelProvider = resolveModelProviderConfig(initialConfig);
  const goalPlannerConfig = resolveActionPlannerConfig(initialConfig, goalModelProvider.Id);
  const goalPlannerClientConfig = goalPlannerConfig.PlanningClient;
  const goalPlannerModelProvider = goalPlannerClientConfig.ModelProvider;
  const goalPlannerModelClient = new AgentActionPlannerModelClient(goalPlannerModelProvider, goalPlannerClientConfig, {
    maxRepairAttempts: goalPlannerConfig.MaxRepairAttempts,
  });
  const worldComposition = await composeAgentWorldRuntime({
    workspaceRoot,
    worldPackagesRoot: workspaceLayout.worldPackagesRoot,
    initialConfig,
    configSnapshot,
    logger,
    continuityRuntime,
    runDispatch,
    orchestrationEvents,
    goalMicroLoopActionPort,
    goalModelProvider,
    goalPlannerModelClient,
    inferenceBudget,
    goalMicroLoopConfig,
    residentIdleConfig,
    residentInteractionTarget: options.residentInteractionTarget,
    listResidentSessions: () => residentSessionManagerRef.current?.listSessions() ?? [],
    residentWakeAction: options.residentWakeAction,
    deliverResidentMessage: async (request) => {
      if (!residentSessionManagerRef.current) throw new Error("Resident idle delivery is not ready.");
      return residentSessionManagerRef.current.deliverProactiveMessage(request);
    },
    deliverProactiveResult: async (request) =>
      (await channelServiceRef.current?.deliverProactiveResult(request)) ?? "missing",
    identityDisplayValues,
  });
  const {
    goalCommands,
    worldRuntime,
    residentIdle,
    residentWake,
    presetActivation,
    activePresetCard,
    temporalMemoryWorldBridge,
    requestWorldWake,
    observeWorldAndContinuityEvent,
  } = worldComposition;
  residentDisplayName = activePresetCard?.title ?? resolveAgentWorldConfig(configSnapshot()).Name;
  if (activePresetCard && activePresetCard.worldPackageIds.length > 0) {
    logger.info("世界包已加载", {
      packages: activePresetCard.worldPackageIds,
      rootDir: workspaceLayout.worldPackagesRoot,
    });
  }
  deferResourceCleanup(() => worldRuntime.stop());
  const runtimeCache = new AgentSystemRuntimeCache({
    workspaceRoot,
    configPath,
    snapshot: runtimeSnapshot,
    logger,
    piDiagnostics,
    approvalRuntime,
    sessionApprovals,
    interactionInput,
    piSessionRegistry,
    resourcesPath: options.resourcesPath,
    executionResources,
    sandboxRuntimeReady: () => sandboxRuntimeService.snapshot().state === "ready",
    sandboxAvailable: sandboxRuntimeService.sandboxBackendAvailable(),
    sandboxProvider: sandboxRuntimeService.runtimeProvider(),
    dockerEngineWorker: sandboxRuntimeService.dockerEngineWorkerClient(),
    sandboxGuestWorkspaceRoot,
    mcpInputs,
    workspaceRuntime,
    orchestration,
    continuityMemory,
    continuityIdentity: continuityRuntime.identity,
    identityDisplayValues,
    continuityLifecycle,
    executionLedger,
    todos,
    agenda,
    worldRuntime,
    inferenceBudget,
  });
  deferResourceCleanup(() => runtimeCache.clear());

  const loopFactory = (modelProviderId?: string) => {
    const lease = runtimeCache.acquire(modelProviderId);
    try {
      const loop = new AgentLoop({
        runtime: lease.runtime,
        preparationFingerprint: lease.preparationFingerprint,
      });

      return {
        preparationFingerprint: lease.preparationFingerprint,
        run: async (...args: Parameters<AgentLoop["run"]>) => {
          try {
            return await loop.run(...args);
          } finally {
            lease.release();
          }
        },
      };
    } catch (error) {
      lease.release();
      throw error;
    }
  };
  const piSessionMutations = new AgentPiSessionMutationService({
    acquireRuntime: (modelProviderId) => runtimeCache.acquire(modelProviderId),
    diagnostics: piDiagnostics,
  });
  const interactiveTerminals = new AgentInteractiveTerminalRuntime({
    workspaceRoot,
    broker: executionResources,
    acquireExecutionEnv: () => {
      return { executionEnv: createRuntimeExecutionEnvironments().system, release: () => undefined };
    },
  });

  const artifactRetention = new AgentArtifactRetentionService({
    workspaceRoot,
    config: () => resolveArtifactsConfig(configSnapshot()),
    onError: (error) => logger.warn("artifact.retention.failed", { error: serializeError(error) }),
  });
  deferResourceCleanup(() => artifactRetention.close());
  const sessionManager = new AgentSessionManager({
    loopFactory,
    store: sessionStore,
    managedSessionIds: new Set(childRuns.listAll().map((run) => run.childSessionId)),
    memoryService,
    eventObserver: observeWorldAndContinuityEvent,
    logger,
    runResources: [
      createAgentRequestCancellationResource("approval", approvalRuntime),
      createAgentRequestCancellationResource("interaction_input", interactionInput),
    ],
    sessionResources: [
      {
        id: "approval_session_leases",
        release: async ({ sessionId }) => sessionApprovals.revoke(sessionId),
      },
      {
        id: "execution_resources",
        release: ({ sessionId }) => executionResources.releaseAll({ workspaceRoot, sessionId }),
      },
      {
        id: "scheduled_tasks",
        release: ({ sessionId }) => schedules.removeOwnerSession(sessionId),
      },
    ],
    piSessions: piSessionRegistry,
    piDiagnostics,
    uploadStore: workspaceRuntime.uploadStore,
    piSessionMutations,
    piSessionManagement: piSessionMutations,
    runControl: {
      get settlementTimeoutMs() {
        return resolveAgentLoopConfig(configSnapshot()).RunSettlementTimeoutMs;
      },
    },
    artifactSessionCleanup: artifactRetention,
  });
  residentSessionManagerRef.current = sessionManager;
  const channelsDatabase = new AgentChannelsDatabase(workspaceLayout.databases.channels, upgradeSession);
  deferResourceCleanup(() => channelsDatabase.close());
  const channelSessionMappings = new AgentChannelSessionMappingStore(channelsDatabase.connection);
  const channelFinalResponseRewriter = createAgentChannelFinalResponseRewriter(
    () => resolveActionPlannerConfig(configSnapshot()).FinalAnswerClient.ModelProvider,
  );
  const publishChannelServer: { current?: AgentWebSocketServer } = {};
  const publishChannelStatuses = (statuses: readonly AgentChannelStatus[]): void => {
    const server = publishChannelServer.current;
    if (!server) return;
    void server
      .broadcast({
        kind: AgentEventKinds.ChannelStatusSnapshot,
        context: {},
        data: { statuses: [...statuses] },
      })
      .catch((error) => logger.warn("消息渠道状态广播失败", { error: errorMessage(error) }));
  };
  const channelService = new AgentChannelService({
    config: () => resolveAgentChannelsConfig(configSnapshot()),
    registry: createDefaultAgentChannelRegistry(),
    sessionManager,
    mappingStore: channelSessionMappings,
    attachmentResolver: (attachment, _source, requestHeaders) =>
      ingestAgentChannelAttachment(workspaceRuntime.uploadStore, attachment, requestHeaders),
    resourceResolver: new AgentResourceResolver({
      workspaceRoot,
      config: configSnapshot,
      uploadStore: workspaceRuntime.uploadStore,
    }),
    finalResponseRewriter: channelFinalResponseRewriter,
    onInteraction: async (interaction) => {
      if (interaction.source.platform !== "qq") return;
      const parsed = parseAgentQqApprovalInteraction(interaction.buttonData);
      if (!parsed) return;
      const pending = approvalRuntime.getPending(parsed.approvalId);
      const lane = channelSessionMappings.getByLane(interaction.source);
      if (!pending || !lane || lane.sessionId !== pending.sessionId) {
        logger.warn("QQ approval interaction did not match a pending session", {
          approvalId: parsed.approvalId,
          chatId: interaction.source.chatId,
        });
        return;
      }
      try {
        await approvalRuntime.tryResolve({ approvalId: parsed.approvalId, decision: parsed.decision });
      } catch (error) {
        logger.warn("QQ approval interaction could not be resolved", {
          approvalId: parsed.approvalId,
          message: errorMessage(error),
        });
      }
    },
    onLog: (level, message, details) => {
      if (level === "info") logger.info(message, details);
      else if (level === "warn") logger.warn(message, details);
      else logger.error(message, details);
    },
    onStatusChanged: publishChannelStatuses,
  });
  channelServiceRef.current = channelService;
  deferResourceCleanup(() => channelService.stop());
  const channelWebhookApi = new AgentChannelWebhookApi({ channels: channelService });
  const unbindScheduledTaskDelivery = scheduledTaskDelivery.bind({
    deliver: async (request) => {
      const outcome = await sessionManager.deliverScheduledTaskResult({
        ...request,
        onEvent: (event) => orchestrationEvents.emit(event),
      });
      if (outcome !== "delivered") return outcome;
      return channelService.deliverProactiveResult(request);
    },
  });
  deferResourceCleanup(unbindScheduledTaskDelivery);
  const unbindScheduledTaskSourceContext = scheduledTaskSourceContext.bind({
    sessionExists: (sessionId) => sessionManager.hasSession(sessionId),
    resolveForkBoundary: (sessionId) => sessionManager.resolveScheduledTaskForkBoundary(sessionId),
  });
  deferResourceCleanup(unbindScheduledTaskSourceContext);
  const unbindScheduledTaskExecutionSessions = scheduledTaskExecutionSessions.bind({
    dispose: (sessionId) => sessionManager.disposeScheduledTaskSession(sessionId),
  });
  deferResourceCleanup(unbindScheduledTaskExecutionSessions);
  const unbindDelegationCompletion = delegationCompletion.bind({
    id: "senera.session-wake",
    // One parent wake is enough for a parallel AgentSpawn batch. The durable
    // completion rows still remain per child so channel adapters can project
    // each result independently.
    completed: createAgentDelegationSessionWakeHandler({
      childRuns,
      sessionManager,
      onEvent: (event) => orchestrationEvents.emit(event),
    }),
  });
  deferResourceCleanup(unbindDelegationCompletion);
  const unbindDelegationCompletionPorts = [
    channelService.createCompletionPort(),
    ...(options.delegationCompletionPorts ?? []),
  ].map((port) => delegationCompletion.bind(port));
  deferResourceCleanup(() => {
    for (const unbind of unbindDelegationCompletionPorts) unbind();
  });
  for (const record of childRuns.listAll()) {
    if (!isTerminalDetachedChildRun(record.status, record)) continue;
    void delegationCompletion.completed(record).catch(() => undefined);
  }
  const unbindRunDispatch = runDispatch.bind(new AgentSessionRunDispatcher(sessionManager));
  deferResourceCleanup(unbindRunDispatch);
  const eventWriter =
    persistence.Kind === "sqlite"
      ? new AgentSqliteRunEventWriter({ databasePath: workspaceLayout.databases.sessions })
      : new AgentCallbackRunEventWriter((events) => sessionManager.recordRunEvents(events));
  const cancelEventWriterCleanup = deferResourceCleanup(() => eventWriter.close());
  const userProfileManager = new AgentUserProfileManager(repository);
  const server = new AgentWebSocketServer({
    config: initialConfig,
    workspaceRoot,
    automaticLoopbackHttp: options.automaticLoopbackHttp,
    staticFrontendRoot: options.staticFrontendRoot,
    configService,
    configSnapshot,
    sessionManager,
    userProfileManager,
    approvalRuntime,
    interactionInput,
    sandboxRuntimeService,
    executionResources,
    interactiveTerminals,
    logger,
    eventLogger,
    piDiagnostics,
    eventWriter,
    mcpManagement,
    agenda,
    goalCommands,
    worldRuntime,
    residentWakeRuntime: residentWake,
    onWorldWake: requestWorldWake,
    presetActivation,
    onPresetSnapshot: (snapshot) => {
      const activePreset = snapshot.activePresetName
        ? snapshot.presets.find((preset) => preset.name === snapshot.activePresetName)
        : undefined;
      residentDisplayName = activePreset?.title ?? resolveAgentWorldConfig(configSnapshot()).Name;
      requestWorldWake("preset_snapshot");
    },
    uploadStore: workspaceRuntime.uploadStore,
    channelWebhookApi,
    channelControl: channelService,
    runtimeUpdate: createRuntimeUpdateOptions({
      currentVersion: product.version,
      deployment:
        deployment === SeneraServerDeployments.Container
          ? AgentRuntimeUpdateDeployments.Container
          : AgentRuntimeUpdateDeployments.Local,
      updateManifestUrl: options.updateManifestUrl ?? process.env.SENERA_UPDATE_MANIFEST_URL,
      updateOrigin: product.updateOrigin,
    }),
  });
  publishChannelServer.current = server;
  const unsubscribePresetActivation = configService.subscribe((snapshot) => {
    const manager = new AgentPresetManager({
      workspaceRoot,
      config: resolvePresetsConfig(snapshot.value),
      activation: presetActivation,
    });
    void manager
      .synchronizeActivePreset()
      .then((card) => {
        residentDisplayName = card?.title ?? resolveAgentWorldConfig(configSnapshot()).Name;
        requestWorldWake("preset_activation");
        return server.broadcast(createAgentWorldSnapshotEvent(worldRuntime));
      })
      .catch((error) => logger.error("角色世界同步失败", { error: errorMessage(error) }));
  });
  deferResourceCleanup(unsubscribePresetActivation);
  const unsubscribeChannelConfig = configService.subscribe(() => {
    void channelService.syncFromConfig().catch((error) => {
      logger.error("消息渠道配置同步失败", { error: errorMessage(error) });
    });
  });
  deferResourceCleanup(unsubscribeChannelConfig);
  channelService.setEventSink((event) => server.broadcast(event));
  cancelEventWriterCleanup();
  deferResourceCleanup(() => server.stop());
  approvalRuntime.setEventSink((event) => server.broadcast(event));
  interactionInput.setEventSink((event) => server.broadcast(event));
  executionResources.setEventSink((event) => server.broadcast(event));
  continuityRuntime.setEventSink(async (event) => {
    await server.broadcast(event);
    if (event.kind === AgentEventKinds.AgendaSnapshot) {
      requestWorldWake("agenda_snapshot");
    }
  });
  orchestrationEvents.setSink((event) => {
    observeWorldAndContinuityEvent(event);
    return server.broadcast(event);
  });
  continuityLearning.setEventSink(async (event) => {
    await server.broadcast(event);
    requestWorldWake("continuity_learning");
  });
  temporalMemory.setDigestSink(async (digest) => {
    const worldEvent = temporalMemoryWorldBridge.observe(digest);
    if (worldEvent) requestWorldWake("temporal_memory_digest");
  });
  const unsubscribeSandboxStatus = sandboxRuntimeService.subscribe((snapshot) => {
    void server
      .broadcast({
        kind: AgentEventKinds.SandboxStatusSnapshot,
        context: {},
        data: snapshot,
      })
      .catch((error) => {
        logger.error("沙箱准备事件广播失败", {
          error: errorMessage(error),
        });
      });
  });

  upgradeSession.markStarting();
  await server.start();
  await channelService.start();
  residentIdle.ensureScheduled(
    agenda.snapshot(resolveAgentWorldConfig(configSnapshot()).TimeZone).world.id,
    Temporal.Now.instant(),
  );
  worldRuntime.start((snapshot) => server.broadcast(createAgentWorldSnapshotEventFromProjection(snapshot)));
  await schedules.start();
  continuityLearning.start();
  temporalMemory.start();
  artifactRetention.start();
  startSandboxRuntimePreparation({
    config: initialConfig,
    sandboxRuntimeService,
    logger,
    prepared: options.sandboxRuntimePrepared ?? false,
  });
  if (configSource.kind === "json" && resolveServerConfig(initialConfig).HotReload) {
    const jsonConfigPath = configSource.configPath;
    watchedConfigPath = jsonConfigPath;
    fs.watchFile(jsonConfigPath, { interval: 500 }, () => {
      try {
        const snapshot = configService.reloadFromSources();
        void (async () => {
          await server.broadcast({
            kind: AgentEventKinds.ConfigReloaded,
            context: {},
            data: {
              configPath: snapshot.path,
              source: snapshot.source,
              revision: snapshot.revision,
              diagnostics: snapshot.diagnostics,
            },
          });
          await server.broadcast(createAgentWorldSnapshotEvent(worldRuntime));
          residentIdle.ensureScheduled(
            agenda.snapshot(resolveAgentWorldConfig(configSnapshot()).TimeZone).world.id,
            Temporal.Now.instant(),
          );
          requestWorldWake("config_reload");
        })().catch((error) => {
          logger.error("配置变更事件广播失败", {
            error: errorMessage(error),
          });
        });
      } catch (error) {
        emitAgentEvent((event: AgentDomainEvent) => server.broadcast(event), {
          kind: AgentEventKinds.ConfigFailed,
          context: {},
          data: {
            configPath: jsonConfigPath,
            message: errorMessage(error),
            details: serializeError(error),
          },
        }).catch((broadcastError) => {
          logger.error("配置失败事件广播失败", {
            error: errorMessage(broadcastError),
          });
        });
      }
    });
  }

  const serverConfig = resolveServerConfig(initialConfig);
  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> =>
    (stopPromise ??= (async () => {
      if (watchedConfigPath) fs.unwatchFile(watchedConfigPath);
      unsubscribeSandboxStatus();
      sessionManager.beginShutdown();
      const failures: unknown[] = [];
      collectRejected(await Promise.allSettled([schedules.stop(), workflows.shutdown()]), failures);
      collectRejected(await Promise.allSettled([delegation.shutdown()]), failures);
      collectRejected(await Promise.allSettled([delegationCompletion.stop(), channelService.stop()]), failures);
      const boundaryOutcomes = await Promise.allSettled([server.stop(), sessionManager.shutdown()]);
      collectRejected(boundaryOutcomes, failures);
      orchestrationEvents.setSink(undefined);
      unbindRunDispatch();
      try {
        collectRejected(
          await Promise.allSettled([
            closeRuntimeInfrastructure(runtimeCache, workspaceRuntime),
            executionResources.close(),
            interactionInput.close(),
            artifactRetention.close(),
            sandboxRuntimeService.close(),
          ]),
          failures,
        );
      } finally {
        for (const close of [
          () => configService.close(),
          () => mcpInputs.close(),
          () => continuityRuntime.close(),
          () => repository.close(),
          () => orchestrationDatabase.close(),
          () => channelsDatabase.close(),
        ]) {
          try {
            close();
          } catch (error) {
            failures.push(error);
          }
        }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, "Senera server shutdown failed.");
      }
    })());

  for (const cancel of startupResourceCleanups) cancel();
  startupCleanup.defer(stop);

  return {
    workspaceRoot,
    configPath,
    websocketUrl: `ws://${serverConfig.Host}:${serverConfig.Port}`,
    healthUrl: `http://${resolveHealthCheckHost(serverConfig.Host)}:${serverConfig.Port}/health/ready`,
    stop,
  };
}
