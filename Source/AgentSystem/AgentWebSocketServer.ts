import http from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  AgentEventKinds,
  AgentEventSequencer,
  type AgentEventEnvelope,
  type AgentDomainEvent,
  toEventEnvelope,
} from "./AgentEvent.js";
import type { AgentSystemConfig } from "./Types.js";
import { resolveModelProviderCatalog, resolveServerConfig, resolveUploadsConfig } from "./AgentDefaults.js";
import {
  AgentWebSocketRequestSchema,
} from "./AgentWebSocketProtocol.js";
import { AgentLogger } from "./AgentLogger.js";
import { serializeError } from "./AgentErrorSerializer.js";
import { AgentSessionManager } from "./AgentSessionManager.js";
import { matchByType } from "./AgentMatch.js";
import { createRequestId } from "./AgentIds.js";
import type { AgentUserProfileManager } from "./AgentUserProfile.js";
import { projectAgentRunEventForHistory } from "./AgentRunEventHistoryPolicy.js";
import { AgentPluginConfigManager } from "./AgentPluginConfigManager.js";
import { AgentUploadHttpApi } from "./Uploads/AgentUploadHttpApi.js";
import { AgentUploadStore } from "./Uploads/AgentUploadStore.js";

export interface AgentWebSocketServerOptions {
  config: AgentSystemConfig;
  workspaceRoot?: string;
  configSnapshot?: () => AgentSystemConfig;
  sessionManager: AgentSessionManager;
  userProfileManager: AgentUserProfileManager;
  pluginConfigManager?: AgentPluginConfigManager;
}

export class AgentWebSocketServer {
  private readonly serverConfig: ReturnType<typeof resolveServerConfig>;
  private httpServer?: http.Server;
  private server?: WebSocketServer;
  private readonly logger = new AgentLogger();
  private readonly sequencer = new AgentEventSequencer();
  private readonly pluginConfigManager: AgentPluginConfigManager;
  private readonly uploadApi: AgentUploadHttpApi;

  constructor(private readonly options: AgentWebSocketServerOptions) {
    this.serverConfig = resolveServerConfig(options.config);
    this.pluginConfigManager = options.pluginConfigManager ?? new AgentPluginConfigManager({
      workspaceRoot: process.cwd(),
      configSnapshot: () => options.configSnapshot?.() ?? options.config,
    });
    this.uploadApi = new AgentUploadHttpApi({
      storeFactory: () => this.createUploadStore(),
    });
  }

  start(): void {
    this.httpServer = http.createServer((request, response) => {
      void this.handleHttpRequest(request, response);
    });

    this.server = new WebSocketServer({
      server: this.httpServer,
      maxPayload: this.serverConfig.RequestMaxBytes,
    });

    this.server.on("connection", (socket) => {
      this.handleConnection(socket);
    });

    this.httpServer.on("listening", () => {
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
    });

    this.httpServer.listen(this.serverConfig.Port, this.serverConfig.Host);
  }

  stop(): void {
    this.server?.close();
    this.httpServer?.close();
  }

  broadcast(event: AgentDomainEvent): void {
    const payload = this.serialize(toEventEnvelope(event, this.sequencer.next()));

    for (const client of this.server?.clients ?? []) {
      this.send(client, payload);
    }
  }

  private handleConnection(socket: WebSocket): void {
    socket.on("message", (data) => {
      void this.handleMessage(socket, data);
    });
  }

  private async handleHttpRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    if (this.uploadApi.canHandle(request)) {
      await this.uploadApi.handle(request, response);
      return;
    }

    response.writeHead(404, {
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({
      ok: false,
      error: {
        code: "not_found",
        message: "接口不存在。",
      },
    }));
  }

  private async handleMessage(socket: WebSocket, data: RawData): Promise<void> {
    let rawRequest: unknown;
    try {
      rawRequest = JSON.parse(data.toString("utf8"));
    } catch (error) {
      this.sendEnvelope(socket, {
        kind: AgentEventKinds.RequestInvalid,
        context: {},
        data: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
      return;
    }

    const parsed = AgentWebSocketRequestSchema.safeParse(rawRequest);

    if (!parsed.success) {
      this.sendEnvelope(socket, {
        kind: AgentEventKinds.RequestInvalid,
        context: {},
        data: {
          message: "WS 请求结构无效。",
          details: parsed.error.issues,
        },
      });
      return;
    }

    const sendEvent = (event: AgentDomainEvent): void => {
      this.sendEnvelope(socket, event);
    };

    try {
      await matchByType(parsed.data, {
        "session.create": async (request) => {
          await this.options.sessionManager.createSession({
            sessionId: request.sessionId,
            onEvent: sendEvent,
          });
        },
        "session.message": async (request) => {
          await this.options.sessionManager.submitMessage({
            sessionId: request.sessionId,
            requestId: request.requestId,
            modelProviderId: request.modelProviderId,
            input: request.input,
            attachments: request.attachments,
            onEvent: sendEvent,
          });
        },
        "session.close": async (request) => {
          await this.options.sessionManager.closeSession({
            sessionId: request.sessionId,
            onEvent: sendEvent,
          });
        },
        "session.cancel": async (request) => {
          await this.options.sessionManager.cancelActiveRun({
            sessionId: request.sessionId,
            onEvent: sendEvent,
          });
        },
        "session.truncate_from": async (request) => {
          await this.options.sessionManager.truncateFromRequest({
            sessionId: request.sessionId,
            requestId: request.requestId,
            onEvent: sendEvent,
          });
        },
        "session.list": async () => {
          await this.options.sessionManager.emitSessionListSnapshot({
            onEvent: sendEvent,
          });
        },
        "session.history": async (request) => {
          await this.options.sessionManager.replayHistory({
            sessionId: request.sessionId,
            refresh: request.refresh,
            onEvent: sendEvent,
          });
        },
        "session.rename": async (request) => {
          await this.options.sessionManager.renameSession({
            sessionId: request.sessionId,
            title: request.title,
            onEvent: sendEvent,
          });
        },
        "model.list": async () => {
          const catalog = resolveModelProviderCatalog(this.options.configSnapshot?.() ?? this.options.config);
          sendEvent({
            kind: AgentEventKinds.ModelListSnapshot,
            context: {},
            data: {
              models: catalog.list(),
              defaultModelProviderId: catalog.defaultId,
            },
          });
        },
        "plugin.config.list": async () => {
          sendEvent({
            kind: AgentEventKinds.PluginConfigSnapshot,
            context: {},
            data: this.pluginConfigManager.snapshot(),
          });
        },
        "plugin.config.update": async (request) => {
          sendEvent({
            kind: AgentEventKinds.PluginConfigSnapshot,
            context: {},
            data: {
              ...this.pluginConfigManager.updatePluginConfig({
                pluginName: request.pluginName,
                toml: request.toml,
              }),
              operation: {
                requestId: request.requestId,
                kind: "update",
                pluginName: request.pluginName,
              },
            },
          });
        },
        "plugin.config.set_enabled": async (request) => {
          sendEvent({
            kind: AgentEventKinds.PluginConfigSnapshot,
            context: {},
            data: {
              ...this.pluginConfigManager.setPluginEnabled({
                pluginName: request.pluginName,
                toolName: request.toolName,
                enabled: request.enabled,
              }),
              operation: {
                requestId: request.requestId,
                kind: "set_enabled",
                pluginName: request.pluginName,
              },
            },
          });
        },
        "profile.get": async () => {
          await this.options.userProfileManager.emitSnapshot({
            onEvent: sendEvent,
          });
        },
        "profile.update": async (request) => {
          await this.options.userProfileManager.updateProfile({
            profile: request.profile,
            onEvent: sendEvent,
          });
        },
      });
    } catch (error) {
      if (
        parsed.data.type === "plugin.config.update" ||
        parsed.data.type === "plugin.config.set_enabled"
      ) {
        sendEvent({
          kind: AgentEventKinds.ConfigFailed,
          context: {},
          data: {
            configPath: parsed.data.pluginName,
            message: error instanceof Error ? error.message : String(error),
            details: serializeError(error),
            operation: {
              requestId: parsed.data.requestId,
              kind: parsed.data.type === "plugin.config.update" ? "update" : "set_enabled",
              pluginName: parsed.data.pluginName,
            },
          },
        });
        return;
      }

      const requestId = parsed.data.type === "session.message"
        ? parsed.data.requestId ?? createRequestId()
        : createRequestId();
      sendEvent({
        kind: AgentEventKinds.RunFailed,
        context: {
          requestId,
          sessionId: "sessionId" in parsed.data ? parsed.data.sessionId : undefined,
        },
        data: {
          message: error instanceof Error ? error.message : String(error),
          details: serializeError(error),
        },
      });
    }
  }

  private sendEnvelope(socket: WebSocket, event: AgentDomainEvent): void {
    const envelope = toEventEnvelope(event, this.sequencer.next());
    this.persistRunEvent(envelope);
    this.send(socket, this.serialize(envelope));
  }

  private send(socket: WebSocket, payload: string): void {
    if (socket.readyState !== socket.OPEN) {
      return;
    }

    socket.send(payload);
  }

  private serialize(payload: unknown): string {
    return JSON.stringify(payload);
  }

  private persistRunEvent(envelope: AgentEventEnvelope): void {
    const projected = projectAgentRunEventForHistory(envelope);
    if (!projected) {
      return;
    }

    try {
      this.options.sessionManager.recordRunEvent(projected);
    } catch (error) {
      this.logger.warn("执行事件持久化失败", {
        kind: projected.kind,
        requestId: projected.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private createUploadStore(): AgentUploadStore {
    const config = this.options.configSnapshot?.() ?? this.options.config;
    const uploads = resolveUploadsConfig(config);
    return new AgentUploadStore({
      workspaceRoot: this.options.workspaceRoot ?? process.cwd(),
      rootDir: uploads.RootDir,
      maxFileBytes: uploads.MaxFileBytes,
    });
  }
}
