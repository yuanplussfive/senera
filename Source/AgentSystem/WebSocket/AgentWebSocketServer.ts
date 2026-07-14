import http from "node:http";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import type { AgentDomainEvent } from "../Events/AgentEvent.js";
import { resolvePresetsConfig, resolveServerConfig, resolveUploadsConfig } from "../AgentDefaults.js";
import { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { AgentPluginConfigManager } from "../Plugin/AgentPluginConfigManager.js";
import { AgentPresetManager } from "../Presets/AgentPresetManager.js";
import { AgentUploadHttpApi } from "../Uploads/AgentUploadHttpApi.js";
import { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import { AgentProviderModelDiscovery } from "../Config/AgentProviderModelDiscovery.js";
import { AgentPiProxyHttpApi } from "../PiProxy/AgentPiProxyHttpApi.js";
import { AgentSandboxRuntimeService } from "../Sandbox/AgentSandboxRuntimeService.js";
import { AgentWebSocketEventEnvelopeSender } from "./AgentWebSocketEventSender.js";
import { AgentWebSocketHttpRouter } from "./AgentWebSocketHttpRouter.js";
import { AgentWebSocketMessageRouter } from "./AgentWebSocketMessageRouter.js";
import { AgentStaticFrontendHttpApi } from "./AgentStaticFrontendHttpApi.js";
import type { AgentWebSocketRequestContext, AgentWebSocketServerOptions } from "./AgentWebSocketTypes.js";
import { AgentAuthenticationHttpApi } from "../Auth/AgentAuthenticationHttpApi.js";
import {
  AgentServerAccessGuard,
  type AgentAccessFailure,
  type AgentAuthenticatedAccess,
} from "../Auth/AgentServerAccessGuard.js";

export type { AgentWebSocketServerOptions } from "./AgentWebSocketTypes.js";

export class AgentWebSocketServer {
  private readonly serverConfig: ReturnType<typeof resolveServerConfig>;
  private readonly logger: AgentLogger;
  private readonly eventSender: AgentWebSocketEventEnvelopeSender;
  private readonly httpRouter: AgentWebSocketHttpRouter;
  private readonly uploadApi: AgentUploadHttpApi;
  private readonly messageRouter: AgentWebSocketMessageRouter;
  private readonly accessGuard: AgentServerAccessGuard;
  private httpServer?: http.Server;
  private server?: WebSocketServer;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(private readonly options: AgentWebSocketServerOptions) {
    this.logger = options.logger ?? new AgentLogger();
    const configSnapshot = (): ReturnType<AgentWebSocketRequestContext["configSnapshot"]> =>
      options.configSnapshot?.() ?? options.config;
    const pluginConfigManager =
      options.pluginConfigManager ??
      new AgentPluginConfigManager({
        workspaceRoot: options.workspaceRoot ?? process.cwd(),
        configSnapshot,
      });
    const providerModelDiscovery = new AgentProviderModelDiscovery({
      configSnapshot,
    });
    const sandboxRuntimeService = options.sandboxRuntimeService ?? new AgentSandboxRuntimeService();

    this.serverConfig = resolveServerConfig(options.config);
    this.accessGuard = new AgentServerAccessGuard({
      server: this.serverConfig,
      workspaceRoot: options.workspaceRoot ?? process.cwd(),
    });
    this.eventSender = new AgentWebSocketEventEnvelopeSender({
      logger: this.logger,
      sessionManager: options.sessionManager,
      eventLogger: options.eventLogger,
    });
    const uploadStore = createUploadStore(options, configSnapshot);
    this.uploadApi = new AgentUploadHttpApi({
      store: uploadStore,
      isOriginAllowed: (origin) => this.accessGuard.allowsOrigin(origin),
    });
    this.httpRouter = new AgentWebSocketHttpRouter({
      uploadApi: this.uploadApi,
      piProxyApi: new AgentPiProxyHttpApi({
        configSnapshot,
        onEvent: (event) => this.broadcast(event),
        maxRequestBytes: this.serverConfig.RequestMaxBytes,
      }),
      staticFrontendApi: options.staticFrontendRoot
        ? new AgentStaticFrontendHttpApi({ rootDir: options.staticFrontendRoot })
        : undefined,
      authenticationApi: new AgentAuthenticationHttpApi(this.accessGuard),
      accessGuard: this.accessGuard,
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
        approvalRuntime: options.approvalRuntime,
        sandboxRuntimeService,
      },
      sendEnvelope: (socket, event) => this.eventSender.sendEnvelope(socket, event),
      broadcast: (event) => this.broadcast(event),
    });
  }

  start(): void {
    this.httpServer = http.createServer((request, response) => {
      void this.httpRouter.handle(request, response);
    });
    this.httpServer.headersTimeout = 10_000;
    this.httpServer.requestTimeout = 60_000;
    this.httpServer.maxHeadersCount = 64;

    this.server = new WebSocketServer({
      noServer: true,
      maxPayload: this.serverConfig.RequestMaxBytes,
      perMessageDeflate: false,
    });
    this.server.on("error", (error) => {
      this.handleServerError(error as NodeJS.ErrnoException);
    });
    this.httpServer.on("upgrade", (request, socket, head) => {
      this.handleUpgrade(request, socket, head);
    });

    this.httpServer.on("listening", () => {
      this.handleListening();
    });
    this.httpServer.on("error", (error) => {
      this.handleServerError(error);
    });

    this.httpServer.listen(this.serverConfig.Port, this.serverConfig.Host);
    this.uploadApi.startMaintenance();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.accessGuard.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  stop(): void {
    this.uploadApi.stopMaintenance();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    for (const socket of this.server?.clients ?? []) {
      socket.close(1001, "Server shutting down");
    }
    this.server?.close();
    this.httpServer?.close();
  }

  broadcast(event: AgentDomainEvent): void {
    this.eventSender.broadcast(this.server?.clients ?? [], event);
  }

  private handleUpgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    if (new URL(request.url ?? "/", "http://senera.local").pathname !== "/") {
      this.rejectUpgrade(socket, { status: 403, code: "forbidden_origin" });
      return;
    }
    const result = this.accessGuard.authorizeWebSocket(request);
    if (!result.ok) {
      this.rejectUpgrade(socket, result.failure);
      return;
    }
    this.server?.handleUpgrade(request, socket, head, (webSocket) => {
      this.handleConnection(webSocket, result.access);
    });
  }

  private handleConnection(socket: WebSocket, access: AgentAuthenticatedAccess): void {
    this.accessGuard.registerConnection(socket, access);
    socket.on("message", (data) => {
      const authorization = this.accessGuard.authorizeMessage(socket);
      if (!authorization.ok) {
        socket.close(authorization.failure.status === 429 ? 1013 : 1008, "Access denied");
        return;
      }
      void this.messageRouter.handleMessage(socket, data);
    });
    socket.on("pong", () => this.accessGuard.recordPong(socket));
    socket.on("close", () => this.accessGuard.unregisterConnection(socket));
    socket.on("error", () => this.accessGuard.unregisterConnection(socket));
  }

  private heartbeat(): void {
    for (const socket of this.server?.clients ?? []) {
      if (this.accessGuard.shouldTerminateConnection(socket)) {
        socket.close(1008, "Session expired");
        continue;
      }
      if (socket.readyState === socket.OPEN) {
        socket.ping();
      }
    }
  }

  private rejectUpgrade(socket: Duplex, failure: AgentAccessFailure): void {
    const statusText =
      failure.status === 401
        ? "Unauthorized"
        : failure.status === 403
          ? "Forbidden"
          : failure.status === 429
            ? "Too Many Requests"
            : "Service Unavailable";
    const headers = [`HTTP/1.1 ${failure.status} ${statusText}`, "Connection: close", "Content-Length: 0"];
    if (failure.retryAfterSeconds) {
      headers.push(`Retry-After: ${failure.retryAfterSeconds}`);
    }
    socket.write(`${headers.join("\r\n")}\r\n\r\n`);
    socket.destroy();
  }

  private handleListening(): void {
    const address = this.httpServer?.address();
    const addressText =
      typeof address === "object" && address ? `${address.address}:${address.port}` : String(address ?? "");
    this.logger.banner("senera WS 服务已启动", {
      url: `ws://${addressText}`,
      hotReload: this.serverConfig.HotReload,
      requestMaxBytes: this.serverConfig.RequestMaxBytes,
      authentication: this.accessGuard.isAuthenticationRequired ? "required" : "local",
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
  configSnapshot: AgentWebSocketRequestContext["configSnapshot"],
): AgentUploadStore {
  return new AgentUploadStore({
    workspaceRoot: options.workspaceRoot ?? process.cwd(),
    config: () => resolveUploadsConfig(configSnapshot()),
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
