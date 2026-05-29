import path from "node:path";
import { AgentConfigWatcher } from "../Source/AgentSystem/AgentConfigWatcher.js";
import { AgentEnvironment } from "../Source/AgentSystem/AgentEnvironment.js";
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
import { resolveServerConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { AgentModelEndpointClient } from "../Source/AgentSystem/AgentModelEndpointClient.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types.js";
import { AgentUserProfileManager } from "../Source/AgentSystem/AgentUserProfile.js";

function main(): void {
  const workspaceRoot = process.cwd();
  const configPath = resolveConfigPath(workspaceRoot);
  let server: AgentWebSocketServer;

  AgentEnvironment.load({
    workspaceRoot,
  });

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

  server = new AgentWebSocketServer({
    config: initialRuntime.config,
    configSnapshot: () => watcher.snapshot().value,
    sessionManager,
    userProfileManager,
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
  const kind = config.Persistence?.Kind ?? "sqlite";
  if (kind === "memory") {
    return new InMemorySessionRepository();
  }
  const dbPath = path.resolve(
    workspaceRoot,
    config.Persistence?.DatabasePath ?? ".senera/senera.db",
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
