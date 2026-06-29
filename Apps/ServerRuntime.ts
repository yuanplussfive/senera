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
import { AgentSystemRuntime } from "../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import { AgentWebSocketServer } from "../Source/AgentSystem/WebSocket/AgentWebSocketServer.js";
import {
  resolvePersistenceConfig,
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

export interface SeneraServerOptions {
  workspaceRoot?: string;
  configPath?: string;
  staticFrontendRoot?: string;
  configSource?: AgentConfigSourceOptions;
  runtimeConfigProjection?: (config: AgentSystemConfig) => AgentSystemConfig;
}

export interface SeneraServerHandle {
  workspaceRoot: string;
  configPath: string;
  websocketUrl: string;
  stop(): void;
}

export function startSeneraServer(options: SeneraServerOptions = {}): SeneraServerHandle {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const configSource = resolveConfigSource(workspaceRoot, options);
  const configPath = resolveRuntimeConfigPath(workspaceRoot, configSource);
  let server: AgentWebSocketServer;
  let watchedConfigPath: string | undefined;

  const configService = new AgentConfigService({
    workspaceRoot,
    source: configSource,
  });
  const projectRuntimeConfig = (config: AgentSystemConfig): AgentSystemConfig =>
    options.runtimeConfigProjection?.(config) ?? config;
  const initialSnapshot = configService.snapshot();
  const initialRuntime = AgentSystemRuntime.fromConfig({
    workspaceRoot,
    configPath,
    config: projectRuntimeConfig(initialSnapshot.value),
  });

  const configSnapshot = () => projectRuntimeConfig(configService.snapshot().value);

  const loopFactory = (modelProviderId?: string) => {
    const config = configSnapshot();
    const runtime = AgentSystemRuntime.fromConfig({
      workspaceRoot,
      configPath,
      config,
      modelProviderId,
    });
    const model = new AgentModelEndpointClient(config, modelProviderId);

    return new AgentLoop({
      runtime,
      model,
    });
  };

  const repository = createRepository(workspaceRoot, initialRuntime.config);
  const memorySourceRepository = new SqliteAgentMemorySourceRepository(
    resolveAgentMemoryDatabasePath(workspaceRoot, DefaultAgentMemoryDatabasePath),
  );
  const memoryLearning = new AgentMemoryLearningRuntime({
    repository: memorySourceRepository,
    configSnapshot,
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
  });
  const userProfileManager = new AgentUserProfileManager(repository);
  const pluginConfigManager = new AgentPluginConfigManager({
    workspaceRoot,
    configSnapshot,
  });

  server = new AgentWebSocketServer({
    config: initialRuntime.config,
    workspaceRoot,
    staticFrontendRoot: options.staticFrontendRoot,
    configService,
    configSnapshot,
    sessionManager,
    userProfileManager,
    pluginConfigManager,
  });

  server.start();
  if (configSource.kind === "json" && resolveServerConfig(initialRuntime.config).HotReload) {
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

  const serverConfig = resolveServerConfig(initialRuntime.config);

  return {
    workspaceRoot,
    configPath,
    websocketUrl: `ws://${serverConfig.Host}:${serverConfig.Port}`,
    stop: () => {
      if (watchedConfigPath) {
        fs.unwatchFile(watchedConfigPath);
      }
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
