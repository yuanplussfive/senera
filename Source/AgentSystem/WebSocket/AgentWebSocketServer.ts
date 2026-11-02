import type http from "node:http";
import { type WebSocket } from "ws";
import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import { resolveServerConfig, resolveUploadsConfig } from "../AgentDefaults.js";
import { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { AgentUploadHttpApi } from "../Uploads/AgentUploadHttpApi.js";
import { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import { AgentProviderModelDiscovery } from "../Config/AgentProviderModelDiscovery.js";
import { AgentSandboxRuntimeService } from "../Sandbox/AgentSandboxRuntimeService.js";
import { AgentWebSocketEventEnvelopeSender } from "./AgentWebSocketEventSender.js";
import { AgentWebSocketDeliveryError } from "./AgentWebSocketDeliveryError.js";
import { AgentWebSocketHttpRouter } from "./AgentWebSocketHttpRouter.js";
import { AgentWebSocketMessageRouter } from "./AgentWebSocketMessageRouter.js";
import { AgentStaticFrontendHttpApi } from "./AgentStaticFrontendHttpApi.js";
import type {
  AgentChannelServiceControl,
  AgentWebSocketRequestContext,
  AgentWebSocketServerOptions,
} from "./AgentWebSocketTypes.js";
import {
  type AgentServerAccessGuard,
  type AgentAccessFailure,
  type AgentAuthenticatedAccess,
} from "../Auth/AgentServerAccessGuard.js";
import { AgentHealthHttpApi } from "./AgentHealthHttpApi.js";
import { AgentWebSocketCloseCodes, AgentWebSocketCloseReasons } from "./AgentWebSocketCloseContract.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { AgentWebSocketTransport } from "./AgentWebSocketTransport.js";
import { AgentWorkspaceResourceHttpApi } from "../WorkspaceResources/AgentWorkspaceResourceHttpApi.js";
import { AgentProviderCredentialHttpApi } from "../Config/AgentProviderCredentialHttpApi.js";
import { AgentExtensionSecretHttpApi } from "../Config/AgentExtensionSecretHttpApi.js";
import { AgentRuntimeUpdateHttpApi } from "../Runtime/AgentRuntimeUpdateHttpApi.js";
import { AgentResourceResolver } from "../Resources/AgentResourceResolver.js";
import { AgentModelsDevCatalog } from "../ModelEndpoints/AgentModelsDevCatalog.js";
import { AgentArtifactMemoryHttpApi } from "../Memory/AgentArtifactMemoryHttpApi.js";
import { AgentProfileAvatarHttpApi } from "../Session/AgentProfileAvatarHttpApi.js";
import { AgentDirectoryHttpApi } from "../Profile/AgentDirectoryHttpApi.js";
import { readAgentMarkdownPromptPreset } from "../Prompt/AgentMarkdownPromptPreset.js";
import { resolveModelProviderConfig } from "../AgentDefaults.js";
import { AgentProfileAvatarStore } from "../Session/AgentProfileAvatarStore.js";
import { AgentWorkspaceCheckpointHttpApi } from "../WorkspaceResources/AgentWorkspaceCheckpointHttpApi.js";
import { AgentOneBot11ClientHttpApi } from "../Channels/Client/AgentOneBot11ClientHttpApi.js";
import { AgentChannelClientConnections } from "../Channels/Client/AgentChannelClientConnections.js";
import { AgentSessionInsightsHttpApi } from "../Session/AgentSessionInsightsHttpApi.js";

export type { AgentWebSocketServerOptions } from "./AgentWebSocketTypes.js";

/** Workspace endpoint; the application transport owns the listener and shared services. */
export class AgentWebSocketServer {
  readonly transport: AgentWebSocketTransport;
  get clientCount(): number {
    return this.clients.size + (this.channelClients?.clientCount ?? 0);
  }
  private readonly ownsTransport: boolean;
  private readonly workspaceId: string;
  private readonly clients = new Set<WebSocket>();
  private readonly serverConfig: ReturnType<typeof resolveServerConfig>;
  private readonly logger: AgentLogger;
  private readonly eventSender: AgentWebSocketEventEnvelopeSender;
  private readonly httpRouter: AgentWebSocketHttpRouter;
  private readonly uploadApi: AgentUploadHttpApi;
  private readonly providerCredentialApi: AgentProviderCredentialHttpApi;
  private readonly extensionSecretApi: AgentExtensionSecretHttpApi;
  private readonly workspaceResourceApi: AgentWorkspaceResourceHttpApi;
  private readonly workspaceCheckpointApi: AgentWorkspaceCheckpointHttpApi;
  private readonly profileAvatarApi: AgentProfileAvatarHttpApi;
  private readonly messageRouter: AgentWebSocketMessageRouter;
  private readonly accessGuard: AgentServerAccessGuard;
  private readonly channelControl?: AgentChannelServiceControl;
  private readonly channelClients?: AgentChannelClientConnections;
  private readonly modelsDevCatalog: AgentModelsDevCatalog;
  private heartbeatTimer?: NodeJS.Timeout;
  private unregister?: () => void;
  private stopPromise?: Promise<void>;
  private readonly onClientCountChanged?: (count: number) => void;

  constructor(options: AgentWebSocketServerOptions) {
    this.onClientCountChanged = options.onClientCountChanged;
    this.workspaceId = options.workspaceId ?? options.workspaceRoot ?? process.cwd();
    this.ownsTransport = options.transport === undefined;
    this.transport =
      options.transport ??
      new AgentWebSocketTransport({
        applicationRoot: options.authenticationRoot ?? options.workspaceRoot ?? process.cwd(),
        config: () => options.configSnapshot?.() ?? options.config,
        defaultWorkspaceId: this.workspaceId,
        catalog: options.workspaceCatalog,
        openWorkspace: options.openWorkspace,
        staticFrontendRoot: options.staticFrontendRoot,
        accessProfile: options.accessProfile,
        accessGuard: options.accessGuard,
        logger: options.logger,
      });
    this.logger = options.logger ?? new AgentLogger();
    this.channelControl = options.channelControl;
    const configSnapshot = (): ReturnType<AgentWebSocketRequestContext["configSnapshot"]> =>
      options.configSnapshot?.() ?? options.config;
    const configRevision = (): number | undefined => {
      const snapshot = options.configService?.snapshot();
      return snapshot?.revision ?? snapshot?.version;
    };
    const providerModelDiscovery = new AgentProviderModelDiscovery({
      configSnapshot,
      configRevision,
    });
    this.modelsDevCatalog = this.transport.modelsDevCatalog;
    const sandboxRuntimeService = options.sandboxRuntimeService ?? new AgentSandboxRuntimeService();
    this.serverConfig = resolveServerConfig(options.config);
    this.accessGuard = this.transport.accessGuard;
    if (options.channelClient) {
      this.channelClients = new AgentChannelClientConnections(this.accessGuard, () =>
        this.onClientCountChanged?.(this.clientCount),
      );
    }
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
        artifactManifestIndex: options.artifactManifestIndex,
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
    this.extensionSecretApi = new AgentExtensionSecretHttpApi({
      configSnapshot,
      systemExtensions: () => options.mcpManagement?.listSystemExtensions() ?? [],
      isOriginAllowed: (origin, corsRequest) => this.accessGuard.allowsOrigin(origin, corsRequest),
    });
    this.workspaceResourceApi = new AgentWorkspaceResourceHttpApi({
      workspaceRoot: options.workspaceRoot ?? process.cwd(),
      maxTextBytes: this.serverConfig.RequestMaxBytes,
      isOriginAllowed: (origin, corsRequest) => this.accessGuard.allowsOrigin(origin, corsRequest),
    });
    this.workspaceCheckpointApi = new AgentWorkspaceCheckpointHttpApi({
      workspaceRoot: options.workspaceRoot ?? process.cwd(),
      configSnapshot,
      artifactManifestIndex: options.artifactManifestIndex,
      maxRequestBytes: this.serverConfig.RequestMaxBytes,
      isOriginAllowed: (origin, corsRequest) => this.accessGuard.allowsOrigin(origin, corsRequest),
    });
    const profileAvatarStore =
      options.profileAvatarStore ?? new AgentProfileAvatarStore(options.workspaceRoot ?? process.cwd());
    this.profileAvatarApi = new AgentProfileAvatarHttpApi({
      store: profileAvatarStore,
      isOriginAllowed: (origin, corsRequest) => this.accessGuard.allowsOrigin(origin, corsRequest),
    });
    const artifactMemoryApi = new AgentArtifactMemoryHttpApi({
      artifactManifestIndex: options.artifactManifestIndex,
      workspaceRoot: options.workspaceRoot ?? process.cwd(),
      configSnapshot,
      maxRequestBytes: this.serverConfig.RequestMaxBytes,
      isOriginAllowed: (origin, corsRequest) => this.accessGuard.allowsOrigin(origin, corsRequest),
    });
    this.httpRouter = new AgentWebSocketHttpRouter({
      agentDirectoryApi: options.agentDirectory
        ? new AgentDirectoryHttpApi({
            directory: options.agentDirectory,
            commands: options.agentDirectoryCommands,
            maximumBytes: this.serverConfig.RequestMaxBytes,
            isOriginAllowed: (origin, request) => this.accessGuard.allowsOrigin(origin, request),
            validateAgent: async (input) => {
              if (input.modelProviderId) resolveModelProviderConfig(configSnapshot(), input.modelProviderId);
              if (input.presetPath) {
                const result = readAgentMarkdownPromptPreset(
                  options.workspaceRoot ?? process.cwd(),
                  this.serverConfig.RequestMaxBytes,
                  { activePath: input.presetPath, enabled: true },
                );
                if (result.error) throw new Error(result.error);
              }
              if (input.avatarPath && !(await profileAvatarStore.isReadable("assistant", input.avatarPath)))
                throw new Error("Select an uploaded assistant avatar.");
            },
          })
        : undefined,
      uploadApi: this.uploadApi,
      sessionInsightsApi: new AgentSessionInsightsHttpApi({
        read: (input) => options.sessionManager.readInsights(input),
        isOriginAllowed: (origin, request) => this.accessGuard.allowsOrigin(origin, request),
      }),
      channelClientApi: options.channelClient ? new AgentOneBot11ClientHttpApi(options.channelClient) : undefined,
      providerCredentialApi: this.providerCredentialApi,
      extensionSecretApi: this.extensionSecretApi,
      workspaceResourceApi: this.workspaceResourceApi,
      workspaceCheckpointApi: this.workspaceCheckpointApi,
      profileAvatarApi: this.profileAvatarApi,
      artifactMemoryApi,
      staticFrontendApi: options.staticFrontendRoot
        ? new AgentStaticFrontendHttpApi({ rootDir: options.staticFrontendRoot })
        : undefined,
      healthApi: new AgentHealthHttpApi(),
      runtimeUpdateApi: options.runtimeUpdate ? new AgentRuntimeUpdateHttpApi(options.runtimeUpdate) : undefined,
      channelWebhookApi: options.channelWebhookApi,
      selfApi: options.selfApi,
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
        approvalRuntime: options.approvalRuntime,
        interactionInput: options.interactionInput,
        sandboxRuntimeService,
        executionResources: options.executionResources,
        interactiveTerminals: options.interactiveTerminals,
        workspaceRoot: options.workspaceRoot ?? process.cwd(),
        logger: this.logger,
        mcpManagement: options.mcpManagement,
        pluginHost: options.pluginHost,
        runtimeDependencies: options.runtimeDependencies,
        workspaceInfo: options.workspaceInfo,
        workspaceSwitchRequest: options.workspaceSwitchRequest,
      },
      sendEnvelope: (socket, event) => this.eventSender.sendEnvelope(socket, event),
      broadcast: (event) => this.broadcast(event),
      broadcastConfiguration: (event) => this.broadcastApplication(event),
      flushPersistence: () => this.eventSender.flush(),
      channelControl: options.channelControl,
    });
  }

  async start(): Promise<void> {
    if (this.unregister || this.stopPromise) throw new Error("Workspace endpoint already started or stopped.");
    this.unregister = this.transport.register(this.workspaceId, this);
    if (this.ownsTransport) await this.transport.start();
    this.uploadApi.startMaintenance();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.accessGuard.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  stop(): Promise<void> {
    return (this.stopPromise ??= (async () => {
      this.unregister?.();
      this.unregister = undefined;
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.channelClients?.close();
      const clientsClosed = Promise.all(
        [...this.clients].map(
          (socket) =>
            new Promise<void>((resolve) => {
              socket.once("close", () => resolve());
              socket.close(1001, "Workspace shutting down");
            }),
        ),
      );
      const forceClose = setTimeout(() => {
        for (const socket of this.clients) socket.terminate();
      }, 250);
      forceClose.unref();
      const outcomes = await Promise.allSettled([
        clientsClosed,
        this.uploadApi.stopMaintenance(),
        this.workspaceResourceApi.close(),
        this.eventSender.close(),
        ...(this.ownsTransport ? [this.transport.stop()] : []),
      ]).finally(() => clearTimeout(forceClose));
      const failures = outcomes.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
      if (failures.length) throw new AggregateError(failures, "Workspace endpoint shutdown failed.");
    })());
  }

  broadcast(event: AgentDomainEvent): Promise<void> {
    return this.eventSender.broadcast(this.clients, event);
  }

  broadcastApplication(event: AgentDomainEvent): Promise<void> {
    return this.transport.broadcast(event);
  }

  handleHttp(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    return this.httpRouter.handle(request, response);
  }

  connect(socket: WebSocket, access: AgentAuthenticatedAccess): void {
    if (this.stopPromise) {
      socket.close(1001, "Workspace shutting down");
      return;
    }
    this.clients.add(socket);
    this.onClientCountChanged?.(this.clientCount);
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
      this.clients.delete(socket);
      this.onClientCountChanged?.(this.clientCount);
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
      .catch((error: unknown) => {
        if (!(error instanceof AgentWebSocketDeliveryError))
          this.logger.warn("消息渠道初始状态发送失败", { error: errorMessage(error) });
      });
  }

  private heartbeat(): void {
    this.channelClients?.heartbeat();
    for (const socket of this.clients) {
      const failure = this.accessGuard.connectionFailure(socket);
      if (failure) {
        socket.close(failure.code, failure.reason);
        continue;
      }
      if (socket.readyState === socket.OPEN) {
        socket.ping();
      }
    }
  }

  connectChannelClient(socket: WebSocket, access: AgentAuthenticatedAccess, request: http.IncomingMessage): void {
    if (this.stopPromise || !this.channelClients || !this.channelControl?.connectOneBot11Client) {
      socket.close(1001, "Channel client is unavailable");
      return;
    }
    this.channelClients.add(socket, access);
    try {
      this.channelControl.connectOneBot11Client(socket, request);
    } catch (error) {
      this.logger.warn("渠道客户端连接失败", { error: errorMessage(error) });
      socket.close(1011, "Channel connection failed");
    }
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
