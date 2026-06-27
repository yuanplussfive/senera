import http from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  AgentEventKinds,
  AgentEventSequencer,
  type AgentEventEnvelope,
  type AgentDomainEvent,
  toEventEnvelope,
} from "./AgentEvent.js";
import type { AgentSystemConfig } from "./Types/AgentConfigTypes.js";
import {
  resolveModelProviderCatalog,
  resolvePresetsConfig,
  resolveServerConfig,
  resolveUploadsConfig,
} from "./AgentDefaults.js";
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
import { AgentPresetManager } from "./Presets/AgentPresetManager.js";
import { AgentConfigService } from "./Config/AgentConfigService.js";
import { projectAgentConfigForm } from "./Config/AgentConfigFormProjector.js";
import { AgentProviderModelDiscovery } from "./Config/AgentProviderModelDiscovery.js";

export interface AgentWebSocketServerOptions {
  config: AgentSystemConfig;
  workspaceRoot?: string;
  configSnapshot?: () => AgentSystemConfig;
  configService?: AgentConfigService;
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
  private readonly providerModelDiscovery: AgentProviderModelDiscovery;

  constructor(private readonly options: AgentWebSocketServerOptions) {
    this.serverConfig = resolveServerConfig(options.config);
    this.pluginConfigManager = options.pluginConfigManager ?? new AgentPluginConfigManager({
      workspaceRoot: process.cwd(),
      configSnapshot: () => options.configSnapshot?.() ?? options.config,
    });
    this.uploadApi = new AgentUploadHttpApi({
      storeFactory: () => this.createUploadStore(),
    });
    this.providerModelDiscovery = new AgentProviderModelDiscovery({
      configSnapshot: () => options.configSnapshot?.() ?? options.config,
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
          } satisfies AgentDomainEvent);
        },
        "provider.models.fetch": async (request) => {
          try {
            sendEvent({
              kind: AgentEventKinds.ProviderModelsSnapshot,
              context: {},
              data: await this.providerModelDiscovery.listProviderModels({
                providerId: request.providerId,
                force: request.force,
                endpoint: request.endpoint,
              }),
            });
          } catch (error) {
            sendEvent({
              kind: AgentEventKinds.ProviderModelsFailed,
              context: {},
              data: {
                providerId: request.providerId,
                message: error instanceof Error ? error.message : String(error),
                details: serializeError(error),
              },
            });
          }
        },
        "config.get": async () => {
          const snapshot = this.options.configService?.snapshot();
          if (!snapshot) {
            const config = this.options.configSnapshot?.() ?? this.options.config;
            sendEvent({
              kind: AgentEventKinds.ConfigSnapshot,
              context: {},
              data: {
                path: "",
                version: 1,
                value: config,
                source: "json",
                diagnostics: [],
                form: projectAgentConfigForm(config),
              },
            });
            return;
          }

          sendEvent({
            kind: AgentEventKinds.ConfigSnapshot,
            context: {},
            data: snapshot,
          });
        },
        "config.update": async (request) => {
          if (!this.options.configService) {
            throw new Error("当前运行时没有启用配置服务。");
          }
          const snapshot = this.options.configService.update({
            config: request.config,
            source: "ui_update",
            mirrorJson: request.mirrorJson,
          });
          sendEvent({
            kind: AgentEventKinds.ConfigSnapshot,
            context: {},
            data: {
              ...snapshot,
              operation: {
                requestId: request.requestId,
                kind: "config_update",
              },
            },
          });
          sendEvent({
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
        "preset.list": async () => {
          sendEvent({
            kind: AgentEventKinds.PresetSnapshot,
            context: {},
            data: await this.createPresetManager().snapshot({
              kind: "list",
            }),
          });
        },
        "preset.save": async (request) => {
          sendEvent({
            kind: AgentEventKinds.PresetSnapshot,
            context: {},
            data: await this.createPresetManager().save({
              requestId: request.requestId,
              name: request.name,
              format: request.format,
              content: request.content,
              activate: request.activate,
            }),
          });
        },
        "preset.delete": async (request) => {
          sendEvent({
            kind: AgentEventKinds.PresetSnapshot,
            context: {},
            data: await this.createPresetManager().delete({
              requestId: request.requestId,
              name: request.name,
            }),
          });
        },
        "preset.set_active": async (request) => {
          sendEvent({
            kind: AgentEventKinds.PresetSnapshot,
            context: {},
            data: await this.createPresetManager().setActive({
              requestId: request.requestId,
              name: request.name,
            }),
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
        parsed.data.type === "plugin.config.set_enabled" ||
        parsed.data.type === "config.update"
      ) {
        sendEvent({
          kind: AgentEventKinds.ConfigFailed,
          context: {},
          data: {
            configPath: parsed.data.type === "config.update"
              ? this.options.configService?.snapshot().path ?? ""
              : parsed.data.pluginName,
            message: error instanceof Error ? error.message : String(error),
            details: serializeError(error),
            operation: parsed.data.type === "config.update"
              ? {
                  requestId: parsed.data.requestId,
                  kind: "config_update",
                }
              : {
                  requestId: parsed.data.requestId,
                  kind: parsed.data.type === "plugin.config.update" ? "update" : "set_enabled",
                  pluginName: parsed.data.pluginName,
                },
          },
        });
        return;
      }

      if (isPresetRequest(parsed.data)) {
        sendEvent({
          kind: AgentEventKinds.PresetFailed,
          context: {},
          data: {
            message: error instanceof Error ? error.message : String(error),
            details: serializeError(error),
            operation: {
              requestId: "requestId" in parsed.data ? parsed.data.requestId : undefined,
              kind: presetOperationKindFromRequestType(parsed.data.type),
              name: "name" in parsed.data ? parsed.data.name ?? null : undefined,
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

  private createPresetManager(): AgentPresetManager {
    const config = this.options.configSnapshot?.() ?? this.options.config;
    return new AgentPresetManager({
      workspaceRoot: this.options.workspaceRoot ?? process.cwd(),
      config: resolvePresetsConfig(config),
    });
  }
}

type PresetRequest = Extract<
  import("./AgentWebSocketProtocol.js").AgentWebSocketRequest,
  { type: "preset.list" | "preset.save" | "preset.delete" | "preset.set_active" }
>;

function isPresetRequest(
  request: import("./AgentWebSocketProtocol.js").AgentWebSocketRequest,
): request is PresetRequest {
  return request.type === "preset.list"
    || request.type === "preset.save"
    || request.type === "preset.delete"
    || request.type === "preset.set_active";
}

function presetOperationKindFromRequestType(
  type: PresetRequest["type"],
): "list" | "save" | "delete" | "set_active" {
  switch (type) {
    case "preset.list":
      return "list";
    case "preset.save":
      return "save";
    case "preset.delete":
      return "delete";
    case "preset.set_active":
      return "set_active";
  }
}
