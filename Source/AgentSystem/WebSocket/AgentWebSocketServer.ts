import http from "node:http";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import {
  resolveModelProviderCatalog,
  resolvePresetsConfig,
  resolveServerConfig,
  resolveUploadsConfig,
} from "../AgentDefaults.js";
import { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { AgentPresetManager } from "../Presets/AgentPresetManager.js";
import { AgentUploadHttpApi } from "../Uploads/AgentUploadHttpApi.js";
import { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import { AgentProviderModelDiscovery } from "../Config/AgentProviderModelDiscovery.js";
import { AgentSandboxRuntimeService } from "../Sandbox/AgentSandboxRuntimeService.js";
import { AgentWebSocketEventEnvelopeSender } from "./AgentWebSocketEventSender.js";
import { AgentWebSocketHttpRouter } from "./AgentWebSocketHttpRouter.js";
import { AgentWebSocketMessageRouter } from "./AgentWebSocketMessageRouter.js";
import { AgentStaticFrontendHttpApi } from "./AgentStaticFrontendHttpApi.js";
import type {
  AgentChannelServiceControl,
  AgentWebSocketRequestContext,
  AgentWebSocketServerOptions,
} from "./AgentWebSocketTypes.js";
import { AgentAuthenticationHttpApi } from "../Auth/AgentAuthenticationHttpApi.js";
import {
  AgentServerAccessGuard,
  type AgentAccessFailure,
  type AgentAuthenticatedAccess,
} from "../Auth/AgentServerAccessGuard.js";
import { AgentHealthHttpApi } from "./AgentHealthHttpApi.js";
import { AgentWebSocketCloseCodes, AgentWebSocketCloseReasons } from "./AgentWebSocketCloseContract.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { AgentWorkspaceResourceHttpApi } from "../WorkspaceResources/AgentWorkspaceResourceHttpApi.js";
import { AgentProviderCredentialHttpApi } from "../Config/AgentProviderCredentialHttpApi.js";
import { AgentRuntimeUpdateHttpApi } from "../Runtime/AgentRuntimeUpdateHttpApi.js";
import { AgentResourceResolver } from "../Resources/AgentResourceResolver.js";
import { AgentModelsDevCatalog } from "../ModelEndpoints/AgentModelsDevCatalog.js";

export type { AgentWebSocketServerOptions } from "./AgentWebSocketTypes.js";

const ServerShutdownGraceMs = 250;

export class AgentWebSocketServer {
  private readonly serverConfig: ReturnType<typeof resolveServerConfig>;
  private readonly logger: AgentLogger;
  private readonly eventSender: AgentWebSocketEventEnvelopeSender;
  private readonly httpRouter: AgentWebSocketHttpRouter;
  private readonly uploadApi: AgentUploadHttpApi;
  private readonly providerCredentialApi: AgentProviderCredentialHttpApi;
  private readonly workspaceResourceApi: AgentWorkspaceResourceHttpApi;
  private readonly messageRouter: AgentWebSocketMessageRouter;
  private readonly accessGuard: AgentServerAccessGuard;
  private readonly channelControl?: AgentChannelServiceControl;
  private readonly modelsDevCatalog: AgentModelsDevCatalog;
  private readonly configSnapshot: AgentWebSocketRequestContext["configSnapshot"];
  private httpServer?: http.Server;
  private server?: WebSocketServer;
  private heartbeatTimer?: NodeJS.Timeout;
  private acceptingConnections = false;
  private stopPromise?: Promise<void>;

  constructor(options: AgentWebSocketServerOptions) {
    this.logger = options.logger ?? new AgentLogger();
    this.channelControl = options.channelControl;
    const configSnapshot = (): ReturnType<AgentWebSocketRequestContext["configSnapshot"]> =>
      options.configSnapshot?.() ?? options.config;
    this.configSnapshot = configSnapshot;
    const configRevision = (): number | undefined => {
      const snapshot = options.configService?.snapshot();
      return snapshot?.revision ?? snapshot?.version;
    };
    const providerModelDiscovery = new AgentProviderModelDiscovery({
      configSnapshot,
      configRevision,
    });
    this.modelsDevCatalog = new AgentModelsDevCatalog({
      workspaceRoot: options.workspaceRoot ?? process.cwd(),
      onUpdated: () => this.broadcastModelListSnapshot(),
      onError: (error) =>
        this.logger.warn("models.dev 模型目录刷新失败", {
          error: error instanceof Error ? error.message : String(error),
        }),
    });
    const sandboxRuntimeService = options.sandboxRuntimeService ?? new AgentSandboxRuntimeService();
    this.serverConfig = resolveServerConfig(options.config);
    this.accessGuard = new AgentServerAccessGuard({
      server: this.serverConfig,
      workspaceRoot: options.workspaceRoot ?? process.cwd(),
      automaticLoopbackHttp: options.automaticLoopbackHttp,
    });
    this.eventSender = new AgentWebSocketEventEnvelopeSender({
      logger: this.logger,
      eventWriter: options.eventWriter,
      eventLogger: options.eventLogger,
      maxBufferedBytes: this.serverConfig.RequestMaxBytes,
      persistence: options.eventPersistence,
    });
    const uploadStore = options.uploadStore ?? createUploadStore(options, configSnapshot);
    const resourceResolver =
      options.resourceResolver ??
      new AgentResourceResolver({
        workspaceRoot: options.workspaceRoot ?? process.cwd(),
        config: configSnapshot,
        uploadStore,
      });
    this.uploadApi = new AgentUploadHttpApi({
      store: uploadStore,
      resourceResolver,
      isOriginAllowed: (origin, corsRequest) => this.accessGuard.allowsOrigin(origin, corsRequest),
      onMaintenanceError: ({ error, trigger, consecutiveFailures, retryInMs }) => {
        this.logger.error("上传存储维护失败", {
          trigger,
          consecutiveFailures,
          retryInMs,
          error: errorMessage(error),
        });
      },
    });
    this.providerCredentialApi = new AgentProviderCredentialHttpApi({
      configSnapshot,
      isOriginAllowed: (origin, corsRequest) => this.accessGuard.allowsOrigin(origin, corsRequest),
    });
    this.workspaceResourceApi = new AgentWorkspaceResourceHttpApi({
      workspaceRoot: options.workspaceRoot ?? process.cwd(),
      maxTextBytes: this.serverConfig.RequestMaxBytes,
      isOriginAllowed: (origin, corsRequest) => this.accessGuard.allowsOrigin(origin, corsRequest),
    });
    this.httpRouter = new AgentWebSocketHttpRouter({
      uploadApi: this.uploadApi,
      providerCredentialApi: this.providerCredentialApi,
      workspaceResourceApi: this.workspaceResourceApi,
      staticFrontendApi: options.staticFrontendRoot
        ? new AgentStaticFrontendHttpApi({ rootDir: options.staticFrontendRoot })
        : undefined,
      authenticationApi: new AgentAuthenticationHttpApi(this.accessGuard),
      healthApi: new AgentHealthHttpApi(),
      runtimeUpdateApi: options.runtimeUpdate ? new AgentRuntimeUpdateHttpApi(options.runtimeUpdate) : undefined,
      channelWebhookApi: options.channelWebhookApi,
      accessGuard: this.accessGuard,
    });
    this.messageRouter = new AgentWebSocketMessageRouter({
      context: {
        config: options.config,
        configSnapshot,
        configService: options.configService,
        sessionManager: options.sessionManager,
        userProfileManager: options.userProfileManager,
        providerModelDiscovery,
        modelsDevCatalog: this.modelsDevCatalog,
        presetManagerFactory: () => createPresetManager(options, configSnapshot()),
        onPresetSnapshot: options.onPresetSnapshot,
        approvalRuntime: options.approvalRuntime,
        interactionInput: options.interactionInput,
        sandboxRuntimeService,
        executionResources: options.executionResources,
        interactiveTerminals: options.interactiveTerminals,
        workspaceRoot: options.workspaceRoot ?? process.cwd(),
        mcpManagement: options.mcpManagement,
        agenda: options.agenda,
        goalCommands: options.goalCommands,
        worldRuntime: options.worldRuntime,
        residentWakeRuntime: options.residentWakeRuntime,
        onWorldWake: options.onWorldWake,
      },
      sendEnvelope: (socket, event) => this.eventSender.sendEnvelope(socket, event),
      broadcast: (event) => this.broadcast(event),
      flushPersistence: () => this.eventSender.flush(),
      channelControl: options.channelControl,
    });
  }

  async start(): Promise<void> {
    if (this.stopPromise) throw new Error("WebSocket server is stopping or stopped.");
    if (this.httpServer || this.server) throw new Error("WebSocket server has already been started.");
    this.httpServer = http.createServer((request, response) => {
      void this.httpRouter.handle(request, response).catch((error) => this.handleHttpFailure(response, error));
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

    await new Promise<void>((resolve, reject) => {
      const handleListening = () => {
        this.httpServer?.off("error", handleStartupError);
        this.httpServer?.on("error", (error) => this.handleServerError(error));
        this.handleListening();
        resolve();
      };
      const handleStartupError = (error: Error) => {
        this.httpServer?.off("listening", handleListening);
        this.handleServerError(error as NodeJS.ErrnoException);
        reject(error);
      };
      this.httpServer!.once("listening", handleListening);
      this.httpServer!.once("error", handleStartupError);
      this.acceptingConnections = true;
      this.httpServer!.listen(this.serverConfig.Port, this.serverConfig.Host);
    }).catch((error: unknown) => {
      this.acceptingConnections = false;
      throw error;
    });
    this.uploadApi.startMaintenance();
    this.modelsDevCatalog.start();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.accessGuard.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  stop(): Promise<void> {
    this.acceptingConnections = false;
    return (this.stopPromise ??= this.stopServer());
  }

  private async stopServer(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.modelsDevCatalog.stop();
    const webSocketServer = this.server;
    const httpServer = this.httpServer;
    for (const socket of webSocketServer?.clients ?? []) {
      socket.close(1001, "Server shutting down");
    }
    httpServer?.closeIdleConnections?.();
    const forceCloseTimer = setTimeout(() => {
      for (const socket of webSocketServer?.clients ?? []) socket.terminate();
      httpServer?.closeAllConnections?.();
    }, ServerShutdownGraceMs);
    forceCloseTimer.unref();
    const settlements = await Promise.allSettled([
      this.uploadApi.stopMaintenance(),
      closeWebSocketServer(webSocketServer),
      closeHttpServer(httpServer),
      this.eventSender.close(),
    ]).finally(() => clearTimeout(forceCloseTimer));
    this.server = undefined;
    this.httpServer = undefined;
    const failures = settlements.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "WebSocket server shutdown failed.");
  }

  broadcast(event: AgentDomainEvent): Promise<void> {
    return this.eventSender.broadcast(this.server?.clients ?? [], event);
  }

  private async broadcastModelListSnapshot(): Promise<void> {
    if (!this.server) return;
    const modelCatalog = resolveModelProviderCatalog(this.configSnapshot());
    const catalogStatus = await this.modelsDevCatalog.snapshot();
    await this.broadcast({
      kind: AgentEventKinds.ModelListSnapshot,
      context: {},
      data: {
        models: modelCatalog
          .list()
          .map((model) => ({ ...model, modelsDev: this.modelsDevCatalog.resolve(model.providerId, model.model) })),
        modelsDev: catalogStatus,
        defaultModelProviderId: modelCatalog.defaultId,
      },
    });
  }

  private handleHttpFailure(response: http.ServerResponse, error: unknown): void {
    this.logger.error("HTTP 请求处理失败", {
      error: errorMessage(error),
    });
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(500, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(
      JSON.stringify({
        ok: false,
        error: {
          code: "internal_error",
          message: agentErrorMessage("websocket.httpRequestFailed"),
        },
      }),
    );
  }

  private handleUpgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!this.acceptingConnections) {
      socket.destroy();
      return;
    }
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
        this.closeForAccessFailure(socket, authorization.failure);
        return;
      }
      void this.messageRouter.handleMessage(socket, data).catch((error) => {
        this.logger.error("WebSocket 请求处理失败", {
          error: errorMessage(error),
        });
      });
    });
    socket.on("pong", () => this.accessGuard.recordPong(socket));
    socket.on("close", () => {
      this.accessGuard.unregisterConnection(socket);
    });
    socket.on("error", () => {
      this.accessGuard.unregisterConnection(socket);
    });
    this.sendInitialChannelStatus(socket);
  }

  private sendInitialChannelStatus(socket: WebSocket): void {
    const statuses = this.channelControl?.statuses;
    if (!statuses) return;
    void this.eventSender
      .sendEnvelope(socket, {
        kind: AgentEventKinds.ChannelStatusSnapshot,
        context: {},
        data: { statuses: [...statuses] },
      })
      .catch((error) => this.logger.warn("消息渠道初始状态发送失败", { error: errorMessage(error) }));
  }

  private heartbeat(): void {
    for (const socket of this.server?.clients ?? []) {
      if (this.accessGuard.shouldTerminateConnection(socket)) {
        socket.close(
          AgentWebSocketCloseCodes.AuthenticationRequired,
          AgentWebSocketCloseReasons.AuthenticationRequired,
        );
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

  private closeForAccessFailure(socket: WebSocket, failure: AgentAccessFailure): void {
    if (failure.code === "authentication_required") {
      socket.close(AgentWebSocketCloseCodes.AuthenticationRequired, AgentWebSocketCloseReasons.AuthenticationRequired);
      return;
    }
    if (failure.code === "forbidden_origin") {
      socket.close(AgentWebSocketCloseCodes.AccessForbidden, AgentWebSocketCloseReasons.AccessForbidden);
      return;
    }
    socket.close(1013, failure.code);
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

function closeWebSocketServer(server: WebSocketServer | undefined): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      server.close((error) => (error ? reject(error) : resolve()));
    } catch (error) {
      reject(error);
    }
  });
}

function closeHttpServer(server: http.Server | undefined): Promise<void> {
  if (!server || !server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      server.close((error) => (error ? reject(error) : resolve()));
    } catch (error) {
      reject(error);
    }
  });
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
    activation: options.presetActivation,
  });
}
