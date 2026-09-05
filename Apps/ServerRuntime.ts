import path from "node:path";
import fs from "node:fs";
import { Readable } from "node:stream";
import { Temporal } from "@js-temporal/polyfill";
import { AgentLoop } from "../Source/AgentSystem/Loop/AgentLoop.js";
import { AgentSessionManager } from "../Source/AgentSystem/Session/AgentSessionManager.js";
import { AgentSessionStatuses } from "../Source/AgentSystem/Session/AgentSession.js";
import {
  AgentChildRunStatuses,
  type AgentChildRunRecord,
} from "../Source/AgentSystem/Orchestration/AgentChildRunTypes.js";
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
import { AgentContinuityEventBridge } from "../Source/AgentSystem/Continuity/AgentContinuityEventBridge.js";
import {
  createAgentWorldSnapshotEvent,
  createAgentWorldSnapshotEventFromProjection,
} from "../Source/AgentSystem/World/AgentWorldEventTypes.js";
import { AgentWorldEventLedger } from "../Source/AgentSystem/World/AgentWorldEventLedger.js";
import { AgentWorldMaterializer } from "../Source/AgentSystem/World/AgentWorldMaterializer.js";
import { AgentWorldClock } from "../Source/AgentSystem/World/AgentWorldClock.js";
import { AgentHabitScheduler } from "../Source/AgentSystem/World/AgentHabitScheduler.js";
import { AgentResidentStateMachine } from "../Source/AgentSystem/World/AgentResidentStateMachine.js";
import { AgentWorldPackageLoader } from "../Source/AgentSystem/World/AgentWorldPackageLoader.js";
import { AgentWorldAutonomyRuntime } from "../Source/AgentSystem/World/AgentWorldAutonomyRuntime.js";
import { AgentWorldHabitRuntime } from "../Source/AgentSystem/World/AgentWorldHabitRuntime.js";
import { AgentWorldWorkLedger } from "../Source/AgentSystem/World/AgentWorldWorkLedger.js";
import { AgentPresetWorldActivationRuntime } from "../Source/AgentSystem/World/AgentPresetWorldActivationRuntime.js";
import { AgentWorldRuntime } from "../Source/AgentSystem/World/AgentWorldRuntime.js";
import { AgentTemporalMemoryWorldBridge } from "../Source/AgentSystem/World/AgentTemporalMemoryWorldBridge.js";
import { AgentWorldConversationBridge } from "../Source/AgentSystem/World/AgentWorldConversationBridge.js";
import { AgentWorldLifecycleEventBridge } from "../Source/AgentSystem/World/AgentWorldLifecycleEventBridge.js";
import { AgentWorldResidentIdleRuntime } from "../Source/AgentSystem/World/AgentWorldResidentIdleRuntime.js";
import { AgentWorldResidentIdleModelDecisionPort } from "../Source/AgentSystem/World/AgentWorldResidentIdleModelDecisionPort.js";
import { AgentWorldResidentIdleAgendaActionPort } from "../Source/AgentSystem/World/AgentWorldResidentIdleActionPort.js";
import { AgentWorldResidentWakeRuntime } from "../Source/AgentSystem/World/AgentWorldResidentWakeRuntime.js";
import { AgentWorldResidentWakeEventActionPort } from "../Source/AgentSystem/World/AgentWorldResidentWakeEventActionPort.js";
import type { AgentWorldResidentWakeActionPort } from "../Source/AgentSystem/World/AgentWorldResidentWakeRuntime.js";
import { AgentWorldActionSourceIds } from "../Source/AgentSystem/World/AgentWorldActionBudget.js";
import { AgentSlidingWindowInferenceBudget } from "../Source/AgentSystem/ModelEndpoints/AgentInferenceBudget.js";
import { secondsToMilliseconds } from "../Source/AgentSystem/Defaults/AgentTimeDefaults.js";
import { listAgentContinuityAutomaticRecallScopes } from "../Source/AgentSystem/Continuity/AgentContinuityScopes.js";
import { AgentConfigService, type AgentConfigSourceOptions } from "../Source/AgentSystem/Config/AgentConfigService.js";
import { AgentEventKinds, emitAgentEvent, type AgentDomainEvent } from "../Source/AgentSystem/Events/AgentEvent.js";
import { serializeError } from "../Source/AgentSystem/Diagnostics/AgentErrorSerializer.js";
import { AgentLogger } from "../Source/AgentSystem/Diagnostics/AgentLogger.js";
import { AgentServerEventLogger } from "../Source/AgentSystem/Diagnostics/AgentServerEventLogger.js";
import { AgentApprovalRuntime } from "../Source/AgentSystem/Approvals/AgentApprovalRuntime.js";
import { AgentApprovalDecisions } from "../Source/AgentSystem/Approvals/AgentApprovalTypes.js";
import { AgentPiActiveSessionRegistry } from "../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import { AgentPiSessionMutationService } from "../Source/AgentSystem/Pi/AgentPiSessionMutationService.js";
import { createAgentPiDiagnosticLoggerForDetail } from "../Source/AgentSystem/Diagnostics/AgentPiDiagnostics.js";
import { AgentSystemRuntimeCache } from "../Source/AgentSystem/Runtime/AgentSystemRuntimeCache.js";
import { AgentSessionApprovalLeaseStore } from "../Source/AgentSystem/Safety/AgentSessionApprovalLeaseStore.js";
import { AgentSandboxRuntimeService } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimeService.js";
import { AgentExecutionResourceBroker } from "../Source/AgentSystem/ExecutionResources/AgentExecutionResourceBroker.js";
import { AgentInteractiveTerminalRuntime } from "../Source/AgentSystem/ExecutionResources/AgentInteractiveTerminalRuntime.js";
import { createSeneraExecutionEnvironments } from "../Source/AgentSystem/Execution/SeneraExecutionEnvFactory.js";
import { resolveAgentExecutionResourceLimits } from "../Source/AgentSystem/ExecutionResources/AgentExecutionResourceConfig.js";
import { AgentInteractionInputRuntime } from "../Source/AgentSystem/Interaction/AgentInteractionInputRuntime.js";
import { createAgentRequestCancellationResource } from "../Source/AgentSystem/Session/AgentSessionRunResource.js";
import { AgentArtifactRetentionService } from "../Source/AgentSystem/Artifacts/AgentArtifactRetentionService.js";
import type { AgentSandboxRuntimeAvailability } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimeTypes.js";
import type { SeneraSandboxWorkerClient } from "../Source/AgentSystem/Execution/SeneraSandboxWorkerTypes.js";
import { readAgentProductMetadata } from "../Source/AgentSystem/Core/AgentProductMetadata.js";
import { AgentUpgradeSession } from "../Source/AgentSystem/Upgrade/AgentUpgradeSession.js";
import type { AgentChannelAttachment } from "../Source/AgentSystem/Channels/AgentChannelTypes.js";
import type { AgentUploadAttachment } from "../Source/AgentSystem/Uploads/AgentUploadTypes.js";
import { assertSafeWebUrl } from "../Source/AgentSystem/Web/AgentWebUrlPolicy.js";
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
import { AgentGoalMicroLoopRuntime } from "../Source/AgentSystem/Agenda/AgentGoalMicroLoopRuntime.js";
import { AgentGoalCommandService } from "../Source/AgentSystem/Agenda/AgentGoalCommandService.js";
import { AgentGoalMicroLoopModelDecisionPort } from "../Source/AgentSystem/Agenda/AgentGoalMicroLoopModelDecisionPort.js";
import { AgentGoalMicroLoopDispatchActionPort } from "../Source/AgentSystem/Agenda/AgentGoalMicroLoopDispatchActionPort.js";
import { createAgentGoalMicroLoopCacheOptions } from "../Source/AgentSystem/Agenda/AgentGoalMicroLoopPromptCache.js";
import { createAgentResidentIdleCacheOptions } from "../Source/AgentSystem/World/AgentWorldResidentIdlePromptCache.js";
import { AgentNativeToolApiByEndpoint } from "../Source/AgentSystem/ModelEndpoints/AgentModelEndpointContract.js";
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
  createAgentBackgroundTaskCompletionRequestId,
  renderAgentBackgroundTaskCompletionInput,
} from "../Source/AgentSystem/Orchestration/AgentBackgroundTaskWake.js";
import { AgentWorkflowService } from "../Source/AgentSystem/Orchestration/AgentWorkflowService.js";
import { AgentSubagentRoleCatalog } from "../Source/AgentSystem/Orchestration/AgentSubagentRoleCatalog.js";
import { AgentScheduleRuntime } from "../Source/AgentSystem/Orchestration/AgentScheduleRuntime.js";
import { AgentPresetManager } from "../Source/AgentSystem/Presets/AgentPresetManager.js";
import type { AgentIdentityTemplateValues } from "../Source/AgentSystem/Prompt/AgentIdentityTemplate.js";
import {
  AgentScheduledTaskDeliveryGateway,
  AgentScheduledTaskExecutionSessionGateway,
  AgentScheduledTaskSourceContextGateway,
} from "../Source/AgentSystem/Orchestration/AgentScheduledTaskRunTypes.js";
import { AgentChannelsDatabase } from "../Source/AgentSystem/Channels/AgentChannelsDatabase.js";
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

function isTerminalDetachedChildRun(status: AgentChildRunRecord["status"], record?: AgentChildRunRecord): boolean {
  if (record && record.launchContract.executionMode !== "detach") return false;
  const terminalStatuses: readonly AgentChildRunRecord["status"][] = [
    AgentChildRunStatuses.Completed,
    AgentChildRunStatuses.PartialCompleted,
    AgentChildRunStatuses.Interrupted,
    AgentChildRunStatuses.TimedOut,
    AgentChildRunStatuses.Failed,
    AgentChildRunStatuses.Cancelled,
  ];
  return terminalStatuses.includes(status);
}

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
  const identityTemplateValues = (): AgentIdentityTemplateValues => ({
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
    identityTemplateValues,
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
  const goalCommands = new AgentGoalCommandService({
    agenda,
    timeZone: () => resolveAgentWorldConfig(configSnapshot()).TimeZone,
    reviewDelayMs: () => Math.round(goalMicroLoopConfig().ReviewDelaySeconds * 1_000),
  });
  const goalModelProvider = resolveModelProviderConfig(initialConfig);
  const goalPlannerConfig = resolveActionPlannerConfig(initialConfig, goalModelProvider.Id);
  const goalPlannerClientConfig = goalPlannerConfig.PlanningClient;
  const goalPlannerModelProvider = goalPlannerClientConfig.ModelProvider;
  const goalPlannerModelClient = new AgentActionPlannerModelClient(goalPlannerModelProvider, goalPlannerClientConfig, {
    maxRepairAttempts: goalPlannerConfig.MaxRepairAttempts,
  });
  const goalMicroLoopDecisionPort = new AgentGoalMicroLoopModelDecisionPort({
    client: goalPlannerModelClient,
    invocation: {
      cache: createAgentGoalMicroLoopCacheOptions({
        worldId: agenda.snapshot(resolveAgentWorldConfig(initialConfig).TimeZone).world.id,
        provider: goalPlannerModelProvider.ProviderId,
        api: AgentNativeToolApiByEndpoint[goalPlannerModelProvider.Endpoint],
        model: goalPlannerModelProvider.Model,
      }),
    },
  });
  const residentIdleDecisionPort = new AgentWorldResidentIdleModelDecisionPort({
    client: goalPlannerModelClient,
    invocation: {
      cache: createAgentResidentIdleCacheOptions({
        worldId: agenda.snapshot(resolveAgentWorldConfig(initialConfig).TimeZone).world.id,
        provider: goalPlannerModelProvider.ProviderId,
        api: AgentNativeToolApiByEndpoint[goalPlannerModelProvider.Endpoint],
        model: goalPlannerModelProvider.Model,
      }),
    },
  });
  const continuityEventBridge = new AgentContinuityEventBridge({
    store: continuityRuntime.store,
    identity: continuityRuntime.identity,
    logger,
  });
  const worldLedger = new AgentWorldEventLedger(continuityRuntime.database, agenda);
  const worldMaterializer = new AgentWorldMaterializer({
    ledger: worldLedger,
    graphSnapshot: () =>
      continuityRuntime.store.graphSnapshot(listAgentContinuityAutomaticRecallScopes(continuityRuntime.identity)),
    config: () => resolveAgentWorldConfig(configSnapshot()),
    identityTemplateValues,
  });
  const worldClock = new AgentWorldClock(continuityRuntime.database, worldLedger);
  const worldResidentStates = new AgentResidentStateMachine(continuityRuntime.database, worldLedger);
  const worldHabits = new AgentHabitScheduler(
    continuityRuntime.database,
    worldLedger,
    {
      read: (subjectId, attribute, at) => worldMaterializer.readAttribute(subjectId, attribute, at),
    },
    worldResidentStates,
  );
  const worldWorkLedger = new AgentWorldWorkLedger(continuityRuntime.database);
  const worldAutonomy = new AgentWorldAutonomyRuntime({
    habits: worldHabits,
    config: () => resolveAgentWorldConfig(configSnapshot()),
    workLedger: worldWorkLedger,
    leaseDurationMs: secondsToMilliseconds(resolveAgentWorldConfig(configSnapshot()).ActionBudget.LeaseDurationSeconds),
    retryDelayMs: secondsToMilliseconds(resolveAgentWorldConfig(configSnapshot()).ActionBudget.RetryDelaySeconds),
  });
  const worldHabitRuntime = new AgentWorldHabitRuntime({
    habits: worldHabits,
    workLedger: worldWorkLedger,
    leaseDurationMs: secondsToMilliseconds(resolveAgentWorldConfig(configSnapshot()).ActionBudget.LeaseDurationSeconds),
    retryDelayMs: secondsToMilliseconds(resolveAgentWorldConfig(configSnapshot()).ActionBudget.RetryDelaySeconds),
  });
  const goalMicroLoop = new AgentGoalMicroLoopRuntime({
    agenda,
    timeZone: () => resolveAgentWorldConfig(configSnapshot()).TimeZone,
    decisionPort: goalMicroLoopDecisionPort,
    actionPort: goalMicroLoopActionPort,
    failureReviewDelayMs: () => Math.round(goalMicroLoopConfig().ReviewDelaySeconds * 1_000),
    enabled: () =>
      goalMicroLoopConfig().Enabled && resolveActionPlannerConfig(configSnapshot(), goalModelProvider.Id).Enabled,
    maxCandidates: () => goalMicroLoopConfig().MaxCandidates,
    allowedToolNames: () => goalMicroLoopConfig().AllowedToolNames,
    workLedger: worldWorkLedger,
    leaseDurationMs: secondsToMilliseconds(resolveAgentWorldConfig(configSnapshot()).ActionBudget.LeaseDurationSeconds),
    retryDelayMs: secondsToMilliseconds(resolveAgentWorldConfig(configSnapshot()).ActionBudget.RetryDelaySeconds),
  });
  const residentIdle = new AgentWorldResidentIdleRuntime({
    workLedger: worldWorkLedger,
    decisionPort: residentIdleDecisionPort,
    actionPort: new AgentWorldResidentIdleAgendaActionPort({
      agenda,
      timeZone: () => resolveAgentWorldConfig(configSnapshot()).TimeZone,
      resolveTargetSession: async () => {
        const sessions = residentSessionManagerRef.current?.listSessions() ?? [];
        const selected = options.residentInteractionTarget
          ? await options.residentInteractionTarget(sessions)
          : sessions
              .filter((session) => session.status === AgentSessionStatuses.Idle)
              .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.sessionId;
        return selected?.trim() || undefined;
      },
      delivery: {
        deliver: async (request) => {
          if (!residentSessionManagerRef.current) throw new Error("Resident idle delivery is not ready.");
          const outcome = await residentSessionManagerRef.current.deliverProactiveMessage({
            ...request,
            metadata: {
              proactive: {
                sourceId: AgentWorldActionSourceIds.ResidentIdle,
                deliveryId: request.deliveryId,
              },
            },
            onEvent: (event) => orchestrationEvents.emit(event),
          });
          if (outcome !== "delivered") return outcome;
          return channelServiceRef.current?.deliverProactiveResult(request) ?? "missing";
        },
      },
    }),
    config: () => {
      const config = residentIdleConfig();
      return {
        enabled: config.Enabled && resolveActionPlannerConfig(configSnapshot(), goalModelProvider.Id).Enabled,
        minIntervalMs: secondsToMilliseconds(config.MinIntervalSeconds),
        maxIntervalMs: secondsToMilliseconds(config.MaxIntervalSeconds),
        backoffMultiplier: config.BackoffMultiplier,
        maxPending: config.MaxPending,
      };
    },
    leaseDurationMs: () =>
      secondsToMilliseconds(resolveAgentWorldConfig(configSnapshot()).ActionBudget.LeaseDurationSeconds),
    retryDelayMs: () => secondsToMilliseconds(resolveAgentWorldConfig(configSnapshot()).ActionBudget.RetryDelaySeconds),
  });
  const worldPackageLoader = new AgentWorldPackageLoader({
    workspaceRoot,
    rootDir: workspaceLayout.worldPackagesRoot,
    database: continuityRuntime.database,
    agenda,
    ledger: worldLedger,
    residentStates: worldResidentStates,
    habits: worldHabits,
    autonomy: worldAutonomy,
    config: () => resolveAgentWorldConfig(configSnapshot()),
  });
  const residentWake = new AgentWorldResidentWakeRuntime({
    workLedger: worldWorkLedger,
    actionPort:
      options.residentWakeAction ??
      new AgentWorldResidentWakeEventActionPort({
        ledger: worldLedger,
        timeZone: () => resolveAgentWorldConfig(configSnapshot()).TimeZone,
      }),
    maxPending: Math.max(1, resolveAgentWorldConfig(configSnapshot()).ActionBudget.MaxActionsPerWake),
    leaseDurationMs: secondsToMilliseconds(resolveAgentWorldConfig(configSnapshot()).ActionBudget.LeaseDurationSeconds),
    retryDelayMs: secondsToMilliseconds(resolveAgentWorldConfig(configSnapshot()).ActionBudget.RetryDelaySeconds),
  });
  const presetActivation = new AgentPresetWorldActivationRuntime(worldPackageLoader);
  const startupPresetManager = new AgentPresetManager({
    workspaceRoot,
    config: resolvePresetsConfig(configSnapshot()),
    activation: presetActivation,
  });
  const activePresetCard = await startupPresetManager.synchronizeActivePreset();
  residentDisplayName = activePresetCard?.title ?? resolveAgentWorldConfig(configSnapshot()).Name;
  if (activePresetCard && activePresetCard.worldPackageIds.length > 0) {
    logger.info("世界包已加载", {
      packages: activePresetCard.worldPackageIds,
      rootDir: workspaceLayout.worldPackagesRoot,
    });
  }
  const worldRuntime = new AgentWorldRuntime({
    agenda,
    ledger: worldLedger,
    clock: worldClock,
    habits: worldHabits,
    residentStates: worldResidentStates,
    materializer: worldMaterializer,
    config: () => resolveAgentWorldConfig(configSnapshot()),
    errorSink: (error) => logger.error("世界运行时推进失败", { error: errorMessage(error) }),
    wakeSources: [worldHabitRuntime, worldAutonomy, goalMicroLoop, residentWake, residentIdle],
    workLedger: worldWorkLedger,
    inferenceBudget,
    inferenceBudgetScope: () => continuityRuntime.identity.workspaceId,
  });
  const requestWorldWake = (reason: string): void => {
    void worldRuntime.wake().catch((error) =>
      logger.warn("世界事件唤醒失败", {
        reason,
        error: errorMessage(error),
      }),
    );
  };
  const temporalMemoryWorldBridge = new AgentTemporalMemoryWorldBridge({
    store: continuityRuntime.temporalMemoryStore,
    ledger: worldLedger,
    agenda,
    timeZone: () => resolveAgentWorldConfig(configSnapshot()).TimeZone,
  });
  const worldConversationBridge = new AgentWorldConversationBridge({
    ledger: worldLedger,
    agenda,
    timeZone: () => resolveAgentWorldConfig(configSnapshot()).TimeZone,
    onChanged: () => requestWorldWake("conversation_turn"),
  });
  const worldLifecycleEventBridge = new AgentWorldLifecycleEventBridge({
    ledger: worldLedger,
    agenda,
    timeZone: () => resolveAgentWorldConfig(configSnapshot()).TimeZone,
    logger,
    onChanged: () => requestWorldWake("lifecycle_event"),
  });
  const observeWorldAndContinuityEvent = (event: AgentDomainEvent): void => {
    continuityEventBridge.observe(event);
    worldLifecycleEventBridge.observe(event);
  };
  memoryService.registerDeletionSink(temporalMemoryWorldBridge);
  memoryService.registerCompletedTurnSink(worldConversationBridge);
  memoryService.registerDeletionSink(worldConversationBridge);
  memoryService.registerDeletionSink(worldLifecycleEventBridge);
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
    mcpInputs,
    workspaceRuntime,
    orchestration,
    continuityMemory,
    continuityIdentity: continuityRuntime.identity,
    identityTemplateValues,
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
  const publishChannelStatuses = (statuses: readonly AgentChannelStatus[]): void => {
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
    attachmentResolver: (attachment, source, requestHeaders) =>
      ingestChannelAttachment(workspaceRuntime.uploadStore, attachment, source.platform, requestHeaders),
    resourceResolver: new AgentResourceResolver({
      workspaceRoot,
      config: configSnapshot,
      uploadStore: workspaceRuntime.uploadStore,
    }),
    finalResponseRewriter: channelFinalResponseRewriter,
    onInteraction: async (interaction) => {
      if (interaction.source.platform !== "qq") return;
      const parsed = parseQqApprovalInteraction(interaction.buttonData);
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
    completed: async (record) => {
      const outcome = await sessionManager.wakeFromBackgroundTask({
        sessionId: record.parentSessionId,
        requestId: createAgentBackgroundTaskCompletionRequestId(record),
        input: renderAgentBackgroundTaskCompletionInput(record),
        approvalMode: record.approvalMode,
        modelProviderId: record.modelProviderId,
        metadata: {
          backgroundTask: {
            taskId: record.id,
            runId: record.id,
          },
        },
        onEvent: (event) => orchestrationEvents.emit(event),
      });
      if (outcome === "missing") throw new Error(`Parent session is missing: ${record.parentSessionId}`);
      if (outcome === "busy") throw new Error(`Parent session remained busy: ${record.parentSessionId}`);
    },
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

/**
 * Materializes a channel attachment into the same durable upload store used
 * by the browser composer. The session/model pipeline can then resolve the
 * resource URI instead of depending on a short-lived QQ CDN URL.
 */
function parseQqApprovalInteraction(buttonData: string | undefined):
  | {
      readonly approvalId: string;
      readonly decision: (typeof AgentApprovalDecisions)[keyof typeof AgentApprovalDecisions];
    }
  | undefined {
  const match = /^approve:(.+):(allow-once|allow-always|deny)$/u.exec(buttonData?.trim() ?? "");
  if (!match) return undefined;
  const decision =
    match[2] === "allow-once"
      ? AgentApprovalDecisions.ApproveOnce
      : match[2] === "allow-always"
        ? AgentApprovalDecisions.ApproveSession
        : AgentApprovalDecisions.Deny;
  return { approvalId: match[1]!, decision };
}

async function ingestChannelAttachment(
  store: {
    readonly maxFileBytes: number;
    save(input: { stream: Readable; originalName: string; declaredMime?: string }): Promise<AgentUploadAttachment>;
  },
  attachment: AgentChannelAttachment,
  _platform: string,
  requestHeaders?: Readonly<Record<string, string>>,
): Promise<AgentUploadAttachment | undefined> {
  const rawUrl = attachment.url?.trim().replace(/^\/\//u, "https://");
  if (!rawUrl) return undefined;
  let url: URL;
  try {
    url = await assertSafeWebUrl(rawUrl, {
      maxUrlLength: 8_192,
      allowPrivateNetworks: false,
      allowSyntheticProxyAddresses: true,
    });
  } catch {
    return undefined;
  }

  let response: Response | undefined;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { ...(requestHeaders ?? {}) },
      signal: AbortSignal.timeout(45_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) break;
    url = await assertSafeWebUrl(new URL(location, url), {
      maxUrlLength: 8_192,
      allowPrivateNetworks: false,
      allowSyntheticProxyAddresses: true,
    });
  }
  if (!response) return undefined;
  if (!response.ok || !response.body) throw new Error(`attachment download failed with HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > store.maxFileBytes) {
    throw new Error(`attachment exceeds the ${store.maxFileBytes} byte limit`);
  }
  const stream = Readable.fromWeb(response.body as never);
  return store.save({
    stream,
    originalName: attachment.filename?.trim() || "channel-attachment",
    declaredMime: attachment.contentType ?? response.headers.get("content-type") ?? undefined,
  });
}
