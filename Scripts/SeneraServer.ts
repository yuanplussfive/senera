import path from "node:path";
import { AgentConfigWatcher } from "../Source/AgentSystem/AgentConfigWatcher.js";
import { AgentLoop } from "../Source/AgentSystem/AgentLoop.js";
import { AgentSessionManager } from "../Source/AgentSystem/AgentSessionManager.js";
import { AgentSessionStore } from "../Source/AgentSystem/AgentSessionStore.js";
import {
  SqliteSessionRepository,
  InMemorySessionRepository,
  type AgentSessionRepository,
} from "../Source/AgentSystem/AgentSqliteSessionRepository.js";
import { AgentSystemRuntime } from "../Source/AgentSystem/AgentSystemRuntime.js";
import { AgentWebSocketServer } from "../Source/AgentSystem/AgentWebSocketServer.js";
import {
  resolvePersistenceConfig,
  resolveServerConfig,
} from "../Source/AgentSystem/AgentDefaults.js";
import { AgentModelEndpointClient } from "../Source/AgentSystem/AgentModelEndpointClient.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types.js";
import { AgentUserProfileManager } from "../Source/AgentSystem/AgentUserProfile.js";
import { AgentPluginConfigManager } from "../Source/AgentSystem/AgentPluginConfigManager.js";

function main(): void {
  const workspaceRoot = process.cwd();
  const configPath = resolveConfigPath(workspaceRoot);
  let server: AgentWebSocketServer;

  const initialRuntime = AgentSystemRuntime.load({
    workspaceRoot,
    configPath,
  });

  const watcher = new AgentConfigWatcher({
    configPath,
    enabled: resolveServerConfig(initialRuntime.config).HotReload,
    onEvent: (event) => server.broadcast(event),
  });

  const loopFactory = (modelProviderId?: string) => {
    const snapshot = watcher.snapshot();
    const runtime = AgentSystemRuntime.fromConfig({
      workspaceRoot,
      configPath,
      config: snapshot.value,
      modelProviderId,
    });
    const model = new AgentModelEndpointClient(snapshot.value, modelProviderId);

    return new AgentLoop({
      runtime,
      model,
    });
  };

  const repository = createRepository(workspaceRoot, initialRuntime.config);
  const sessionStore = new AgentSessionStore({ repository });
  sessionStore.hydrate();

  const sessionManager = new AgentSessionManager({
    loopFactory,
    store: sessionStore,
  });
  const userProfileManager = new AgentUserProfileManager(repository);
  const pluginConfigManager = new AgentPluginConfigManager({
    workspaceRoot,
    configSnapshot: () => watcher.snapshot().value,
  });

  server = new AgentWebSocketServer({
    config: initialRuntime.config,
    workspaceRoot,
    configSnapshot: () => watcher.snapshot().value,
    sessionManager,
    userProfileManager,
    pluginConfigManager,
  });

  server.start();
  watcher.start();

  const shutdown = (): void => {
    watcher.stop();
    server.stop();
    repository.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
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

main();
