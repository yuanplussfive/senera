import path from "node:path";
import { z } from "zod";
import { AgentWorkspaceCatalog } from "../Source/AgentSystem/WorkspaceResources/AgentWorkspaceCatalog.js";
import { AgentLoop } from "../Source/AgentSystem/Loop/AgentLoop.js";
import type { AgentCompletedRunResult } from "../Source/AgentSystem/Runtime/AgentExecutionProjector.js";
import { AgentSessionManager } from "../Source/AgentSystem/Session/AgentSessionManager.js";
import { AgentSessionStore } from "../Source/AgentSystem/Session/AgentSessionStore.js";
import { AgentWebSocketServer } from "../Source/AgentSystem/WebSocket/AgentWebSocketServer.js";
import { AgentWebSocketTransport } from "../Source/AgentSystem/WebSocket/AgentWebSocketTransport.js";
import { resolveAgentApplicationPaths } from "../Source/AgentSystem/Core/AgentApplicationPaths.js";
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
  resolveUploadsConfig,
  resolveActionPlannerConfig,
  resolveAgentMcpConnectionsConfig,
  resolveAgentPromptConfig,
} from "../Source/AgentSystem/AgentDefaults.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import { AgentUserProfileManager } from "../Source/AgentSystem/Session/AgentUserProfile.js";
import { createAgentContinuityRuntime } from "../Source/AgentSystem/Continuity/AgentContinuityRuntime.js";
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
  createSeneraWorkspaceConfigService,
  createSeneraWorkspaceRuntimeDependencies,
  createSeneraWorkspaceRuntimeSnapshot,
  resolveSeneraHostedWorkspaceRuntime,
  resolveSeneraInitialWorkspaceRuntime,
  projectSeneraSandboxWorkspace,
  projectSeneraWorkspaceRuntimeConfig,
} from "./ServerWorkspaceRuntime.js";
import { createSeneraWorkspaceHost, type SeneraWorkspaceHost } from "./ServerWorkspaceHost.js";
import { AgentMcpInputService } from "../Source/AgentSystem/Credentials/AgentMcpInputService.js";
import { AgentMcpManagementService } from "../Source/AgentSystem/McpPackages/AgentMcpManagementService.js";
import { detectAgentMcpHostCapabilities } from "../Source/AgentSystem/McpPackages/AgentMcpHostRequirements.js";
import { AgentWorkspaceRuntime } from "../Source/AgentSystem/Runtime/AgentWorkspaceRuntime.js";
import { AgentRunDispatchGateway } from "../Source/AgentSystem/Orchestration/AgentRunDispatchPort.js";
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
import {
  AgentSubagentRoleCatalog,
  resolveAgentSubagentBuiltinRoleDirectory,
} from "../Source/AgentSystem/Orchestration/AgentSubagentRoleCatalog.js";
import { AgentScheduleRuntime } from "../Source/AgentSystem/Orchestration/AgentScheduleRuntime.js";
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
import { ingestAgentChannelAttachment } from "../Source/AgentSystem/Channels/AgentChannelAttachmentIngestor.js";
import { parseAgentQqApprovalInteraction } from "../Source/AgentSystem/Channels/AgentQqApprovalInteraction.js";
import { AgentChannelSessionMappingStore } from "../Source/AgentSystem/Channels/AgentChannelSessionMappingStore.js";
import { AgentChannelService, type AgentChannelStatus } from "../Source/AgentSystem/Channels/AgentChannelService.js";
import { createAgentChannelFinalResponseRewriter } from "../Source/AgentSystem/Channels/AgentChannelFinalResponse.js";
import { createDefaultAgentChannelRegistry } from "../Source/AgentSystem/Channels/AgentChannelAdapterRegistry.js";
import { resolveAgentChannelsConfig } from "../Source/AgentSystem/Channels/AgentChannelsConfig.js";
import { AgentChannelWebhookApi } from "../Source/AgentSystem/Channels/AgentChannelWebhookApi.js";
import { AgentResourceResolver } from "../Source/AgentSystem/Resources/AgentResourceResolver.js";
import { AgentToolResourceLeaseCoordinator } from "../Source/AgentSystem/ToolRuntime/AgentToolResourceScheduler.js";
import {
  resolveAgentDelegationConfiguration,
  resolveAgentSchedulerConfiguration,
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

export interface SeneraServerOptions {
  workspaceRoot?: string;
  applicationStateRoot?: string;
  workspaceRoots?: readonly string[];
  onWorkspaceOpened?: (root: string, workspaceId: string) => void;
  configPath?: string;
  staticFrontendRoot?: string;
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
  /** Enables automatic loopback HTTP for container-local browser access. */
  automaticLoopbackHttp?: boolean;
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
    const configService = createSeneraWorkspaceConfigService({ workspaceRoot, configSource, upgradeSession });
    cleanup.defer(() => configService.close());
    const transportConfig = (): AgentSystemConfig => {
      const config = configService.snapshot().value;
      const projected = options.runtimeConfigProjection?.(config, workspaceRoot);
      if (!projected || projected.Server === config.Server) return config;
      return { ...config, Server: projected.Server };
    };
    const defaultWorkspaceId = catalog.register(workspaceRoot).id;
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
      automaticLoopbackHttp: options.automaticLoopbackHttp,
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

    const runtime = await startSeneraServerRuntime(options, workspaceRoot, upgradeSession, cleanup, product, host);
    runtimes.set(catalog.register(workspaceRoot).id, runtime);
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
  upgradeSession: AgentUpgradeSession,
  startupCleanup: SeneraStartupCleanup,
  product: ReturnType<typeof readAgentProductMetadata>,
  host: SeneraWorkspaceHost,
): Promise<SeneraWorkspaceHandle> {
  const resourceRoot = host.resourcesRoot;
  const workspaceId = host.catalog.register(workspaceRoot).id;
  const usesHostConfig = workspaceRoot === host.initialWorkspaceRoot;
  const configSource = usesHostConfig ? host.configSource : host.resolveConfigSource(workspaceRoot);
  const workspacePaths = resolveSeneraHostedWorkspaceRuntime({
    paths: host.paths,
    workspaceRoot,
    workspaceId,
    resourcesRoot: resourceRoot,
    configSource,
  });
  const { workspaceLayout, configPath } = workspacePaths;
  const startupResourceCleanups: Array<() => void> = [];
  const deferResourceCleanup = (callback: () => void | Promise<void>): (() => void) => {
    const cancel = startupCleanup.defer(callback);
    startupResourceCleanups.push(cancel);
    return cancel;
  };
  const eventLogDetail = resolveServerEventLogDetail(process.env.SENERA_LOG_EVENTS);
  const configService = usesHostConfig
    ? host.configService
    : createSeneraWorkspaceConfigService({ workspaceRoot, configSource, upgradeSession });
  if (!usesHostConfig) startupCleanup.defer(() => configService.close());
  const approvalRuntime = new AgentApprovalRuntime();
  const interactionInput = new AgentInteractionInputRuntime();
  deferResourceCleanup(() => interactionInput.close());
  const piSessionRegistry = new AgentPiActiveSessionRegistry();
  const deployment = options.deployment;
  const projectRuntimeConfig = (config: AgentSystemConfig): AgentSystemConfig =>
    projectSeneraWorkspaceRuntimeConfig({
      config,
      workspaceRoot,
      workspaceLayout,
      local: deployment === SeneraServerDeployments.Local,
      project: options.runtimeConfigProjection,
      disableSandbox: disableSandboxRuntime,
    });
  const initialSnapshot = configService.snapshot();
  const initialConfig = projectRuntimeConfig(initialSnapshot.value);
  const configSnapshot = (): AgentSystemConfig => projectRuntimeConfig(configService.snapshot().value);
  const persistence = resolvePersistenceConfig(initialConfig);
  const logPolicy = () => {
    const logs = resolvePersistenceConfig(configSnapshot()).Logs;
    return {
      enabled: logs.Enabled,
      detailMaxBytes: logs.DetailMaxBytes,
      projectionMaxBytes: logs.ProjectionMaxBytes,
      retentionHours: logs.RetentionHours,
      queryPageSize: logs.QueryPageSize,
      tailLineCount: logs.TailLineCount,
    };
  };
  const logStore = new AgentWorkspaceLogStore({
    root: workspaceLayout.logsRoot,
    policy: logPolicy,
  });
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
  const piDiagnostics = createAgentPiDiagnosticLoggerForDetail(logger, eventLogDetail);
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
  const mcpInputs = AgentMcpInputService.open(workspaceRoot);
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
    resourceCoordinator,
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
  const repository = createRepository(
    workspaceRoot,
    initialConfig,
    upgradeSession,
    logger,
    workspaceLayout.databases.sessions,
  );
  deferResourceCleanup(() => repository.close());
  const identityDisplayValues = (): AgentIdentityDisplayValues => ({
    user: repository.loadUserProfile().name,
    resident: "Senera",
  });
  const sessionStore = new AgentSessionStore({ repository });
  const sessionApprovals = new AgentSessionApprovalLeaseStore();
  const todoConfig = resolveAgentTodosConfig(initialConfig);
  const inferenceBudget = createSeneraServerInferenceBudget(() => configSnapshot());
  const continuityRuntime = createAgentContinuityRuntime({
    databasePath: workspaceLayout.databases.memory,
    memosDatabasePath: workspaceLayout.databases.memos,
    identityPath: workspaceLayout.continuityIdentity,
    workspaceId,
    upgradeSession,
    configSnapshot,
    todoPolicy: {
      maxItems: todoConfig.MaxItems,
      maxContentCharacters: todoConfig.MaxContentCharacters,
      maxResultCharacters: todoConfig.MaxResultCharacters,
    },
    embeddingClient: workspaceRuntime.embedding.client,
    embeddingModel: () => workspaceRuntime.embedding.model,
    identityDisplayValues,
    logger: continuityLogger,
    learningLogger,
  });
  deferResourceCleanup(() => continuityRuntime.close());
  const {
    memory: memoryService,
    promptContext: continuityMemory,
    lifecycle: continuityLifecycle,
    executionLedger,
    todos,
  } = continuityRuntime;
  delegation.bindTodoService(todos);
  const platform = await createSeneraServerRuntimePlatform({
    resourceRoot,
    workspaceRoot,
    workspaceLayout,
    configPath,
    configSnapshot,
    configService,
    sessionStore,
    logStore,
    logger,
  });
  const { pluginHost, selfService } = platform;
  deferResourceCleanup(() => platform.stop());
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
    executionResources,
    sandboxRuntimeReady: () => sandboxRuntimeService.snapshot().state === "ready",
    sandboxAvailable: sandboxRuntimeService.sandboxBackendAvailable(),
    sandboxProvider: sandboxRuntimeService.runtimeProvider(),
    dockerEngineWorker: sandboxRuntimeService.dockerEngineWorkerClient(),
    sandboxGuestWorkspaceRoot,
    mcpInputs,
    workspaceRuntime,
    orchestration: { delegation, schedules },
    continuityMemory,
    continuityIdentity: continuityRuntime.identity,
    identityDisplayValues,
    continuityLifecycle,
    continuityRecall: continuityRuntime.recall,
    continuityMemOS: continuityRuntime.memos,
    executionLedger,
    todos,
    inferenceBudget,
    learningRequests: continuityRuntime.learningRequests,
    selfService,
    pluginHost,
    resourceCoordinator,
    mcpHostCapabilities,
    mcpActivationEntries: () => mcpManagement.activationEntries(),
    systemActivationEntries: () => mcpManagement.systemActivationEntries(),
  });
  deferResourceCleanup(() => runtimeCache.clear());
  runtimeCache.setObserved(false);
  const { selfHttpApi } = platform;

  const loopFactory = (modelProviderId?: string) => {
    const lease = runtimeCache.acquire(modelProviderId);
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
      artifactManifestIndex: workspaceRuntime.artifactManifestIndex,
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
      ? new AgentSqliteRunEventWriter({
          databasePath: workspaceLayout.databases.sessions,
          restartDelayMs: persistence.EventWriter.RestartDelayMs,
          closeTimeoutMs: persistence.EventWriter.CloseTimeoutMs,
          drainBatchSize: persistence.EventWriter.DrainBatchSize,
          committedRetentionMs: persistence.EventWriter.CommittedRetentionMs,
        })
      : new AgentCallbackRunEventWriter((events) => sessionManager.recordRunEvents(events));
  const cancelEventWriterCleanup = deferResourceCleanup(() => eventWriter.close());
  const userProfileManager = new AgentUserProfileManager(repository);
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
    pluginHost,
    runtimeDependencies,
    uploadStore: workspaceRuntime.uploadStore,
    channelWebhookApi,
    selfApi: selfHttpApi,
    channelControl: channelService,
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
  cancelEventWriterCleanup();
  deferResourceCleanup(() => server.stop());
  approvalRuntime.setEventSink((event) => server.broadcast(event));
  interactionInput.setEventSink((event) => server.broadcast(event));
  executionResources.setEventSink((event) => server.broadcast(event));
  orchestrationEvents.setSink((event) => server.broadcast(event));
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
  if (workspaceRoot === host.initialWorkspaceRoot) await channelService.start();
  await schedules.start();
  artifactRetention.start();
  startSandboxRuntimePreparation({
    config: initialConfig,
    sandboxRuntimeService,
    logger,
    prepared: options.sandboxRuntimePrepared ?? false,
  });

  const stop = createSeneraServerRuntimeStop({
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
      unbindDelegationCompletion();
      for (const unbind of unbindDelegationCompletionPorts) unbind();
    },
    runtimeDependencies,
    runtimeCache,
    workspaceRuntime,
    executionResources,
    interactionInput,
    mcpInputs,
    artifactRetention,
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
