import path from "node:path";
import { z } from "zod";
import { AgentWorkspaceCatalog } from "../Source/AgentSystem/WorkspaceResources/AgentWorkspaceCatalog.js";
import { AgentLoop } from "../Source/AgentSystem/Loop/AgentLoop.js";
import type { AgentCompletedRunResult } from "../Source/AgentSystem/Runtime/AgentExecutionProjector.js";
import { AgentSessionManager } from "../Source/AgentSystem/Session/AgentSessionManager.js";
import { AgentSessionStore } from "../Source/AgentSystem/Session/AgentSessionStore.js";
import { AgentWebSocketServer } from "../Source/AgentSystem/WebSocket/AgentWebSocketServer.js";
import { agentOneBot11ClientPath } from "../Source/AgentSystem/Channels/AgentChannelClientRoutes.js";
import { AgentWebSocketTransport } from "../Source/AgentSystem/WebSocket/AgentWebSocketTransport.js";
import { withAgentModelsDevPricing } from "../Source/AgentSystem/ModelEndpoints/AgentModelPricing.js";
import { resolveAgentApplicationPaths } from "../Source/AgentSystem/Core/AgentApplicationPaths.js";
import { AgentSqliteRunEventWriter } from "../Source/AgentSystem/WebSocket/AgentSqliteRunEventWriter.js";
import { AgentCallbackRunEventWriter } from "../Source/AgentSystem/WebSocket/AgentCallbackRunEventWriter.js";
import {
  resolvePersistenceConfig,
  resolveContinuityLearningConfig,
  resolveAgentLoopConfig,
  resolveArtifactsConfig,
  resolveSandboxRuntimeConfig,
  resolveServerConfig,
  resolveToolExecutionConfig,
  resolveAgentTodosConfig,
  resolveUploadsConfig,
  resolveAgentMcpConnectionsConfig,
  resolveAgentPromptConfig,
  resolveModelProviderConfig,
} from "../Source/AgentSystem/AgentDefaults.js";
import { AgentModelTokenEstimator } from "../Source/AgentSystem/Text/AgentTextBudget.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import { AgentUserProfileManager } from "../Source/AgentSystem/Session/AgentUserProfile.js";
import { AgentDirectory } from "../Source/AgentSystem/Profile/AgentDirectory.js";
import { readAgentMarkdownPromptPreset } from "../Source/AgentSystem/Prompt/AgentMarkdownPromptPreset.js";
import { AgentProfileAvatarStore } from "../Source/AgentSystem/Session/AgentProfileAvatarStore.js";
import { createAgentContinuityRuntime } from "../Source/AgentSystem/Continuity/AgentContinuityRuntime.js";
import { createAgentSelfDiaryPort } from "../Source/AgentSystem/SelfService/AgentSelfDiary.js";
import { AgentContinuityRuntimePool } from "../Source/AgentSystem/Continuity/AgentContinuityRuntimePool.js";
import { migrateWorkspaceLearning } from "../Source/AgentSystem/Continuity/AgentLearningStorage.js";
import { AgentDirectoryLifecycle } from "../Source/AgentSystem/Profile/AgentDirectoryLifecycle.js";
import type { AgentConfigSourceOptions } from "../Source/AgentSystem/Config/AgentConfigService.js";
import { AgentEventKinds } from "../Source/AgentSystem/Events/AgentEvent.js";
import { serializeError } from "../Source/AgentSystem/Diagnostics/AgentErrorSerializer.js";
import { AgentLogger } from "../Source/AgentSystem/Diagnostics/AgentLogger.js";
import {
  AgentWorkspaceLogStore,
  AgentWorkspaceLogStreamNames,
} from "../Source/AgentSystem/Diagnostics/AgentWorkspaceLogStore.js";
import { AgentServerEventLogger } from "../Source/AgentSystem/Diagnostics/AgentServerEventLogger.js";
import { AgentApprovalRuntime } from "../Source/AgentSystem/Approvals/AgentApprovalRuntime.js";
import { AgentPiActiveSessionRegistry } from "../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import { AgentPiSessionMutationService } from "../Source/AgentSystem/Pi/AgentPiSessionMutationService.js";
import { AgentPiSessionCleanupService } from "../Source/AgentSystem/Pi/AgentPiSessionCleanupService.js";
import { createAgentPiDiagnosticLoggerForDetail } from "../Source/AgentSystem/Diagnostics/AgentPiDiagnostics.js";
import { createAgentProviderStreamDiagnosticSink } from "../Source/AgentSystem/Diagnostics/AgentProviderStreamDiagnostics.js";
import { AgentSystemRuntimeCache } from "../Source/AgentSystem/Runtime/AgentSystemRuntimeCache.js";
import { projectAgentStateCardConversationHistory } from "../Source/AgentSystem/StateCard/AgentStateCardRuntime.js";
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
  createSeneraWorkspaceConfigService,
  createSeneraWorkspaceRuntimeDependencies,
  createSeneraWorkspaceRuntimeSnapshot,
  resolveSeneraInitialWorkspaceRuntime,
  projectSeneraSandboxWorkspace,
  projectSeneraWorkspaceRuntimeConfig,
  type SeneraWorkspaceRuntimePreparation,
} from "./ServerWorkspaceRuntime.js";
import { createSeneraWorkspaceHost, type SeneraWorkspaceHost } from "./ServerWorkspaceHost.js";
import { AgentMcpInputService } from "../Source/AgentSystem/Credentials/AgentMcpInputService.js";
import { AgentMcpManagementService } from "../Source/AgentSystem/McpPackages/AgentMcpManagementService.js";
import { createAgentSystemToolHistoryPresentationResolver } from "../Source/AgentSystem/SystemTools/AgentSystemToolHistoryPresentation.js";
import { detectAgentMcpHostCapabilities } from "../Source/AgentSystem/McpPackages/AgentMcpHostRequirements.js";
import { AgentWorkspaceRuntime } from "../Source/AgentSystem/Runtime/AgentWorkspaceRuntime.js";
import { AgentRunDispatchGateway } from "../Source/AgentSystem/Orchestration/AgentRunDispatchPort.js";
import { AgentSessionRunDispatcher } from "../Source/AgentSystem/Session/AgentSessionRunDispatcher.js";
import { AgentOrchestrationDatabase } from "../Source/AgentSystem/Orchestration/AgentOrchestrationDatabase.js";
import { AgentSqliteChildRunRepository } from "../Source/AgentSystem/Orchestration/AgentSqliteChildRunRepository.js";
import { isAgentChildRunBackgroundCompletionDeliverable } from "../Source/AgentSystem/Orchestration/AgentChildRunTypes.js";
import { AgentSqliteWorkflowRepository } from "../Source/AgentSystem/Orchestration/AgentSqliteWorkflowRepository.js";
import { AgentSqliteScheduledTaskStore } from "../Source/AgentSystem/Orchestration/AgentSqliteScheduledTaskStore.js";
import { AgentOrchestrationEventRelay } from "../Source/AgentSystem/Orchestration/AgentOrchestrationEventRelay.js";
import {
  AgentDelegationService,
  type AgentDelegationCompletionPort,
} from "../Source/AgentSystem/Orchestration/AgentDelegationService.js";
import { AgentDelegationCompletionDelivery } from "../Source/AgentSystem/Orchestration/AgentDelegationCompletionDelivery.js";
import { AgentWorkflowService } from "../Source/AgentSystem/Orchestration/AgentWorkflowService.js";
import {
  AgentSubagentRoleCatalog,
  resolveAgentSubagentBuiltinRoleDirectory,
} from "../Source/AgentSystem/Orchestration/AgentSubagentRoleCatalog.js";
import { AgentScheduleRuntime } from "../Source/AgentSystem/Orchestration/AgentScheduleRuntime.js";
import { AgentJobRuntime } from "../Source/AgentSystem/Orchestration/AgentJobRuntime.js";
import type { AgentIdentityDisplayValues } from "../Source/AgentSystem/Text/AgentTextParts.js";
import {
  AgentScheduledTaskDeliveryGateway,
  AgentScheduledTaskExecutionSessionGateway,
  AgentScheduledTaskSourceContextGateway,
} from "../Source/AgentSystem/Orchestration/AgentScheduledTaskRunTypes.js";
import { AgentChannelsDatabase } from "../Source/AgentSystem/Channels/AgentChannelsDatabase.js";
import { createSeneraServerRuntimePlatform } from "./ServerRuntimePlatform.js";
import { createSeneraServerRuntimeStop } from "./ServerRuntimeShutdown.js";
import { bindSeneraServerRuntimeConfigurationSynchronization } from "./ServerRuntimeConfigurationSynchronization.js";
import { startSeneraServerRuntimeConfigWatcher } from "./ServerRuntimeConfigWatcher.js";
import { createSeneraServerInferenceBudget } from "./ServerInferenceBudget.js";
import { createSeneraWorkspaceLogPolicy } from "./ServerRuntimeLogPolicy.js";
import { ingestAgentChannelAttachment } from "../Source/AgentSystem/Channels/AgentChannelAttachmentIngestor.js";
import { parseAgentQqApprovalInteraction } from "../Source/AgentSystem/Channels/AgentQqApprovalInteraction.js";
import { AgentChannelSessionMappingStore } from "../Source/AgentSystem/Channels/AgentChannelSessionMappingStore.js";
import { AgentChannelService, type AgentChannelStatus } from "../Source/AgentSystem/Channels/AgentChannelService.js";
import { createDefaultAgentChannelRegistry } from "../Source/AgentSystem/Channels/AgentChannelAdapterRegistry.js";
import { AgentChannelSessionLifecycle } from "../Source/AgentSystem/Channels/AgentChannelSessionLifecycle.js";
import { AgentPiHistoryBoundaryReader } from "../Source/AgentSystem/Pi/AgentPiHistoryBoundaryReader.js";
import { AgentChannelParticipationStore } from "../Source/AgentSystem/Channels/AgentChannelParticipationStore.js";
import { AgentChannelConversationStore } from "../Source/AgentSystem/Channels/AgentChannelConversationStore.js";
import { AgentInteractionIdentityStore } from "../Source/AgentSystem/Interaction/AgentInteractionIdentityStore.js";
import { AgentEntityReferenceRegistry } from "../Source/AgentSystem/Identity/AgentEntityReferenceRegistry.js";
import { AgentChannelOutbox } from "../Source/AgentSystem/Channels/AgentChannelOutbox.js";
import { AgentChannelIngress } from "../Source/AgentSystem/Channels/AgentChannelIngress.js";
import {
  AgentOneBot11MessageStore,
  agentOneBot11MessageStorePath,
} from "../Source/AgentSystem/Channels/Adapters/AgentOneBot11MessageStore.js";
import { resolveAgentChannelsConfig } from "../Source/AgentSystem/Channels/AgentChannelsConfig.js";
import { AgentChannelWebhookApi } from "../Source/AgentSystem/Channels/AgentChannelWebhookApi.js";
import { AgentChannelToolGateway } from "../Source/AgentSystem/Channels/AgentChannelToolPort.js";
import { AgentResourceResolver } from "../Source/AgentSystem/Resources/AgentResourceResolver.js";
import { AgentToolResourceLeaseCoordinator } from "../Source/AgentSystem/ToolRuntime/AgentToolResourceScheduler.js";
import {
  resolveAgentDelegationConfiguration,
  resolveAgentSchedulerConfiguration,
  resolveAgentJobsConfiguration,
} from "../Source/AgentSystem/Orchestration/AgentOrchestrationConfig.js";
import { AgentRuntimeUpdateDeployments } from "../Source/AgentSystem/Runtime/AgentRuntimeUpdateContract.js";
import {
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
import type { AgentServerAccessProfile } from "../Source/AgentSystem/Auth/AgentServerAccessPolicy.js";

export interface SeneraServerOptions {
  workspaceRoot?: string;
  applicationStateRoot?: string;
  workspaceRoots?: readonly string[];
  /** Called after the initial workspace and every subsequently opened workspace is ready. */
  onWorkspaceOpened?: (root: string, workspaceId: string) => void;
  configPath?: string;
  staticFrontendRoot?: string;
  developmentFrontendUrl?: string;
  /**
   * Root containing the application manifest. Electron keeps package.json in
   * app.asar while extraResources are exposed from the physical resources root.
   */
  applicationRoot?: string;
  resourcesPath?: string;
  configSource?: AgentConfigSourceOptions;
  /** Optional previous application config to copy into the selected workspace. */
  legacyConfigPath?: string;
  runtimeConfigProjection?: (config: AgentSystemConfig, workspaceRoot: string) => AgentSystemConfig;
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
  /** Access policy owned by the process entrypoint, independent of workspace settings. */
  accessProfile?: AgentServerAccessProfile;
  upgradeStateRoot?: string;
  upgradeDataRoots?: readonly string[];
  runtimeImageReference?: string;
  updateManifestUrl?: string;
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
  /** Opens another workspace without interrupting existing sessions or the application transport. */
  switchWorkspace(nextWorkspaceRoot: string): Promise<SeneraServerHandle>;
}

export interface SeneraWorkspaceHandle extends Omit<SeneraServerHandle, "switchWorkspace"> {
  server: AgentWebSocketServer;
}

export async function startSeneraServer(options: SeneraServerOptions = {}): Promise<SeneraServerHandle> {
  const cleanup = new SeneraStartupCleanup();
  try {
    return await startSeneraServerHost(options, cleanup);
  } catch (error) {
    try {
      await cleanup.run();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Application startup cleanup failed.", { cause: cleanupError });
    }
    throw error;
  }
}

async function startSeneraServerHost(
  options: SeneraServerOptions,
  cleanup: SeneraStartupCleanup,
): Promise<SeneraServerHandle> {
  const requestedRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const paths = resolveAgentApplicationPaths(options.applicationStateRoot);
  const applicationStateRoot = paths.root;
  const catalog = new AgentWorkspaceCatalog({
    stateRoot: paths.stateRoot,
    allowedRoots:
      options.workspaceRoots ??
      (process.env.SENERA_WORKSPACE_ROOTS
        ? z.array(z.string().min(1)).nonempty().parse(JSON.parse(process.env.SENERA_WORKSPACE_ROOTS))
        : options.deployment === SeneraServerDeployments.Container
          ? [requestedRoot]
          : undefined),
  });
  const workspaceDescriptor = catalog.register(requestedRoot);
  const workspaceRoot = workspaceDescriptor.root;
  const resourceRoot = path.resolve(options.resourcesPath ?? process.cwd());
  const applicationRoot = path.resolve(options.applicationRoot ?? resourceRoot);
  const product = readAgentProductMetadata(applicationRoot);
  const preparedWorkspace = resolveSeneraInitialWorkspaceRuntime({
    paths,
    workspaceRoot,
    workspaceId: workspaceDescriptor.id,
    resourcesRoot: resourceRoot,
    options,
    legacyConfigPath:
      options.legacyConfigPath ??
      (!options.configSource && !options.configPath && !process.env.AGENT_CONFIG_PATH?.trim()
        ? paths.configPath
        : undefined),
  });
  const { workspaceLayout, configSource, configPath } = preparedWorkspace;
  const upgradeSession = new AgentUpgradeSession({
    workspaceRoot,
    stateRoot: options.upgradeStateRoot ?? workspaceLayout.stateRoot,
    allowedDataRoots: [workspaceLayout.stateRoot, applicationStateRoot, ...(options.upgradeDataRoots ?? [])],
    appVersion: product.version,
    imageReference: options.runtimeImageReference ?? process.env.SENERA_RUNTIME_IMAGE_REFERENCE,
  });
  upgradeSession.recoverInterruptedUpgrade();
  let handle: SeneraServerHandle | undefined;
  try {
    const configService = createSeneraWorkspaceConfigService({
      workspaceRoot,
      configSource,
      upgradeSession,
      applicationPaths: paths,
    });
    cleanup.defer(() => configService.close());
    const transportConfig = (): AgentSystemConfig => {
      const config = configService.snapshot().value;
      const projected = options.runtimeConfigProjection?.(config, workspaceRoot);
      if (!projected || projected.Server === config.Server) return config;
      return { ...config, Server: projected.Server };
    };
    const defaultWorkspaceId = catalog.register(workspaceRoot).id;
    const developmentFrontend = options.developmentFrontendUrl
      ? (await import("./DevelopmentFrontendProxy.js")).createDevelopmentFrontendProxy(options.developmentFrontendUrl)
      : undefined;
    const transport = new AgentWebSocketTransport({
      applicationRoot: applicationStateRoot,
      config: transportConfig,
      defaultWorkspaceId,
      catalog,
      openWorkspace: async (id) => {
        await host.open(catalog.get(id).root);
      },
      forgetWorkspace: async (id) => host.forgetWorkspace(id),
      staticFrontendRoot: options.staticFrontendRoot,
      developmentFrontend,
      accessProfile: options.accessProfile,
    });
    cleanup.defer(() => transport.stop());
    const runtimes = new Map<string, SeneraWorkspaceHandle>();
    const pending = new Map<string, Promise<SeneraServerHandle>>();
    const retiring = new Map<string, Promise<void>>();
    const workspaceSwitchReservations = new Map<string, number>();
    const retireWhenIdle = new Set<string>();
    const workspaceClientCounts = new Map<string, number>();
    const hostLogger = new AgentLogger();
    let workspaceLifecycleTail = Promise.resolve();
    const enqueueWorkspaceLifecycle = <T>(operation: () => Promise<T>): Promise<T> => {
      const previous = workspaceLifecycleTail;
      let release!: () => void;
      workspaceLifecycleTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      return previous.then(operation).finally(release);
    };
    let closing = false;
    let stopPromise: Promise<void> | undefined;
    let stopConfigWatch: () => void = () => {};
    const stop = (): Promise<void> =>
      (stopPromise ??= (async () => {
        closing = true;
        stopConfigWatch();
        await Promise.allSettled(pending.values());
        const outcomes = await Promise.allSettled([...runtimes.values()].map((runtime) => runtime.stop()));
        outcomes.push(...(await Promise.allSettled([transport.stop()])));
        for (const close of [() => configService.close()]) {
          try {
            close();
          } catch (error) {
            outcomes.push({ status: "rejected", reason: error });
          }
        }
        const failures = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason] : []));
        if (failures.length) throw new AggregateError(failures, "Workspace shutdown failed.");
      })());
    const publicHandle = (runtime: SeneraWorkspaceHandle): SeneraServerHandle => ({
      workspaceRoot: runtime.workspaceRoot,
      configPath: runtime.configPath,
      websocketUrl: host.snapshot(runtime.workspaceRoot).websocketUrl,
      healthUrl: runtime.healthUrl,
      stop,
      switchWorkspace: async (root) => {
        const outcome = await host.switchWorkspace(runtime.workspaceRoot, root);
        await outcome.result.finalize?.();
        return publicHandle(outcome.runtime);
      },
    });
    const retireRuntime = (workspaceId: string): Promise<void> => {
      const existingRetirement = retiring.get(workspaceId);
      if (existingRetirement) return existingRetirement;
      const runtime = runtimes.get(workspaceId);
      if (!runtime) return Promise.resolve();
      const operation = runtime.stop().then(() => {
        if (runtimes.get(workspaceId) === runtime) {
          runtimes.delete(workspaceId);
          workspaceClientCounts.delete(workspaceId);
        }
      });
      retiring.set(workspaceId, operation);
      void operation.then(
        () => {
          if (retiring.get(workspaceId) === operation) retiring.delete(workspaceId);
        },
        () => {
          if (retiring.get(workspaceId) === operation) retiring.delete(workspaceId);
        },
      );
      return operation;
    };
    const host = createSeneraWorkspaceHost({
      catalog,
      resourcesRoot: resourceRoot,
      initialWorkspaceRoot: workspaceRoot,
      configService,
      configSource,
      configPath,
      paths,
      transport,
      defaultWorkspaceId,
      product,
      options,
      runtimes,
      pending,
      retiring,
      workspaceSwitchReservations,
      retireWhenIdle,
      workspaceClientCounts,
      isClosing: () => closing,
      hostLogger,
      enqueueWorkspaceLifecycle,
      retireRuntime,
      publicHandle,
      startRuntime: startSeneraServerRuntime,
    });

    const runtime = await startSeneraServerRuntime(
      options,
      workspaceRoot,
      preparedWorkspace,
      upgradeSession,
      cleanup,
      product,
      host,
    );
    runtimes.set(catalog.register(workspaceRoot).id, runtime);
    catalog.recordOpened(workspaceRoot);
    options.onWorkspaceOpened?.(workspaceRoot, defaultWorkspaceId);
    await transport.start();
    stopConfigWatch = startSeneraServerRuntimeConfigWatcher({
      enabled: configSource.kind === "json" && resolveServerConfig(configService.snapshot().value).HotReload,
      configPath,
      configService,
      server: { broadcast: (event) => transport.broadcast(event) },
      logger: new AgentLogger(),
    });
    cleanup.defer(stopConfigWatch);
    handle = publicHandle(runtime);
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
  workspacePreparation: SeneraWorkspaceRuntimePreparation,
  upgradeSession: AgentUpgradeSession,
  startupCleanup: SeneraStartupCleanup,
  product: ReturnType<typeof readAgentProductMetadata>,
  host: SeneraWorkspaceHost,
): Promise<SeneraWorkspaceHandle> {
  const resourceRoot = host.resourcesRoot;
  const workspaceId = host.catalog.register(workspaceRoot).id;
  const usesHostConfig = workspaceRoot === host.initialWorkspaceRoot;
  const { workspaceLayout, configPath, configSource } = workspacePreparation;
  const startupResourceCleanups: Array<() => void> = [];
  const deferResourceCleanup = (callback: () => void | Promise<void>): (() => void) => {
    const cancel = startupCleanup.defer(callback);
    startupResourceCleanups.push(cancel);
    return cancel;
  };
  const eventLogDetail = resolveServerEventLogDetail(process.env.SENERA_LOG_EVENTS);
  const configService = usesHostConfig
    ? host.configService
    : createSeneraWorkspaceConfigService({
        workspaceRoot,
        configSource,
        upgradeSession,
        applicationPaths: host.paths,
      });
  if (!usesHostConfig) startupCleanup.defer(() => configService.close());
  const approvalRuntime = new AgentApprovalRuntime();
  const interactionInput = new AgentInteractionInputRuntime();
  deferResourceCleanup(() => interactionInput.close());
  const piSessionRegistry = new AgentPiActiveSessionRegistry();
  const deployment = options.deployment;
  const projectRuntimeConfig = (config: AgentSystemConfig): AgentSystemConfig =>
    withAgentModelsDevPricing(
      projectSeneraWorkspaceRuntimeConfig({
        config,
        workspaceRoot,
        workspaceLayout,
        local: deployment === SeneraServerDeployments.Local,
        project: options.runtimeConfigProjection,
        disableSandbox: disableSandboxRuntime,
      }),
      host.transport.modelsDevCatalog,
    );
  const initialSnapshot = configService.snapshot();
  const initialConfig = projectRuntimeConfig(initialSnapshot.value);
  const configSnapshot = (): AgentSystemConfig => projectRuntimeConfig(configService.snapshot().value);
  const persistence = resolvePersistenceConfig(initialConfig);
  const logStore = new AgentWorkspaceLogStore({
    root: workspaceLayout.logsRoot,
    policy: createSeneraWorkspaceLogPolicy(configSnapshot),
  });
  deferResourceCleanup(() => logStore.close());
  logStore.start();
  const logger = new AgentLogger({
    verbose: eventLogDetail === "verbose",
    eventDisplayMode: eventLogDetail,
    sink: logStore,
    timeZone: () => resolveAgentPromptConfig(configSnapshot()).TimeZone,
  });
  const eventLogger = new AgentServerEventLogger({
    logger,
    detail: eventLogDetail,
    persistHiddenEvents: () => resolvePersistenceConfig(configSnapshot()).Logs.CaptureHiddenEvents,
  });
  const providerDiagnostics = createAgentProviderStreamDiagnosticSink({
    sink: createAgentPiDiagnosticLoggerForDetail(logger, eventLogDetail),
    policy: () => {
      const logs = resolvePersistenceConfig(configSnapshot()).Logs;
      return {
        enabled: logs.Enabled,
        raw: eventLogDetail === "verbose",
        maxBytes: logs.DetailMaxBytes,
        maxConcurrentWrites: logs.DetailMaxConcurrentWrites,
      };
    },
    publishDetail: (value) => logStore.publishDetail(value),
  });
  deferResourceCleanup(() => providerDiagnostics.close());
  const piDiagnostics = providerDiagnostics.sink;
  const continuityLogger = logger.scoped(AgentWorkspaceLogStreamNames.memos);
  const learningLogger = logger.scoped(AgentWorkspaceLogStreamNames.learning);
  const runtimeDependencies = createSeneraWorkspaceRuntimeDependencies({
    workspaceRoot,
    resourcesRoot: resourceRoot,
    configSnapshot,
    logger,
  });
  deferResourceCleanup(() => runtimeDependencies.close());
  // MCP credentials and typed inputs belong to the selected workspace. Each
  // workspace runtime owns its repository so switching workspaces cannot
  // reuse or overwrite another workspace's vault.
  const mcpInputs = AgentMcpInputService.open(workspaceRoot, process.env, undefined, host.paths);
  // The credential vault has no diagnostic channel of its own, so a key file that left the workspace,
  // or could not, is only visible here.
  for (const relocation of mcpInputs.relocatedLegacyKeys()) {
    if (relocation.relocated) {
      logger.info("credential.secretKeyRelocated", { ...relocation });
    } else {
      logger.warn("credential.secretKeyRelocationFailed", { ...relocation });
    }
  }
  deferResourceCleanup(() => mcpInputs.close());
  const mcpHostCapabilities = detectAgentMcpHostCapabilities();
  const mcpManagement = new AgentMcpManagementService({
    workspaceRoot,
    resourcesRoot: resourceRoot,
    inputs: mcpInputs,
    config: configSnapshot,
    hostCapabilities: mcpHostCapabilities,
  });
  const runtimeSnapshot = createSeneraWorkspaceRuntimeSnapshot({
    configService,
    projectConfig: projectRuntimeConfig,
    resourceRoot,
    workspaceLayout,
    mcpInputsRevision: () => mcpManagement.revision(),
  });
  const sandboxRuntimeService = new AgentSandboxRuntimeService({
    workspaceRoot,
    configSnapshot,
    availability: options.sandboxRuntimeAvailability,
    dockerEngineWorker: options.dockerEngineWorker,
  });
  deferResourceCleanup(() => sandboxRuntimeService.close());
  const sandboxProvider = sandboxRuntimeService.runtimeProvider();
  const sandboxGuestWorkspaceRoot =
    sandboxRuntimeService.sandboxBackendAvailable() && sandboxProvider
      ? options.sandboxGuestWorkspaceRoot
        ? projectSeneraSandboxWorkspace(host.initialWorkspaceRoot, workspaceRoot, options.sandboxGuestWorkspaceRoot)
        : (options.sandboxGuestWorkspaceRoot ??
          resolveAgentDockerEngineGuestWorkspaceRoot(workspaceRoot, sandboxProvider))
      : undefined;
  const createRuntimeExecutionEnvironments = () => {
    const config = configSnapshot();
    return createSeneraExecutionEnvironments({
      workspaceRoot,
      resourcesPath: resourceRoot,
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
    layout: workspaceLayout,
    workspaceRoot,
    uploads: () => resolveUploadsConfig(configSnapshot()),
    artifacts: () => resolveArtifactsConfig(configSnapshot()),
    mcpConnections: () => resolveAgentMcpConnectionsConfig(configSnapshot()),
    logger,
  });
  deferResourceCleanup(() => workspaceRuntime.close());
  const runDispatch = new AgentRunDispatchGateway();
  const orchestrationEvents = new AgentOrchestrationEventRelay();
  const resourceCoordinator = new AgentToolResourceLeaseCoordinator();
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
    builtinRoot: resolveAgentSubagentBuiltinRoleDirectory(path.join(resourceRoot, "System", "Extensions")),
  });
  const scheduledTasks = new AgentSqliteScheduledTaskStore(orchestrationDatabase);
  const schedulerConfiguration = resolveAgentSchedulerConfiguration(initialConfig);
  const jobs: AgentJobRuntime = new AgentJobRuntime({
    database: orchestrationDatabase,
    broker: executionResources,
    workspaceRoot,
    inbox: {
      acceptHostInput: (request) =>
        sessionManager.acceptHostInput({ ...request, onEvent: (event) => orchestrationEvents.emit(event) }),
      withdrawHostInput: (sessionId, deliveryId) => sessionManager.withdrawHostInput(sessionId, deliveryId),
    },
    configuration: () => resolveAgentJobsConfiguration(configSnapshot()),
    readCommittedToolCalls: (sessionId) => piHistoryBoundaries.readCommittedToolCalls(sessionId),
    pendingInputs: (sessionId) => sessionManager.listQueuedInputs(sessionId),
    retryDelayMs: schedulerConfiguration.polling.intervalMs,
    onError: (error) => logger.error("job.notification.failed", { error: errorMessage(error) }),
  });
  deferResourceCleanup(() => jobs.stop());
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
    logger,
    roleCatalog: subagentRoles,
    resourceCoordinator,
  });
  deferResourceCleanup(() => delegation.shutdown());
  jobs.bindAgents(delegation);
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
  const repository = createRepository(
    workspaceRoot,
    initialConfig,
    upgradeSession,
    logger,
    workspaceLayout.databases.sessions,
  );
  deferResourceCleanup(() => repository.close());
  const profileAvatarStore = new AgentProfileAvatarStore(workspaceRoot);
  await new AgentUserProfileManager(repository, profileAvatarStore).emitSnapshot({});
  const legacyPreset =
    repository.loadAgentDirectory() === undefined
      ? readAgentMarkdownPromptPreset(workspaceRoot, resolveServerConfig(initialConfig).RequestMaxBytes)
      : undefined;
  if (legacyPreset?.error) throw new Error(`Cannot migrate the prompt preset: ${legacyPreset.error}`);
  const entityReferences = new AgentEntityReferenceRegistry(workspaceLayout.databases.identities, upgradeSession);
  deferResourceCleanup(() => entityReferences.close());
  const agentDirectory = new AgentDirectory(
    repository,
    {
      assistant: repository.loadUserProfile().assistant,
      ...(legacyPreset?.selection ? { preset: { version: 1, ...legacyPreset.selection } } : {}),
    },
    entityReferences,
  );
  const legacyAgentId = agentDirectory.snapshot().agents[0].id;
  for (const session of repository.listSessionMetadata()) {
    if (session.metadata?.agentId) continue;
    session.metadata = { ...session.metadata, agentId: legacyAgentId };
    repository.upsertSession(session);
  }
  const identityDisplayValues = (sessionId?: string): AgentIdentityDisplayValues => {
    const profile = repository.loadUserProfile();
    const agentId = sessionId ? repository.loadSession(sessionId)?.metadata?.agentId : undefined;
    return { user: profile.name, assistant: agentDirectory.get(agentId).name };
  };
  const sessionStore = new AgentSessionStore({ repository });
  const sessionApprovals = new AgentSessionApprovalLeaseStore();
  const todoConfig = resolveAgentTodosConfig(initialConfig);
  const inferenceBudget = createSeneraServerInferenceBudget(() => configSnapshot());
  await migrateWorkspaceLearning(workspaceLayout, legacyAgentId);
  const resolveSessionAgentId = (sessionId: string): string => {
    const visited = new Set<string>();
    let current = sessionId;
    while (!visited.has(current)) {
      visited.add(current);
      const session = repository.loadSession(current);
      if (session?.metadata?.agentId) return session.metadata.agentId;
      const child = childRuns.getByChildSession(current);
      if (!child) break;
      current = child.parentSessionId;
    }
    throw new Error(`Session ${sessionId} has no authoritative Agent identity.`);
  };
  const channelsDatabase = new AgentChannelsDatabase(workspaceLayout.databases.channels, upgradeSession);
  deferResourceCleanup(() => channelsDatabase.close());
  const interactionIdentities = new AgentInteractionIdentityStore(channelsDatabase.connection, entityReferences);
  interactionIdentities.owner();
  const continuityRuntime = new AgentContinuityRuntimePool({
    layout: workspaceLayout,
    assertAgent: (id) => {
      agentDirectory.get(id);
    },
    sessionAgentId: resolveSessionAgentId,
    create: (agentId, paths) =>
      createAgentContinuityRuntime({
        canonicalSubject: (subject) => interactionIdentities.canonicalSubject(subject),
        agentId,
        ...paths,
        workspaceId,
        upgradeSession,
        configSnapshot,
        todoPolicy: {
          maxItems: todoConfig.MaxItems,
          maxContentCharacters: todoConfig.MaxContentCharacters,
          maxResultCharacters: todoConfig.MaxResultCharacters,
          allowParallelInProgress: todoConfig.AllowParallelInProgress,
        },
        embeddingClient: workspaceRuntime.embedding.client,
        embeddingModel: () => workspaceRuntime.embedding.model,
        identityDisplayValues: () => ({
          user: repository.loadUserProfile().name,
          assistant: agentDirectory.get(agentId).name,
        }),
        logger: continuityLogger,
        learningLogger,
        diagnostics: piDiagnostics,
      }),
  });
  deferResourceCleanup(() => continuityRuntime.close());
  delegation.bindTodoService({
    add: (input) => continuityRuntime.forSession(input.sessionId).todos.add(input),
    update: (input) => continuityRuntime.forSession(input.sessionId).todos.update(input),
    read: (id) => continuityRuntime.forSession(id).todos.read(id),
    fingerprint: (id) => continuityRuntime.forSession(id).todos.fingerprint(id),
  });
  const platform = await createSeneraServerRuntimePlatform({
    diaries: createAgentSelfDiaryPort({
      defaultSubject: () => interactionIdentities.owner().id,
      store: (agentId) => continuityRuntime.forAgent(agentDirectory.get(agentId).id).diaries,
      config: () => resolveContinuityLearningConfig(configSnapshot()).Diary,
    }),
    resourceRoot,
    workspaceRoot,
    workspaceLayout,
    configPath,
    configSnapshot,
    systemSkillSources: () => mcpManagement.systemSkillSources(),
    agentDirectory,
    configService,
    sessionStore,
    resolveSessionAgentId,
    logStore,
    logger,
  });
  const { pluginHost, selfService } = platform;
  deferResourceCleanup(() => platform.stop());
  const stateCardHistory = (sessionId: string, excludedRequestId?: string) => {
    const session = sessionStore.get(sessionId);
    if (session.kind === "missing") return [];
    return projectAgentStateCardConversationHistory(
      session.session.conversation,
      continuityRuntime.forSession(sessionId).memos.readStateCardHistory(sessionId, excludedRequestId),
      excludedRequestId,
    );
  };
  const channelToolPortRef: { current?: AgentChannelService } = {};
  const channelTools = new AgentChannelToolGateway(() => channelToolPortRef.current);
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
    resourcesPath: resourceRoot,
    browserProfilesRoot: host.paths.browserProfilesRoot,
    executionResources,
    sandboxRuntimeReady: () => sandboxRuntimeService.snapshot().state === "ready",
    sandboxAvailable: sandboxRuntimeService.sandboxBackendAvailable(),
    sandboxProvider: sandboxRuntimeService.runtimeProvider(),
    dockerEngineWorker: sandboxRuntimeService.dockerEngineWorkerClient(),
    sandboxGuestWorkspaceRoot,
    mcpInputs,
    workspaceRuntime,
    orchestration: { delegation, schedules, jobs },
    identityDisplayValues,
    agentServices: (agent) => {
      const scope = continuityRuntime.forAgent(agentDirectory.get(agent?.id).id);
      return {
        continuityMemory: scope.promptContext,
        continuityIdentity: scope.identity,
        continuityLifecycle: scope.lifecycle,
        continuityRecall: scope.recall,
        continuityMemOS: scope.memos,
        executionLedger: scope.executionLedger,
        todos: scope.todos,
        learningRequests: scope.learningRequests,
      };
    },
    stateCardHistory,
    inferenceBudget,
    learningLogger,
    selfService,
    pluginHost,
    resourceCoordinator,
    mcpHostCapabilities,
    mcpActivationEntries: () => mcpManagement.activationEntries(),
    systemActivationEntries: () => mcpManagement.systemActivationEntries(),
    channelTools,
  });
  deferResourceCleanup(() => runtimeCache.clear());
  runtimeCache.setObserved(false);
  const { selfHttpApi } = platform;

  const loopFactory = (
    modelProviderId?: string,
    session?: import("../Source/AgentSystem/Session/AgentSession.js").AgentSession,
  ) => {
    const agent = agentDirectory.resolve(session?.metadata?.agentId);
    const lease = runtimeCache.acquire(modelProviderId ?? agent.modelProviderId ?? undefined, agent);
    try {
      const loop = new AgentLoop({
        runtime: lease.runtime,
        preparationFingerprint: lease.preparationFingerprint,
      });
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        lease.release();
      };

      return {
        preparationFingerprint: lease.preparationFingerprint,
        modelProvider: loop.modelProvider,
        run: async (...args: Parameters<AgentLoop["run"]>) => {
          try {
            return await loop.run(...args);
          } catch (error) {
            release();
            throw error;
          }
        },
        finalizeCompletedTurn: (result: AgentCompletedRunResult) => {
          try {
            loop.finalizeCompletedTurn(result);
          } finally {
            release();
          }
        },
        discardCompletedTurn: (result?: AgentCompletedRunResult) => {
          try {
            loop.discardCompletedTurn(result);
          } finally {
            release();
          }
        },
      };
    } catch (error) {
      lease.release();
      throw error;
    }
  };
  const piSessionMutations = new AgentPiSessionMutationService({
    acquireRuntime: (modelProviderId) => runtimeCache.acquire(modelProviderId, agentDirectory.resolve()),
    diagnostics: piDiagnostics,
  });
  const piSessionCleanup = new AgentPiSessionCleanupService({
    workspaceRoot,
    sessionsRoot: workspaceLayout.piSessionsRoot,
  });
  const piHistoryBoundaries = new AgentPiHistoryBoundaryReader({
    workspaceRoot,
    sessionsRoot: workspaceLayout.piSessionsRoot,
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
  const channelSessionMappings = new AgentChannelSessionMappingStore(channelsDatabase.connection);
  const channelParticipation = new AgentChannelParticipationStore(channelsDatabase.connection);
  const channelConversations = new AgentChannelConversationStore(channelsDatabase.connection);
  for (const lane of channelSessionMappings.listAll()) {
    if (lane.platform === "onebot11" && !lane.authority && lane.chatType === "group" && !lane.agentId)
      channelSessionMappings.adoptAgentLane({ ...lane, agentId: legacyAgentId });
  }
  const oneBot11RuntimeDirectory = path.join(workspaceLayout.stateRoot, "onebot11");
  const oneBot11MessageStore = new AgentOneBot11MessageStore(agentOneBot11MessageStorePath(oneBot11RuntimeDirectory));
  deferResourceCleanup(() => oneBot11MessageStore.close());
  const channelRegistry = createDefaultAgentChannelRegistry({
    agentDirectory,
    oneBot11RuntimeDirectory,
    oneBot11MessageStore,
    participationStore: channelParticipation,
    uploadStore: workspaceRuntime.uploadStore,
    oneBot11MediaBasePath: `${agentOneBot11ClientPath(workspaceId)}media`,
    oneBot11OperatorDisplayName: () => identityDisplayValues().user,
  });
  const channelSessionLifecycle = new AgentChannelSessionLifecycle(
    channelSessionMappings,
    channelRegistry,
    channelParticipation,
  );
  const sessionManager: AgentSessionManager = new AgentSessionManager({
    onQueuedInputAccepted: (input) => jobs.inputAccepted(input),
    canWakeQueuedInputs: (inputs) => jobs.canWakeQueuedInputs(inputs),
    activateQueuedInput: (input, onEvent) => delegation.activateQueuedInput(input.request, onEvent),
    onTurnStart: ({ sessionId, requestId, onEvent }) => {
      continuityRuntime.forSession(sessionId).todos.write({ sessionId, requestId, onEvent, todos: [], source: "host" });
    },
    resolveInteraction: (interaction) => {
      if (interaction?.surface === "channel") {
        if (!interaction.actor && interaction.wake?.reason !== "time")
          throw new Error("Channel admission requires a host-resolved actor.");
        return interaction;
      }
      return { ...interaction, surface: "console", actor: interactionIdentities.owner() };
    },
    historyResources: [
      {
        id: "onebot11_task_history",
        release: async ({ sessionId, requestIds }) => oneBot11MessageStore.removeRequests(sessionId, requestIds),
      },
      {
        id: "channel_participation_history",
        release: async ({ sessionId, requestIds }) => channelParticipation.removeRequests(sessionId, requestIds),
      },
      {
        id: "context_inspection_history",
        release: ({ sessionId, requestIds }) =>
          workspaceRuntime.uploadStore.deletePersistentOwned({ sessionId, requestIds }),
      },
    ],
    loopFactory,
    resolveAgentId: (id) => agentDirectory.resolve(id).id,
    agentModelProviderId: (id) => agentDirectory.resolve(id).modelProviderId ?? undefined,
    store: sessionStore,
    readHistoryBoundary: (sessionId) => piHistoryBoundaries.read(sessionId),
    readCommittedInputs: (sessionId) => piHistoryBoundaries.readCommittedInputs(sessionId),
    createHistoryPresentationResolver: () =>
      createAgentSystemToolHistoryPresentationResolver(mcpManagement.systemSettingsSnapshot()),
    managedSessionIds: new Set(childRuns.listAll().map((run) => run.childSessionId)),
    memoryService: continuityRuntime.memory,
    logger,
    runResources: [
      createAgentRequestCancellationResource("approval", approvalRuntime),
      createAgentRequestCancellationResource("interaction_input", interactionInput),
    ],
    sessionResources: [
      {
        id: "onebot11_task_history",
        release: async ({ sessionId }) => oneBot11MessageStore.removeSession(sessionId),
      },
      {
        id: "channel_participation_tasks",
        release: async ({ sessionId }) => channelParticipation.removeSession(sessionId),
      },
      {
        id: "channel_history",
        release: ({ sessionId }) => channelSessionLifecycle.release(sessionId),
      },
      {
        id: "approval_session_leases",
        release: async ({ sessionId }) => sessionApprovals.revoke(sessionId),
      },
      {
        id: "execution_resources",
        release: ({ sessionId }) => executionResources.releaseAll({ workspaceRoot, sessionId }),
      },
      {
        id: "background_job_results",
        release: async ({ sessionId }) => jobs.removeOwnerSession(sessionId),
      },
      {
        id: "scheduled_tasks",
        release: ({ sessionId }) => schedules.removeOwnerSession(sessionId),
      },
      {
        id: "context_inspection_session",
        release: ({ sessionId }) => workspaceRuntime.uploadStore.deletePersistentOwned({ sessionId }),
      },
    ],
    piSessions: piSessionRegistry,
    piDiagnostics,
    uploadStore: workspaceRuntime.uploadStore,
    imageNormalization: workspaceRuntime.imageNormalization,
    piSessionMutations,
    piSessionManagement: piSessionMutations,
    piSessionCleanup,
    runControl: {
      get settlementTimeoutMs() {
        return resolveAgentLoopConfig(configSnapshot()).RunSettlementTimeoutMs;
      },
    },
    artifactSessionCleanup: artifactRetention,
  });
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
    identities: interactionIdentities,
    conversations: channelConversations,
    config: () => resolveAgentChannelsConfig(configSnapshot()),
    registry: channelRegistry,
    sessionLifecycle: channelSessionLifecycle,
    sessionManager,
    mappingStore: channelSessionMappings,
    outbox: new AgentChannelOutbox(channelsDatabase.connection),
    ingress: new AgentChannelIngress(channelsDatabase.connection),
    participationStore: channelParticipation,
    inboxBudget: (source, modelProviderId) => {
      const agent = agentDirectory.resolve(source.agentId);
      const defaults = mcpManagement.materializeSystemToolArguments("ChannelReadHistory", {});
      if (!defaults.ok || typeof defaults.value.limit !== "number")
        throw new Error("The channel history contract must declare a valid default page size.");
      const config = configSnapshot();
      const provider = resolveModelProviderConfig(config, modelProviderId ?? agent.modelProviderId ?? undefined);
      const estimator = new AgentModelTokenEstimator({ model: provider.Model });
      const capacity = resolveArtifactsConfig(config).ToolObservationMaxTokens;
      return { pageSize: defaults.value.limit, fits: (text) => estimator.inspect(text, capacity).withinLimit };
    },
    attachmentResolver: (attachment, _source, requestHeaders) =>
      ingestAgentChannelAttachment(workspaceRuntime.uploadStore, attachment, requestHeaders),
    resourceResolver: new AgentResourceResolver({
      artifactManifestIndex: workspaceRuntime.artifactManifestIndex,
      workspaceRoot,
      config: configSnapshot,
      uploadStore: workspaceRuntime.uploadStore,
    }),
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
  channelToolPortRef.current = channelService;
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
  const unbindDelegationCompletionPorts = (options.delegationCompletionPorts ?? []).map((port) =>
    delegationCompletion.bind(port),
  );
  const unbindAgentInbox = delegation.bindInbox((request) => sessionManager.acceptHostInput(request));
  deferResourceCleanup(
    sessionManager.registerInputSource({
      beforeInput: () => {},
      observed: (boundary) => jobs.observed(boundary),
    }),
  );
  deferResourceCleanup(unbindAgentInbox);
  const unbindScheduleInstructions = schedules.bindInstructions({
    admit: (task, run, tools) =>
      sessionManager.acceptScheduledInstruction(task, run, tools, (event) => orchestrationEvents.emit(event)),
  });
  deferResourceCleanup(unbindScheduleInstructions);
  const unbindParentWake = delegationCompletion.bind({
    id: "senera.agent-inbox",
    completed: async (record) => {
      if (record.parentResultDeliveredAt) return;
      await jobs.deliverAgentCompletion(record);
      if (childRuns.get(record.id)?.childRequestId === record.childRequestId)
        childRuns.markParentResultDelivered(record.id);
    },
  });
  deferResourceCleanup(unbindParentWake);
  deferResourceCleanup(() => {
    for (const unbind of unbindDelegationCompletionPorts) unbind();
  });
  for (const record of childRuns.listAll()) {
    if (!isAgentChildRunBackgroundCompletionDeliverable(record)) continue;
    void delegationCompletion.completed(record).catch(() => undefined);
  }
  const unbindRunDispatch = runDispatch.bind(new AgentSessionRunDispatcher(sessionManager));
  deferResourceCleanup(unbindRunDispatch);
  const eventWriter =
    persistence.Kind === "sqlite"
      ? new AgentSqliteRunEventWriter({
          databasePath: workspaceLayout.databases.sessions,
          restartDelayMs: persistence.EventWriter.RestartDelayMs,
          closeTimeoutMs: persistence.EventWriter.CloseTimeoutMs,
          drainBatchSize: persistence.EventWriter.DrainBatchSize,
          committedRetentionMs: persistence.EventWriter.CommittedRetentionMs,
        })
      : new AgentCallbackRunEventWriter((events) => sessionManager.recordRunEvents(events));
  const cancelEventWriterCleanup = deferResourceCleanup(() => eventWriter.close());
  const userProfileManager = new AgentUserProfileManager(repository, profileAvatarStore, agentDirectory);
  const agentDirectoryCommands = new AgentDirectoryLifecycle({
    directory: agentDirectory,
    cleanup: async (agent) => {
      const ownedSessions = new Set<string>();
      const settledSessions = new Set<string>();
      // Stop producers before deleting anything. Descendants created during cancellation
      // are discovered from persisted ownership and the child-run graph, never display names.
      while (true) {
        for (const session of repository.listSessionMetadata()) {
          if (session.metadata?.agentId === agent.id) ownedSessions.add(session.id);
        }
        for (const run of childRuns.listAll()) {
          if (ownedSessions.has(run.parentSessionId)) ownedSessions.add(run.childSessionId);
        }
        const pending = [...ownedSessions].filter((id) => !settledSessions.has(id));
        if (!pending.length) break;
        await Promise.all(
          pending.map(async (sessionId) => {
            await sessionManager.requestActiveRunCancellation({ sessionId });
            await schedules.removeOwnerSession(sessionId);
            for (const workflow of workflows.list(sessionId)) await workflows.cancel(workflow.id, sessionId);
            for (const run of childRuns.listForParent(sessionId)) {
              await delegation.stop(run.id, sessionId);
              await delegation.wait(run.id, sessionId);
            }
            await sessionManager.waitForIdle(sessionId);
            settledSessions.add(sessionId);
          }),
        );
      }
      const ownedLanes = channelSessionMappings
        .listAll()
        .filter(
          (lane) =>
            ownedSessions.has(lane.sessionId) ||
            lane.agentId === agent.id ||
            (lane.platform === "onebot11" &&
              !lane.authority &&
              lane.chatType === "direct" &&
              agent.qqUserId !== null &&
              lane.chatId === String(agent.qqUserId)),
        );
      orchestrationDatabase.removeSessions(ownedSessions);
      for (const id of ownedSessions)
        await sessionManager.closeSession({
          sessionId: id,
          onEvent: (event) => publishChannelServer.current?.broadcast(event),
        });
      for (const lane of ownedLanes) channelSessionMappings.removeLane(lane);
      const snapshot = agentDirectory.snapshot();
      if (agent.qqUserId !== null) oneBot11MessageStore.removeSender(String(agent.qqUserId));
      if (snapshot.operatorId !== null) {
        const conversations = [
          ...(agent.qqUserId === null ? [] : [{ chatType: "direct" as const, chatId: String(agent.qqUserId) }]),
          ...snapshot.groups
            .filter((group) => group.memberAgentIds.every((id) => id === agent.id))
            .map((group) => ({ chatType: "group" as const, chatId: String(group.id) })),
        ];
        for (const conversation of conversations) {
          const source = { ...conversation, platform: "onebot11" as const, userId: String(snapshot.operatorId) };
          oneBot11MessageStore.clear(source);
          channelParticipation.clear(source);
        }
      }
      await runtimeCache.retireAgent(agent.id);
      await continuityRuntime.remove(agent.id);
      if (
        agent.avatarPath &&
        !agentDirectory
          .snapshot()
          .agents.some((other) => other.id !== agent.id && other.avatarPath === agent.avatarPath)
      ) {
        await profileAvatarStore.remove("assistant", agent.avatarPath);
      }
    },
  });
  await agentDirectoryCommands.recover();
  const listener = host.transport.listener;
  const server = new AgentWebSocketServer({
    artifactManifestIndex: workspaceRuntime.artifactManifestIndex,
    onClientCountChanged: (count) => {
      runtimeCache.setObserved(count > 0);
      host.onWorkspaceClientCountChanged(workspaceId, count);
    },
    authenticationRoot: host.paths.root,
    transport: host.transport,
    workspaceId: host.catalog.register(workspaceRoot).id,
    workspaceCatalog: host.catalog,
    openWorkspace: async (id) => {
      await host.open(host.catalog.get(id).root);
    },
    config: initialConfig,
    workspaceRoot,
    accessProfile: options.accessProfile,
    staticFrontendRoot: options.staticFrontendRoot,
    configService,
    configSnapshot,
    sessionManager,
    userProfileManager,
    profileAvatarStore,
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
    pluginHost,
    runtimeDependencies,
    uploadStore: workspaceRuntime.uploadStore,
    channelWebhookApi,
    selfApi: selfHttpApi,
    channelControl: channelService,
    channelClient: {
      extensions: host.clientExtensions,
      product,
      resourcesRoot: resourceRoot,
      developmentFrontendUrl: options.developmentFrontendUrl,
      mediaRoot: path.join(workspaceLayout.stateRoot, "onebot11", "media"),
      resolveMediaMetadata: (name) => oneBot11MessageStore.mediaMetadata(name),
      conversations: channelService,
    },
    agentDirectory,
    agentDirectoryCommands,
    workspaceInfo: () => host.snapshot(workspaceRoot),
    workspaceSwitchRequest: async (nextWorkspaceRoot) => {
      const outcome = await host.switchWorkspace(workspaceRoot, nextWorkspaceRoot);
      return outcome.result;
    },
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
  deferResourceCleanup(
    agentDirectory.subscribe(() => {
      void server
        .broadcast({ kind: AgentEventKinds.AgentDirectorySnapshot, context: {}, data: agentDirectory.snapshot() })
        .catch((error: unknown) => logger.warn("agents.broadcast_failed", { error: serializeError(error) }));
    }),
  );
  const unsubscribeConfiguration = bindSeneraServerRuntimeConfigurationSynchronization({
    workspaceRoot,
    configService,
    configSnapshot,
    channelService,
    server,
    logger,
  });
  deferResourceCleanup(unsubscribeConfiguration);
  channelService.setEventSink((event) => server.broadcast(event));
  sessionManager.setQueuedInputSink((input) =>
    input.request.interaction?.surface === "channel"
      ? channelService.queuedInputSink(input)
      : (event) => server.broadcast(event),
  );
  cancelEventWriterCleanup();
  deferResourceCleanup(() => server.stop());
  approvalRuntime.setEventSink((event) => server.broadcast(event));
  interactionInput.setEventSink((event) => server.broadcast(event));
  executionResources.setEventSink((event) => server.broadcast(event));
  orchestrationEvents.setSink((event) => server.broadcast(event));
  await jobs.replay();
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
  deferResourceCleanup(unsubscribeSandboxStatus);

  upgradeSession.markStarting();
  await server.start();
  await platform.start({
    host: listener.host,
    port: listener.port,
    workspaceId: host.catalog.register(workspaceRoot).id,
  });
  if (workspaceRoot === host.initialWorkspaceRoot) {
    // Channels report their own connecting/connected/failed state. External
    // handshakes are not a prerequisite for the console's HTTP/WS listener.
    // The service lifecycle queue also owns startup during shutdown/reconfigure.
    void channelService.start().catch((error) => {
      logger.error("渠道启动失败", { error: errorMessage(error) });
    });
  }
  await schedules.start();
  artifactRetention.start();
  startSandboxRuntimePreparation({
    config: initialConfig,
    sandboxRuntimeService,
    logger,
    prepared: options.sandboxRuntimePrepared ?? false,
  });

  const stop = createSeneraServerRuntimeStop({
    oneBot11MessageStore,
    entityReferences,
    unsubscribeConfiguration,
    unsubscribeSandboxStatus,
    sessionManager,
    schedules,
    workflows,
    delegation,
    delegationCompletion,
    channelService,
    server,
    platform,
    orchestrationEvents,
    unbindRuntimeBindings: () => {
      unbindRunDispatch();
      unbindScheduledTaskDelivery();
      unbindScheduledTaskSourceContext();
      unbindScheduledTaskExecutionSessions();
      for (const unbind of unbindDelegationCompletionPorts) unbind();
    },
    runtimeDependencies,
    runtimeCache,
    workspaceRuntime,
    executionResources,
    interactionInput,
    mcpInputs,
    artifactRetention,
    logStore,
    sandboxRuntimeService,
    continuityRuntime,
    repository,
    orchestrationDatabase,
    channelsDatabase,
    configService: usesHostConfig ? undefined : configService,
  });

  for (const cancel of startupResourceCleanups) cancel();
  startupCleanup.defer(stop);

  return {
    workspaceRoot,
    configPath,
    websocketUrl: host.transport.websocketUrl,
    healthUrl: `http://${resolveHealthCheckHost(listener.host)}:${listener.port}/health/ready`,
    stop,
    server,
  };
}
