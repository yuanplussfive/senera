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
import {
  resolvePersistenceConfig,
  resolveSandboxRuntimeConfig,
  resolveServerConfig,
} from "../Source/AgentSystem/AgentDefaults.js";
import { AgentModelEndpointClient } from "../Source/AgentSystem/ModelEndpoints/AgentModelEndpointClient.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import { AgentUserProfileManager } from "../Source/AgentSystem/Session/AgentUserProfile.js";
import { AgentPluginConfigManager } from "../Source/AgentSystem/Plugin/AgentPluginConfigManager.js";
import {
  DefaultAgentMemoryDatabasePath,
  resolveAgentMemoryDatabasePath,
  SqliteAgentMemorySourceRepository,
} from "../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { AgentMemoryLearningRuntime } from "../Source/AgentSystem/Memory/AgentMemoryLearningRuntime.js";
import { AgentMemoryService } from "../Source/AgentSystem/Memory/AgentMemoryService.js";
import {
  AgentConfigService,
  type AgentConfigSourceOptions,
} from "../Source/AgentSystem/Config/AgentConfigService.js";
import { AgentEventKinds, emitAgentEvent, type AgentDomainEvent } from "../Source/AgentSystem/Events/AgentEvent.js";
import { serializeError } from "../Source/AgentSystem/Diagnostics/AgentErrorSerializer.js";
import { AgentLogger } from "../Source/AgentSystem/Diagnostics/AgentLogger.js";
import { AgentServerEventLogger } from "../Source/AgentSystem/Diagnostics/AgentServerEventLogger.js";
import { AgentApprovalRuntime } from "../Source/AgentSystem/Approvals/AgentApprovalRuntime.js";
import { AgentPiActiveSessionRegistry } from "../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import { AgentPiSessionBootstrapService } from "../Source/AgentSystem/Pi/AgentPiSessionBootstrapService.js";
import { AgentSystemRuntimeCache } from "../Source/AgentSystem/Runtime/AgentSystemRuntimeCache.js";
import { prepareAgentSandboxRuntime } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimePreparation.js";
import { AgentSandboxRuntimeService } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimeService.js";

export interface SeneraServerOptions {
  workspaceRoot?: string;
  configPath?: string;
  staticFrontendRoot?: string;
  resourcesPath?: string;
  configSource?: AgentConfigSourceOptions;
  runtimeConfigProjection?: (config: AgentSystemConfig) => AgentSystemConfig;
}

export interface SeneraServerHandle {
  workspaceRoot: string;
  configPath: string;
  websocketUrl: string;
  stop(): void;
}

type ServerEventLogDetail = "compact" | "verbose";

export function startSeneraServer(options: SeneraServerOptions = {}): SeneraServerHandle {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const configSource = resolveConfigSource(workspaceRoot, options);
  const configPath = resolveRuntimeConfigPath(workspaceRoot, configSource);
  let server: AgentWebSocketServer;
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

  const configService = new AgentConfigService({
    workspaceRoot,
    source: configSource,
  });
  const approvalRuntime = new AgentApprovalRuntime();
  const piSessionRegistry = new AgentPiActiveSessionRegistry();
  const projectRuntimeConfig = (config: AgentSystemConfig): AgentSystemConfig =>
    options.runtimeConfigProjection?.(config) ?? config;
  const initialSnapshot = configService.snapshot();
  const initialConfig = projectRuntimeConfig(initialSnapshot.value);
  const runtimeSnapshot = () => {
    const snapshot = configService.snapshot();
    return {
      version: snapshot.version,
      revision: snapshot.revision,
      config: projectRuntimeConfig(snapshot.value),
    };
  };
  const configSnapshot = () => runtimeSnapshot().config;
  const sandboxRuntimeService = new AgentSandboxRuntimeService({
    workspaceRoot,
    configSnapshot,
  });
  void prepareAgentSandboxRuntime({
    workspaceRoot,
    config: resolveSandboxRuntimeConfig(initialConfig),
    skipImagePull: true,
    strict: false,
    log: (message) => logger.info("sandbox.runtime.prepare", { message }),
  });
  const runtimeCache = new AgentSystemRuntimeCache({
    workspaceRoot,
    configPath,
    snapshot: runtimeSnapshot,
    logger,
    approvalRuntime,
    piSessionRegistry,
    resourcesPath: options.resourcesPath,
  });

  const loopFactory = (modelProviderId?: string) => {
    const runtime = runtimeCache.get(modelProviderId);
    const model = new AgentModelEndpointClient(runtime.config, modelProviderId);

    return new AgentLoop({
      runtime,
      model,
    });
  };
  const piSessionBootstrap = new AgentPiSessionBootstrapService({
    runtime: (modelProviderId) => runtimeCache.get(modelProviderId),
  });

  const repository = createRepository(workspaceRoot, initialConfig);
  const memorySourceRepository = new SqliteAgentMemorySourceRepository(
    resolveAgentMemoryDatabasePath(workspaceRoot, DefaultAgentMemoryDatabasePath),
  );
  const memoryLearning = new AgentMemoryLearningRuntime({
    repository: memorySourceRepository,
    configSnapshot,
    logger,
  });
  const memoryService = new AgentMemoryService({
    sourceRepository: memorySourceRepository,
    learning: memoryLearning,
  });
  const sessionStore = new AgentSessionStore({ repository });
  sessionStore.hydrate();

  const sessionManager = new AgentSessionManager({
    loopFactory,
    store: sessionStore,
    memoryService,
    logger,
    approvalRuntime,
    piSessions: piSessionRegistry,
    piSessionBootstrap,
  });
  const userProfileManager = new AgentUserProfileManager(repository);
  const pluginConfigManager = new AgentPluginConfigManager({
    workspaceRoot,
    configSnapshot,
  });

  server = new AgentWebSocketServer({
    config: initialConfig,
    workspaceRoot,
    staticFrontendRoot: options.staticFrontendRoot,
    configService,
    configSnapshot,
    sessionManager,
    userProfileManager,
    pluginConfigManager,
    approvalRuntime,
    sandboxRuntimeService,
    logger,
    eventLogger,
  });

  server.start();
  if (configSource.kind === "json" && resolveServerConfig(initialConfig).HotReload) {
    const jsonConfigPath = configSource.configPath;
    watchedConfigPath = jsonConfigPath;
    fs.watchFile(jsonConfigPath, { interval: 500 }, () => {
      try {
        const snapshot = configService.reloadFromSources();
        server.broadcast({
          kind: AgentEventKinds.ConfigReloaded,
          context: {},
          data: {
            configPath: snapshot.path,
            source: snapshot.source,
            revision: snapshot.revision,
            databasePath: snapshot.databasePath,
            diagnostics: snapshot.diagnostics,
          },
        });
      } catch (error) {
        void emitAgentEvent((event: AgentDomainEvent) => server.broadcast(event), {
          kind: AgentEventKinds.ConfigFailed,
          context: {},
          data: {
            configPath: jsonConfigPath,
            message: error instanceof Error ? error.message : String(error),
            details: serializeError(error),
          },
        });
      }
    });
  }

  const serverConfig = resolveServerConfig(initialConfig);

  return {
    workspaceRoot,
    configPath,
    websocketUrl: `ws://${serverConfig.Host}:${serverConfig.Port}`,
    stop: () => {
      if (watchedConfigPath) {
        fs.unwatchFile(watchedConfigPath);
      }
      runtimeCache.clear();
      server.stop();
      configService.close();
      memoryService.close();
      repository.close();
    },
  };
}

function createRepository(workspaceRoot: string, config: AgentSystemConfig): AgentSessionRepository {
  const persistence = resolvePersistenceConfig(config);
  if (persistence.Kind === "memory") {
    return new InMemorySessionRepository();
  }
  const dbPath = path.resolve(
    workspaceRoot,
    persistence.DatabasePath,
  );
  return new SqliteSessionRepository(dbPath);
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

function resolveConfigSource(
  workspaceRoot: string,
  options: SeneraServerOptions,
): AgentConfigSourceOptions {
  if (options.configSource) {
    if (options.configPath) {
      throw new Error("startSeneraServer 不能同时传入 configPath 和 configSource。");
    }
    return normalizeConfigSource(workspaceRoot, options.configSource);
  }

  return {
    kind: "json",
    configPath: options.configPath
      ? path.resolve(workspaceRoot, options.configPath)
      : resolveConfigPath(workspaceRoot),
  };
}

function normalizeConfigSource(
  workspaceRoot: string,
  source: AgentConfigSourceOptions,
): AgentConfigSourceOptions {
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

function resolveRuntimeConfigPath(
  workspaceRoot: string,
  source: AgentConfigSourceOptions,
): string {
  return source.kind === "json"
    ? source.configPath
    : source.label ?? resolveWorkspacePath(workspaceRoot, source.databasePath);
}

function resolveWorkspacePath(workspaceRoot: string, value: string): string {
  return path.isAbsolute(value)
    ? path.normalize(value)
    : path.resolve(workspaceRoot, value);
}
