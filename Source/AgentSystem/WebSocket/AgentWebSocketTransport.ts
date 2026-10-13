import http from "node:http";
import { format } from "node:url";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import {
  AgentServerAccessGuard,
  type AgentAccessFailure,
  type AgentAuthenticatedAccess,
} from "../Auth/AgentServerAccessGuard.js";
import { applyCredentialedCors, writeCorsPreflight } from "../Auth/AgentCredentialedCors.js";
import { AgentAuthenticationHttpApi } from "../Auth/AgentAuthenticationHttpApi.js";
import { AgentHealthHttpApi } from "./AgentHealthHttpApi.js";
import { AgentStaticFrontendHttpApi } from "./AgentStaticFrontendHttpApi.js";
import { AgentModelsDevCatalog } from "../ModelEndpoints/AgentModelsDevCatalog.js";
import { resolveModelProviderCatalog, resolveServerConfig } from "../AgentDefaults.js";
import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { errorMessage } from "../Core/AgentErrors.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import {
  AgentWorkspaceNotFoundError,
  type AgentWorkspaceCatalog,
} from "../WorkspaceResources/AgentWorkspaceCatalog.js";
import {
  AgentWorkspaceCatalogRoute,
  AgentWorkspaceCatalogSnapshotSchema,
} from "../WorkspaceResources/AgentWorkspaceCatalogContract.js";
import { AgentWebSocketCloseCodes, AgentWebSocketCloseReasons } from "./AgentWebSocketCloseContract.js";
import { AgentWorkspaceScopeParameter } from "../WorkspaceResources/AgentWorkspaceTransportScope.js";
import { resolveAgentApplicationPaths } from "../Core/AgentApplicationPaths.js";
import { readAgentApplicationStorage } from "../WorkspaceResources/AgentApplicationStorage.js";
import { AgentApplicationHttpRoutes } from "../WorkspaceResources/AgentApplicationStorageContract.js";

export interface AgentWorkspaceTransportEndpoint {
  connect(socket: WebSocket, access: AgentAuthenticatedAccess): void;
  handleHttp(request: http.IncomingMessage, response: http.ServerResponse): Promise<void>;
  broadcast(event: AgentDomainEvent): Promise<void>;
}

export interface AgentWebSocketTransportOptions {
  applicationRoot: string;
  config: () => AgentSystemConfig;
  defaultWorkspaceId: string;
  catalog?: AgentWorkspaceCatalog;
  openWorkspace?: (id: string) => Promise<void>;
  staticFrontendRoot?: string;
  automaticLoopbackHttp?: boolean;
  accessGuard?: AgentServerAccessGuard;
  logger?: AgentLogger;
}

/** Owns the listener and shared catalogs; workspace endpoints own their clients and requests. */
export class AgentWebSocketTransport {
  readonly listener: Readonly<{ host: string; port: number }>;
  readonly websocketUrl: string;
  readonly accessGuard: AgentServerAccessGuard;
  readonly modelsDevCatalog: AgentModelsDevCatalog;
  private readonly endpoints = new Map<string, AgentWorkspaceTransportEndpoint>();
  private readonly logger: AgentLogger;
  private readonly config;
  private readonly authenticationApi;
  private readonly healthApi = new AgentHealthHttpApi();
  private readonly staticApi?: AgentStaticFrontendHttpApi;
  private httpServer?: http.Server;
  private sockets?: WebSocketServer;
  private accepting = false;
  private stopPromise?: Promise<void>;

  constructor(private readonly options: AgentWebSocketTransportOptions) {
    this.logger = options.logger ?? new AgentLogger();
    this.config = resolveServerConfig(options.config());
    this.listener = Object.freeze({ host: this.config.Host, port: this.config.Port });
    this.websocketUrl = format({ protocol: "ws", hostname: this.config.Host, port: this.config.Port, slashes: true });
    this.accessGuard =
      options.accessGuard ??
      new AgentServerAccessGuard({
        server: this.config,
        workspaceRoot: options.applicationRoot,
        automaticLoopbackHttp: options.automaticLoopbackHttp,
      });
    this.authenticationApi = new AgentAuthenticationHttpApi(this.accessGuard);
    this.staticApi = options.staticFrontendRoot
      ? new AgentStaticFrontendHttpApi({ rootDir: options.staticFrontendRoot })
      : undefined;
    this.modelsDevCatalog = new AgentModelsDevCatalog({
      workspaceRoot: options.applicationRoot,
      onUpdated: () => this.broadcastModels(),
      onError: (error) => this.logger.warn("models.dev 模型目录刷新失败", { error: errorMessage(error) }),
    });
  }

  register(id: string, endpoint: AgentWorkspaceTransportEndpoint): () => void {
    if (this.endpoints.has(id)) throw new Error(`Workspace endpoint already registered: ${id}`);
    this.endpoints.set(id, endpoint);
    return () => {
      if (this.endpoints.get(id) === endpoint) this.endpoints.delete(id);
    };
  }

  broadcast(event: AgentDomainEvent): Promise<void> {
    return Promise.all([...this.endpoints.values()].map((endpoint) => endpoint.broadcast(event))).then(() => undefined);
  }

  async start(): Promise<void> {
    if (this.httpServer || this.stopPromise) throw new Error("Application transport already started or stopped.");
    this.httpServer = http.createServer((request, response) => {
      void this.route(request, response).catch((error) => {
        if (error instanceof AgentWorkspaceNotFoundError && !response.headersSent) {
          if (
            !applyCredentialedCors(request, response, {
              allowedMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
              allowedHeaders: ["content-type", "x-senera-csrf"],
              isOriginAllowed: (origin, corsRequest) => this.accessGuard.allowsOrigin(origin, corsRequest),
            })
          ) {
            response.writeHead(403);
            response.end();
            return;
          }
          response.writeHead(404, { "Cache-Control": "no-store", "Content-Type": "application/json" });
          response.end(
            JSON.stringify({ ok: false, error: { code: "workspace_not_found", workspaceId: error.workspaceId } }),
          );
          return;
        }
        this.logger.error("HTTP 请求处理失败", { error: errorMessage(error) });
        if (response.headersSent) {
          response.destroy();
          return;
        }
        response.writeHead(500, { "Cache-Control": "no-store", "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: { code: "internal_error", message: "Request failed." } }));
      });
    });
    this.httpServer.headersTimeout = 10_000;
    this.httpServer.requestTimeout = 60_000;
    this.httpServer.maxHeadersCount = 64;
    this.sockets = new WebSocketServer({
      noServer: true,
      maxPayload: this.config.RequestMaxBytes,
      perMessageDeflate: false,
    });
    this.sockets.on("error", (error) => this.logger.error("WebSocket 传输失败", { error: errorMessage(error) }));
    this.httpServer.on("upgrade", (request, socket, head) => {
      void this.upgrade(request, socket, head).catch((error) => {
        this.logger.warn("工作区连接失败", { error: errorMessage(error) });
        this.rejectUpgrade(socket, { status: 503, code: "capacity_exceeded" });
      });
    });
    await new Promise<void>((resolve, reject) => {
      const server = this.httpServer!;
      const failed = (error: Error) => {
        server.off("listening", ready);
        reject(error);
      };
      const ready = () => {
        server.off("error", failed);
        resolve();
      };
      server.once("error", failed);
      server.once("listening", ready);
      server.listen(this.config.Port, this.config.Host);
    });
    this.httpServer.on("error", (error) => this.logger.error("HTTP 传输失败", { error: errorMessage(error) }));
    this.accepting = true;
    this.modelsDevCatalog.start();
  }

  stop(): Promise<void> {
    this.accepting = false;
    return (this.stopPromise ??= (async () => {
      await this.modelsDevCatalog.stop();
      const server = this.httpServer;
      const sockets = this.sockets;
      for (const socket of sockets?.clients ?? []) socket.close(1001, "Application shutting down");
      server?.closeIdleConnections();
      const forceClose = setTimeout(() => {
        for (const socket of sockets?.clients ?? []) socket.terminate();
        server?.closeAllConnections();
      }, 250);
      forceClose.unref();
      const outcomes = await Promise.allSettled([
        new Promise<void>((resolve, reject) =>
          sockets ? sockets.close((error) => (error ? reject(error) : resolve())) : resolve(),
        ),
        new Promise<void>((resolve, reject) =>
          server?.listening ? server.close((error) => (error ? reject(error) : resolve())) : resolve(),
        ),
      ]).finally(() => clearTimeout(forceClose));
      const failures = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason] : []));
      if (failures.length) throw new AggregateError(failures, "Application transport shutdown failed.");
    })());
  }

  private async endpoint(id: string): Promise<AgentWorkspaceTransportEndpoint> {
    if (!this.endpoints.has(id)) {
      this.options.catalog?.get(id);
      await this.options.openWorkspace?.(id);
    }
    const endpoint = this.endpoints.get(id);
    if (!endpoint) throw new Error(`Workspace is unavailable: ${id}`);
    return endpoint;
  }

  private async upgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (!this.accepting) {
      socket.destroy();
      return;
    }
    const url = new URL(request.url ?? "/", "http://senera.local");
    if (url.pathname !== "/") {
      this.rejectUpgrade(socket, { status: 403, code: "forbidden_origin" });
      return;
    }
    const result = this.accessGuard.authorizeWebSocket(request);
    if (!result.ok) {
      this.rejectUpgrade(socket, result.failure);
      return;
    }
    let endpoint: AgentWorkspaceTransportEndpoint;
    try {
      endpoint = await this.endpoint(
        url.searchParams.get(AgentWorkspaceScopeParameter) ?? this.options.defaultWorkspaceId,
      );
    } catch (error) {
      if (!(error instanceof AgentWorkspaceNotFoundError)) throw error;
      if (socket.destroyed || !this.accepting) return;
      // Browsers cannot read failed upgrade responses. A close frame conveys the permanent failure.
      this.sockets!.handleUpgrade(request, socket, head, (webSocket) =>
        webSocket.close(AgentWebSocketCloseCodes.WorkspaceNotFound, AgentWebSocketCloseReasons.WorkspaceNotFound),
      );
      return;
    }
    if (socket.destroyed || !this.accepting) return;
    this.sockets!.handleUpgrade(request, socket, head, (webSocket) => endpoint.connect(webSocket, result.access));
  }

  private rejectUpgrade(socket: Duplex, failure: AgentAccessFailure): void {
    const headers = [
      `HTTP/1.1 ${failure.status} ${http.STATUS_CODES[failure.status]}`,
      "Connection: close",
      "Content-Length: 0",
    ];
    if (failure.retryAfterSeconds) headers.push(`Retry-After: ${failure.retryAfterSeconds}`);
    socket.end(`${headers.join("\r\n")}\r\n\r\n`);
  }

  private async route(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (!this.accepting) {
      response.writeHead(503);
      response.end();
      return;
    }
    if (this.authenticationApi.canHandle(request)) {
      await this.authenticationApi.handle(request, response);
      return;
    }
    if (this.healthApi.canHandle(request)) {
      this.healthApi.handle(request, response);
      return;
    }
    if (this.staticApi?.canHandle(request)) {
      this.staticApi.handle(request, response);
      return;
    }
    const url = new URL(request.url ?? "/", "http://senera.local");
    if (url.pathname === AgentWorkspaceCatalogRoute && this.options.catalog) {
      if (!this.authorizeApplicationRead(request, response)) return;
      const data = AgentWorkspaceCatalogSnapshotSchema.parse({
        workspaces: this.options.catalog.list(),
        defaultWorkspaceId: this.options.defaultWorkspaceId,
      });
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(data));
      return;
    }
    if (url.pathname === AgentApplicationHttpRoutes.Storage) {
      if (
        !applyCredentialedCors(request, response, {
          allowedMethods: ["GET", "OPTIONS"],
          allowedHeaders: [],
          isOriginAllowed: (origin, corsRequest) => this.accessGuard.allowsOrigin(origin, corsRequest),
        })
      ) {
        response.writeHead(403);
        response.end();
        return;
      }
      if (request.method === "OPTIONS") {
        writeCorsPreflight(response);
        return;
      }
      const authorization = this.accessGuard.authorizeHttp(request, { requireCsrf: false });
      if (!authorization.ok) {
        response.writeHead(authorization.failure.status);
        response.end();
        return;
      }
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET" });
        response.end();
        return;
      }
      const data = await readAgentApplicationStorage(
        resolveAgentApplicationPaths(this.options.applicationRoot),
        this.options.catalog,
      );
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(data));
      return;
    }
    if (url.pathname === "/api/workspace-directories" && this.options.catalog) {
      await this.browse(request, response, url);
      return;
    }
    // Authorize before opening any project or starting its resources.
    const workspaceId = url.searchParams.get(AgentWorkspaceScopeParameter) ?? this.options.defaultWorkspaceId;
    if (!this.endpoints.has(workspaceId)) {
      const authorization = this.accessGuard.authorizeHttp(request, { requireCsrf: false });
      if (!authorization.ok) {
        response.writeHead(authorization.failure.status);
        response.end();
        return;
      }
    }
    const endpoint = await this.endpoint(workspaceId);
    url.searchParams.delete(AgentWorkspaceScopeParameter);
    request.url = `${url.pathname}${url.search}`;
    await endpoint.handleHttp(request, response);
  }

  private async browse(request: http.IncomingMessage, response: http.ServerResponse, url: URL): Promise<void> {
    if (!this.authorizeApplicationRead(request, response)) return;
    try {
      const directory = url.searchParams.get("path");
      if (!directory) throw new Error("A directory path is required.");
      const listing = this.options.catalog!.browse(directory);
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(listing));
    } catch {
      response.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(
        JSON.stringify({ ok: false, error: { code: "workspace_directory_invalid", message: "Invalid directory." } }),
      );
    }
  }

  private authorizeApplicationRead(request: http.IncomingMessage, response: http.ServerResponse): boolean {
    if (
      !applyCredentialedCors(request, response, {
        allowedMethods: ["GET", "OPTIONS"],
        allowedHeaders: [],
        isOriginAllowed: (origin, corsRequest) => this.accessGuard.allowsOrigin(origin, corsRequest),
      })
    ) {
      response.writeHead(403);
      response.end();
      return false;
    }
    if (request.method === "OPTIONS") {
      writeCorsPreflight(response);
      return false;
    }
    const authorization = this.accessGuard.authorizeHttp(request, { requireCsrf: false });
    if (!authorization.ok) {
      response.writeHead(authorization.failure.status);
      response.end();
      return false;
    }
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" });
      response.end();
      return false;
    }
    return true;
  }

  private async broadcastModels(): Promise<void> {
    if (!this.accepting) return;
    const catalog = resolveModelProviderCatalog(this.options.config());
    await this.broadcast({
      kind: AgentEventKinds.ModelListSnapshot,
      context: {},
      data: {
        models: catalog
          .list()
          .map((model) => ({ ...model, modelsDev: this.modelsDevCatalog.resolve(model.providerId, model.model) })),
        modelsDev: await this.modelsDevCatalog.snapshot(),
        defaultModelProviderId: catalog.defaultId,
      },
    });
  }
}
