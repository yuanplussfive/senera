import path from "node:path";
import fs from "node:fs";
import { AgentLoop } from "../Source/AgentSystem/Loop/AgentLoop.js";
import { AgentSessionManager } from "../Source/AgentSystem/Session/AgentSessionManager.js";
import { AgentSessionStore } from "../Source/AgentSystem/Session/AgentSessionStore.js";
import {
  InMemorySessionRepository,
  SqliteSessionRepository,
  type AgentSessionRepository,
} from "../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { AgentWebSocketServer } from "../Source/AgentSystem/WebSocket/AgentWebSocketServer.js";
import { AgentSqliteRunEventWriter } from "../Source/AgentSystem/WebSocket/AgentSqliteRunEventWriter.js";
import { AgentCallbackRunEventWriter } from "../Source/AgentSystem/WebSocket/AgentCallbackRunEventWriter.js";
import {
  resolvePersistenceConfig,
  resolveAgentLoopConfig,
  resolveArtifactsConfig,
  resolveSandboxRuntimeConfig,
  resolveServerConfig,
} from "../Source/AgentSystem/AgentDefaults.js";
import { AgentModelEndpointClient } from "../Source/AgentSystem/ModelEndpoints/AgentModelEndpointClient.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import { AgentUserProfileManager } from "../Source/AgentSystem/Session/AgentUserProfile.js";
import { AgentPluginConfigManager } from "../Source/AgentSystem/Plugin/AgentPluginConfigManager.js";
import { AgentPluginScanner } from "../Source/AgentSystem/Plugin/AgentPluginScanner.js";
import {
  DefaultAgentMemoryDatabasePath,
  resolveAgentMemoryDatabasePath,
  SqliteAgentMemorySourceRepository,
} from "../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { AgentMemoryLearningRuntime } from "../Source/AgentSystem/Memory/AgentMemoryLearningRuntime.js";
import { AgentMemoryService } from "../Source/AgentSystem/Memory/AgentMemoryService.js";
import { AgentConfigService, type AgentConfigSourceOptions } from "../Source/AgentSystem/Config/AgentConfigService.js";
import { AgentEventKinds, emitAgentEvent, type AgentDomainEvent } from "../Source/AgentSystem/Events/AgentEvent.js";
import { serializeError } from "../Source/AgentSystem/Diagnostics/AgentErrorSerializer.js";
import { AgentLogger } from "../Source/AgentSystem/Diagnostics/AgentLogger.js";
import { AgentServerEventLogger } from "../Source/AgentSystem/Diagnostics/AgentServerEventLogger.js";
import { AgentApprovalRuntime } from "../Source/AgentSystem/Approvals/AgentApprovalRuntime.js";
import { AgentPiActiveSessionRegistry } from "../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import { AgentPiSessionMutationService } from "../Source/AgentSystem/Pi/AgentPiSessionMutationService.js";
import { createAgentPiDiagnosticLogger } from "../Source/AgentSystem/Pi/AgentPiDiagnostics.js";
import { AgentSystemRuntimeCache } from "../Source/AgentSystem/Runtime/AgentSystemRuntimeCache.js";
import { AgentSandboxRuntimeService } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimeService.js";
import { AgentExecutionResourceBroker } from "../Source/AgentSystem/ExecutionResources/AgentExecutionResourceBroker.js";
import { resolveAgentExecutionResourceLimits } from "../Source/AgentSystem/ExecutionResources/AgentExecutionResourceConfig.js";
import { AgentInteractionInputRuntime } from "../Source/AgentSystem/Interaction/AgentInteractionInputRuntime.js";
import { createAgentRequestCancellationResource } from "../Source/AgentSystem/Session/AgentSessionRunResource.js";
import { AgentArtifactRetentionService } from "../Source/AgentSystem/Artifacts/AgentArtifactRetentionService.js";
import type { AgentMcpRuntimeModuleResolver } from "../Source/AgentSystem/Mcp/AgentMcpRuntimeModuleResolver.js";
import {
  SeneraMicrosandboxDynamicSdkAdapter,
  type SeneraMicrosandboxModuleLoader,
} from "../Source/AgentSystem/Execution/SeneraMicrosandboxSdkAdapter.js";
import type { AgentMicrosandboxPackageEntryResolver } from "../Source/AgentSystem/Sandbox/AgentMicrosandboxCli.js";
import type { AgentSandboxRuntimeProvider } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimeTypes.js";
import type { SeneraGvisorWorkerClient } from "../Source/AgentSystem/Execution/SeneraGvisorTypes.js";
import { readAgentProductMetadata } from "../Source/AgentSystem/Core/AgentProductMetadata.js";
import { AgentUpgradeSession } from "../Source/AgentSystem/Upgrade/AgentUpgradeSession.js";
import { errorMessage } from "../Source/AgentSystem/Core/AgentErrors.js";

export interface SeneraServerOptions {
  workspaceRoot?: string;
  configPath?: string;
  staticFrontendRoot?: string;
  resourcesPath?: string;
  configSource?: AgentConfigSourceOptions;
  runtimeConfigProjection?: (config: AgentSystemConfig) => AgentSystemConfig;
  runtimeModuleResolver?: AgentMcpRuntimeModuleResolver;
  sandboxBundleRoot?: string;
  /**
   * Set only by a deployment bootstrap that has already prepared and verified
   * the configured microsandbox runtime before opening the web server.
   */
  sandboxRuntimePrepared?: boolean;
  sandboxProvider?: AgentSandboxRuntimeProvider;
  dockerEngineWorker?: SeneraGvisorWorkerClient;
  microsandboxModuleLoader?: SeneraMicrosandboxModuleLoader;
  microsandboxPackageEntryResolver?: AgentMicrosandboxPackageEntryResolver;
  upgradeStateRoot?: string;
  upgradeDataRoots?: readonly string[];
  runtimeImageReference?: string;
}

export interface SeneraServerHandle {
  workspaceRoot: string;
  configPath: string;
  websocketUrl: string;
  healthUrl: string;
  stop(): Promise<void>;
}

type ServerEventLogDetail = "compact" | "verbose";

export async function startSeneraServer(options: SeneraServerOptions = {}): Promise<SeneraServerHandle> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const resourceRoot = path.resolve(options.resourcesPath ?? process.cwd());
  const product = readAgentProductMetadata(resourceRoot);
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
    handle = await startSeneraServerRuntime(options, workspaceRoot, upgradeSession, cleanup);
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
): Promise<SeneraServerHandle> {
  const startupResourceCleanups: Array<() => void> = [];
  const deferResourceCleanup = (callback: () => void | Promise<void>): (() => void) => {
    const cancel = startupCleanup.defer(callback);
    startupResourceCleanups.push(cancel);
    return cancel;
  };
  const configSource = resolveConfigSource(workspaceRoot, options);
  const configPath = resolveRuntimeConfigPath(workspaceRoot, configSource);
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
  const piDiagnostics = eventLogDetail === "verbose" ? createAgentPiDiagnosticLogger(logger) : undefined;

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
  const projectRuntimeConfig = (config: AgentSystemConfig): AgentSystemConfig =>
    options.runtimeConfigProjection?.(config) ?? config;
  const initialSnapshot = configService.snapshot();
  const initialConfig = projectRuntimeConfig(initialSnapshot.value);
  const configSnapshot = (): AgentSystemConfig => projectRuntimeConfig(configService.snapshot().value);
  const runtimeSnapshot = () => {
    const snapshot = configService.snapshot();
    const config = projectRuntimeConfig(snapshot.value);
    return {
      version: snapshot.version,
      revision: snapshot.revision,
      sourceRevisions: {
        plugins: AgentPluginScanner.sourceRevision(workspaceRoot, config),
      },
      config,
    };
  };
  const sandboxRuntimeService = new AgentSandboxRuntimeService({
    workspaceRoot,
    configSnapshot,
    sandboxBundleRoot: options.sandboxBundleRoot,
    provider: options.sandboxProvider,
    dockerEngineWorker: options.dockerEngineWorker,
  });
  const microsandboxSdk = options.microsandboxModuleLoader
    ? new SeneraMicrosandboxDynamicSdkAdapter(options.microsandboxModuleLoader)
    : undefined;
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
  const runtimeCache = new AgentSystemRuntimeCache({
    workspaceRoot,
    configPath,
    snapshot: runtimeSnapshot,
    logger,
    piDiagnostics,
    approvalRuntime,
    interactionInput,
    piSessionRegistry,
    resourcesPath: options.resourcesPath,
    runtimeModuleResolver: options.runtimeModuleResolver,
    executionResources,
    sandboxRuntimeReady: () => sandboxRuntimeService.snapshot().state === "ready",
    microsandboxSdk,
    sandboxProvider: sandboxRuntimeService.runtimeProvider(),
    gvisorWorker: sandboxRuntimeService.gvisorWorkerClient(),
  });
  deferResourceCleanup(() => runtimeCache.clear());

  const loopFactory = (modelProviderId?: string) => {
    const lease = runtimeCache.acquire(modelProviderId);
    try {
      const model = new AgentModelEndpointClient(lease.runtime.config, modelProviderId);
      const loop = new AgentLoop({
        runtime: lease.runtime,
        model,
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

  const persistence = resolvePersistenceConfig(initialConfig);
  const repository = createRepository(workspaceRoot, initialConfig, upgradeSession, logger);
  deferResourceCleanup(() => repository.close());
  const memorySourceRepository = new SqliteAgentMemorySourceRepository(
    resolveAgentMemoryDatabasePath(workspaceRoot, DefaultAgentMemoryDatabasePath),
    upgradeSession,
  );
  const cancelMemorySourceCleanup = deferResourceCleanup(() => memorySourceRepository.close());
  const memoryLearning = new AgentMemoryLearningRuntime({
    repository: memorySourceRepository,
    configSnapshot,
    logger,
  });
  const memoryService = new AgentMemoryService({
    sourceRepository: memorySourceRepository,
    learning: memoryLearning,
  });
  cancelMemorySourceCleanup();
  deferResourceCleanup(() => memoryService.close());
  const artifactRetention = new AgentArtifactRetentionService({
    workspaceRoot,
    config: () => resolveArtifactsConfig(configSnapshot()),
    onError: (error) => logger.warn("artifact.retention.failed", { error: serializeError(error) }),
  });
  deferResourceCleanup(() => artifactRetention.close());
  const sessionStore = new AgentSessionStore({ repository });
  sessionStore.hydrate();

  const sessionManager = new AgentSessionManager({
    loopFactory,
    store: sessionStore,
    memoryService,
    logger,
    runResources: [
      createAgentRequestCancellationResource("approval", approvalRuntime),
      createAgentRequestCancellationResource("interaction_input", interactionInput),
    ],
    sessionResources: [
      {
        id: "execution_resources",
        release: ({ sessionId }) => executionResources.releaseAll({ workspaceRoot, sessionId }),
      },
    ],
    piSessions: piSessionRegistry,
    piDiagnostics,
    piSessionMutations,
    runControl: {
      get settlementTimeoutMs() {
        return resolveAgentLoopConfig(configSnapshot()).RunSettlementTimeoutMs;
      },
    },
    artifactSessionCleanup: artifactRetention,
  });
  const eventWriter =
    persistence.Kind === "sqlite"
      ? new AgentSqliteRunEventWriter({ databasePath: path.resolve(workspaceRoot, persistence.DatabasePath) })
      : new AgentCallbackRunEventWriter((events) => sessionManager.recordRunEvents(events));
  const cancelEventWriterCleanup = deferResourceCleanup(() => eventWriter.close());
  const userProfileManager = new AgentUserProfileManager(repository);
  const pluginConfigManager = new AgentPluginConfigManager({
    workspaceRoot,
    configSnapshot,
  });

  const server = new AgentWebSocketServer({
    config: initialConfig,
    workspaceRoot,
    staticFrontendRoot: options.staticFrontendRoot,
    configService,
    configSnapshot,
    sessionManager,
    userProfileManager,
    pluginConfigManager,
    approvalRuntime,
    interactionInput,
    sandboxRuntimeService,
    executionResources,
    logger,
    eventLogger,
    piDiagnostics,
    eventWriter,
  });
  cancelEventWriterCleanup();
  deferResourceCleanup(() => server.stop());
  approvalRuntime.setEventSink((event) => server.broadcast(event));
  interactionInput.setEventSink((event) => server.broadcast(event));
  executionResources.setEventSink((event) => server.broadcast(event));
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
  memoryLearning.start();
  artifactRetention.start();
  startSandboxRuntimePreparation({
    config: initialConfig,
    sandboxRuntimeService,
    logger,
    prepared: options.sandboxRuntimePrepared ?? false,
    microsandboxModuleLoader: options.microsandboxModuleLoader,
    microsandboxPackageEntryResolver: options.microsandboxPackageEntryResolver,
  });
  if (configSource.kind === "json" && resolveServerConfig(initialConfig).HotReload) {
    const jsonConfigPath = configSource.configPath;
    watchedConfigPath = jsonConfigPath;
    fs.watchFile(jsonConfigPath, { interval: 500 }, () => {
      try {
        const snapshot = configService.reloadFromSources();
        void server
          .broadcast({
            kind: AgentEventKinds.ConfigReloaded,
            context: {},
            data: {
              configPath: snapshot.path,
              source: snapshot.source,
              revision: snapshot.revision,
              databasePath: snapshot.databasePath,
              diagnostics: snapshot.diagnostics,
            },
          })
          .catch((error) => {
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
      let serverFailure: unknown;
      try {
        await server.stop();
      } catch (error) {
        serverFailure = error;
      }
      try {
        await Promise.all([
          runtimeCache.clear(),
          executionResources.close(),
          interactionInput.close(),
          artifactRetention.close(),
        ]);
      } finally {
        configService.close();
        memoryService.close();
        repository.close();
      }
      if (serverFailure) throw serverFailure;
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

export async function probeSeneraReadiness(healthUrl: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    throw new Error(`Senera readiness check failed for ${healthUrl}.`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`Senera readiness check failed for ${healthUrl}: HTTP ${response.status}.`);
  }
}

function resolveHealthCheckHost(host: string): string {
  const normalized = host.trim().toLowerCase();
  if (normalized === "0.0.0.0") return "127.0.0.1";
  if (normalized === "::" || normalized === "[::]") return "[::1]";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function startSandboxRuntimePreparation(input: {
  config: AgentSystemConfig;
  sandboxRuntimeService: AgentSandboxRuntimeService;
  logger: AgentLogger;
  prepared: boolean;
  microsandboxModuleLoader?: SeneraMicrosandboxModuleLoader;
  microsandboxPackageEntryResolver?: AgentMicrosandboxPackageEntryResolver;
}): void {
  const sandboxRuntimeConfig = resolveSandboxRuntimeConfig(input.config);
  if (!sandboxRuntimeConfig.Enabled) {
    input.sandboxRuntimeService.markDisabled();
    input.logger.info("sandbox.runtime.disabled", {
      provider: input.sandboxRuntimeService.runtimeProvider(),
    });
    return;
  }

  if (input.prepared) {
    input.sandboxRuntimeService.markReady();
    input.logger.success("sandbox.runtime.ready", {
      provider: input.sandboxRuntimeService.runtimeProvider(),
    });
    return;
  }

  void input.sandboxRuntimeService
    .prepare({
      config: sandboxRuntimeConfig,
      microsandboxModuleLoader: input.microsandboxModuleLoader,
      microsandboxPackageEntryResolver: input.microsandboxPackageEntryResolver,
      log: (message) => input.logger.info("sandbox.runtime.prepare", { message }),
    })
    .then(
      () => {
        input.logger.success("sandbox.runtime.ready", {
          provider: input.sandboxRuntimeService.runtimeProvider(),
        });
      },
      (error: unknown) => {
        input.logger.warn("sandbox.runtime.unavailable", {
          message: errorMessage(error),
        });
      },
    );
}

function createRepository(
  workspaceRoot: string,
  config: AgentSystemConfig,
  upgradeSession: AgentUpgradeSession,
  logger: AgentLogger,
): AgentSessionRepository {
  const persistence = resolvePersistenceConfig(config);
  if (persistence.Kind === "memory") {
    return new InMemorySessionRepository();
  }
  const dbPath = path.resolve(workspaceRoot, persistence.DatabasePath);
  return new SqliteSessionRepository(dbPath, upgradeSession, (sessionId, issue) =>
    logger.warn("session.entry.decode_failed", { sessionId, ...issue }),
  );
}

class SeneraStartupCleanup {
  private readonly callbacks = new Set<() => void | Promise<void>>();

  defer(callback: () => void | Promise<void>): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  disarm(): void {
    this.callbacks.clear();
  }

  async run(): Promise<void> {
    const failures: unknown[] = [];
    for (const callback of [...this.callbacks].reverse()) {
      try {
        await callback();
      } catch (error) {
        failures.push(error);
      }
    }
    this.callbacks.clear();
    if (failures.length > 0) throw new AggregateError(failures, "Senera startup cleanup failed.");
  }
}

function resolveConfigPath(workspaceRoot: string): string {
  const configuredPath = process.env.AGENT_CONFIG_PATH?.trim();
  return configuredPath
    ? path.resolve(workspaceRoot, configuredPath)
    : path.resolve(workspaceRoot, "senera.config.json");
}

function resolveServerEventLogDetail(value: string | undefined): ServerEventLogDetail {
  return value?.trim().toLowerCase() === "verbose" ? "verbose" : "compact";
}

function resolveConfigSource(workspaceRoot: string, options: SeneraServerOptions): AgentConfigSourceOptions {
  if (options.configSource) {
    if (options.configPath) {
      throw new Error("startSeneraServer 不能同时传入 configPath 和 configSource。");
    }
    return normalizeConfigSource(workspaceRoot, options.configSource);
  }

  return {
    kind: "json",
    configPath: options.configPath ? path.resolve(workspaceRoot, options.configPath) : resolveConfigPath(workspaceRoot),
  };
}

function normalizeConfigSource(workspaceRoot: string, source: AgentConfigSourceOptions): AgentConfigSourceOptions {
  if (source.kind === "json") {
    return {
      ...source,
      configPath: resolveWorkspacePath(workspaceRoot, source.configPath),
    };
  }

  const databasePath = resolveWorkspacePath(workspaceRoot, source.databasePath);
  return {
    ...source,
    databasePath,
    label: source.label ? resolveWorkspacePath(workspaceRoot, source.label) : databasePath,
  };
}

function resolveRuntimeConfigPath(workspaceRoot: string, source: AgentConfigSourceOptions): string {
  return source.kind === "json"
    ? source.configPath
    : (source.label ?? resolveWorkspacePath(workspaceRoot, source.databasePath));
}

function resolveWorkspacePath(workspaceRoot: string, value: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(workspaceRoot, value);
}
