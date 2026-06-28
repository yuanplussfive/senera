import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { AgentDomainEvent } from "../Events/AgentEvent.js";
import {
  resolvePresetsConfig,
  resolveServerConfig,
  resolveUploadsConfig,
} from "../AgentDefaults.js";
import { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { AgentPluginConfigManager } from "../Plugin/AgentPluginConfigManager.js";
import { AgentPresetManager } from "../Presets/AgentPresetManager.js";
import { AgentUploadHttpApi } from "../Uploads/AgentUploadHttpApi.js";
import { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import { AgentProviderModelDiscovery } from "../Config/AgentProviderModelDiscovery.js";
import { AgentWebSocketEventEnvelopeSender } from "./AgentWebSocketEventSender.js";
import { AgentWebSocketHttpRouter } from "./AgentWebSocketHttpRouter.js";
import { AgentWebSocketMessageRouter } from "./AgentWebSocketMessageRouter.js";
import type {
  AgentWebSocketRequestContext,
  AgentWebSocketServerOptions,
} from "./AgentWebSocketTypes.js";

export type { AgentWebSocketServerOptions } from "./AgentWebSocketTypes.js";

export class AgentWebSocketServer {
  private readonly serverConfig: ReturnType<typeof resolveServerConfig>;
  private readonly logger = new AgentLogger();
  private readonly eventSender: AgentWebSocketEventEnvelopeSender;
  private readonly httpRouter: AgentWebSocketHttpRouter;
  private readonly messageRouter: AgentWebSocketMessageRouter;
  private httpServer?: http.Server;
  private server?: WebSocketServer;

  constructor(private readonly options: AgentWebSocketServerOptions) {
    const configSnapshot = (): ReturnType<AgentWebSocketRequestContext["configSnapshot"]> =>
      options.configSnapshot?.() ?? options.config;
    const pluginConfigManager = options.pluginConfigManager ?? new AgentPluginConfigManager({
      workspaceRoot: options.workspaceRoot ?? process.cwd(),
      configSnapshot,
    });
    const providerModelDiscovery = new AgentProviderModelDiscovery({
      configSnapshot,
    });

    this.serverConfig = resolveServerConfig(options.config);
    this.eventSender = new AgentWebSocketEventEnvelopeSender({
      logger: this.logger,
      sessionManager: options.sessionManager,
    });
    this.httpRouter = new AgentWebSocketHttpRouter({
      uploadApi: new AgentUploadHttpApi({
        storeFactory: () => createUploadStore(options, configSnapshot()),
      }),
    });
    this.messageRouter = new AgentWebSocketMessageRouter({
      context: {
        config: options.config,
        configSnapshot,
        configService: options.configService,
        sessionManager: options.sessionManager,
        userProfileManager: options.userProfileManager,
        pluginConfigManager,
        providerModelDiscovery,
        presetManagerFactory: () => createPresetManager(options, configSnapshot()),
      },
      sendEnvelope: (socket, event) => this.eventSender.sendEnvelope(socket, event),
    });
  }

  start(): void {
    this.httpServer = http.createServer((request, response) => {
      void this.httpRouter.handle(request, response);
    });

    this.server = new WebSocketServer({
      server: this.httpServer,
      maxPayload: this.serverConfig.RequestMaxBytes,
    });

    this.server.on("connection", (socket) => {
      this.handleConnection(socket);
    });

    this.httpServer.on("listening", () => {
      this.handleListening();
    });
    this.httpServer.on("error", (error) => {
      this.handleServerError(error);
    });

    this.httpServer.listen(this.serverConfig.Port, this.serverConfig.Host);
  }

  stop(): void {
    this.server?.close();
    this.httpServer?.close();
  }

  broadcast(event: AgentDomainEvent): void {
    this.eventSender.broadcast(this.server?.clients ?? [], event);
  }

  private handleConnection(socket: WebSocket): void {
    socket.on("message", (data) => {
      void this.messageRouter.handleMessage(socket, data);
    });
  }

  private handleListening(): void {
    const address = this.httpServer?.address();
    const addressText =
      typeof address === "object" && address
        ? `${address.address}:${address.port}`
        : String(address ?? "");
    this.logger.banner("senera WS 服务已启动", {
      url: `ws://${addressText}`,
      hotReload: this.serverConfig.HotReload,
      requestMaxBytes: this.serverConfig.RequestMaxBytes,
    });
  }

  private handleServerError(error: NodeJS.ErrnoException): void {
    if (error.code === "EADDRINUSE") {
      this.logger.error("senera WS 服务启动失败", {
        reason: "端口已被占用",
        host: this.serverConfig.Host,
        port: this.serverConfig.Port,
      });
      process.exitCode = 1;
      return;
    }

    this.logger.error("senera WS 服务启动失败", {
      message: error.message,
      code: error.code,
    });
    process.exitCode = 1;
  }
}

function createUploadStore(
  options: AgentWebSocketServerOptions,
  config: AgentWebSocketRequestContext["config"],
): AgentUploadStore {
  const uploads = resolveUploadsConfig(config);
  return new AgentUploadStore({
    workspaceRoot: options.workspaceRoot ?? process.cwd(),
    rootDir: uploads.RootDir,
    maxFileBytes: uploads.MaxFileBytes,
  });
}

function createPresetManager(
  options: AgentWebSocketServerOptions,
  config: AgentWebSocketRequestContext["config"],
): AgentPresetManager {
  return new AgentPresetManager({
    workspaceRoot: options.workspaceRoot ?? process.cwd(),
    config: resolvePresetsConfig(config),
  });
}
