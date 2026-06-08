import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  AgentEventKinds,
  AgentEventSequencer,
  type AgentDomainEvent,
  toEventEnvelope,
} from "./AgentEvent.js";
import type { AgentSystemConfig } from "./Types.js";
import { resolveModelProviderCatalog, resolveServerConfig } from "./AgentDefaults.js";
import {
  AgentWebSocketRequestSchema,
} from "./AgentWebSocketProtocol.js";
import { AgentLogger } from "./AgentLogger.js";
import { serializeError } from "./AgentErrorSerializer.js";
import { AgentSessionManager } from "./AgentSessionManager.js";
import { matchByType } from "./AgentMatch.js";
import { createRequestId } from "./AgentIds.js";
import type { AgentUserProfileManager } from "./AgentUserProfile.js";

export interface AgentWebSocketServerOptions {
  config: AgentSystemConfig;
  configSnapshot?: () => AgentSystemConfig;
  sessionManager: AgentSessionManager;
  userProfileManager: AgentUserProfileManager;
}

export class AgentWebSocketServer {
  private readonly serverConfig: ReturnType<typeof resolveServerConfig>;
  private server?: WebSocketServer;
  private readonly logger = new AgentLogger();
  private readonly sequencer = new AgentEventSequencer();

  constructor(private readonly options: AgentWebSocketServerOptions) {
    this.serverConfig = resolveServerConfig(options.config);
  }

  start(): void {
    this.server = new WebSocketServer({
      host: this.serverConfig.Host,
      port: this.serverConfig.Port,
      maxPayload: this.serverConfig.RequestMaxBytes,
    });

    this.server.on("connection", (socket) => {
      this.handleConnection(socket);
    });

    this.server.on("listening", () => {
      const address = this.server?.address();
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
  }

  stop(): void {
    this.server?.close();
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
          this.options.sessionManager.cancelActiveRun(request.sessionId);
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
    this.send(socket, this.serialize(toEventEnvelope(event, this.sequencer.next())));
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
}
