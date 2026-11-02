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
import { AgentDeviceConnectionService } from "../Auth/AgentDeviceConnectionService.js";
import { AgentHealthHttpApi } from "./AgentHealthHttpApi.js";
import { AgentStaticFrontendHttpApi } from "./AgentStaticFrontendHttpApi.js";
import { AgentModelsDevCatalog } from "../ModelEndpoints/AgentModelsDevCatalog.js";
import { resolveModelProviderCatalog, resolveServerConfig } from "../AgentDefaults.js";
import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { errorMessage } from "../Core/AgentErrors.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import {
  AgentWorkspaceInUseError,
  AgentWorkspaceNotFoundError,
  type AgentWorkspaceCatalog,
} from "../WorkspaceResources/AgentWorkspaceCatalog.js";
import {
  AgentWorkspaceCatalogRoute,
  AgentWorkspaceIdSchema,
  AgentWorkspaceCatalogSnapshotSchema,
  type AgentWorkspaceCatalogSnapshot,
} from "../WorkspaceResources/AgentWorkspaceCatalogContract.js";
import { AgentWebSocketCloseCodes, AgentWebSocketCloseReasons } from "./AgentWebSocketCloseContract.js";
import { AgentWorkspaceScopeParameter } from "../WorkspaceResources/AgentWorkspaceTransportScope.js";
import { resolveAgentApplicationPaths } from "../Core/AgentApplicationPaths.js";
import { readAgentApplicationStorage } from "../WorkspaceResources/AgentApplicationStorage.js";
import {
  AgentApplicationHttpRoutes,
  AgentApplicationStorageScopes,
  type AgentApplicationStorageScope,
} from "../WorkspaceResources/AgentApplicationStorageContract.js";
import {
  readAgentWorkspaceStateMigrationInventory,
  removeAgentWorkspaceStateMigrationBackup,
} from "../WorkspaceResources/AgentWorkspaceStateMigrationMaintenance.js";
import { AgentOneBot11ClientSocketPath, readAgentOneBot11ClientRoute } from "../Channels/AgentChannelClientRoutes.js";
import { AgentControlWebSocketPath } from "./AgentWebSocketRoutes.js";
import { createAgentChannelWebSocketServer } from "./AgentChannelWebSocketServer.js";
import type { AgentDevelopmentFrontend } from "./AgentDevelopmentFrontend.js";
import { resolveAgentServerAccessPolicy, type AgentServerAccessProfile } from "../Auth/AgentServerAccessPolicy.js";

export interface AgentWorkspaceTransportEndpoint {
  connect(socket: WebSocket, access: AgentAuthenticatedAccess): void;
  connectChannelClient?(socket: WebSocket, access: AgentAuthenticatedAccess, request: http.IncomingMessage): void;
  handleHttp(request: http.IncomingMessage, response: http.ServerResponse): Promise<void>;
  broadcast(event: AgentDomainEvent): Promise<void>;
}

export interface AgentWebSocketTransportOptions {
  applicationRoot: string;
  config: () => AgentSystemConfig;
  defaultWorkspaceId: string;
  catalog?: AgentWorkspaceCatalog;
  openWorkspace?: (id: string) => Promise<void>;
  forgetWorkspace?: (id: string) => Promise<AgentWorkspaceCatalogSnapshot>;
  staticFrontendRoot?: string;
  developmentFrontend?: AgentDevelopmentFrontend;
  accessProfile?: AgentServerAccessProfile;
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
  private readonly deviceConnections: AgentDeviceConnectionService;
  private readonly healthApi = new AgentHealthHttpApi();
  private readonly staticApi?: AgentStaticFrontendHttpApi;
  private httpServer?: http.Server;
  private sockets?: WebSocketServer;
  private channelSockets?: WebSocketServer;
  private accepting = false;
  private stopPromise?: Promise<void>;

  constructor(private readonly options: AgentWebSocketTransportOptions) {
    this.logger = options.logger ?? new AgentLogger();
    this.config = resolveAgentServerAccessPolicy(resolveServerConfig(options.config()), options.accessProfile).server;
    this.listener = Object.freeze({ host: this.config.Host, port: this.config.Port });
    this.websocketUrl = format({ protocol: "ws", hostname: this.config.Host, port: this.config.Port, slashes: true });
    this.accessGuard =
      options.accessGuard ??
      new AgentServerAccessGuard({
        server: this.config,
        workspaceRoot: options.applicationRoot,
        accessProfile: options.accessProfile,
      });
    this.deviceConnections = new AgentDeviceConnectionService(this.accessGuard, undefined, {
      listener: this.listener,
      createServer: () => {
        const server = http.createServer((request, response) => this.httpServer!.emit("request", request, response));
        server.headersTimeout = 10_000;
        server.requestTimeout = 60_000;
        server.maxHeadersCount = 64;
        server.on("upgrade", (request, socket, head) => this.httpServer!.emit("upgrade", request, socket, head));
        return server;
      },
    });
    this.authenticationApi = new AgentAuthenticationHttpApi(this.accessGuard, this.deviceConnections);
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
        if (error instanceof AgentWorkspaceInUseError && !response.headersSent) {
          if (
            !applyCredentialedCors(request, response, {
              allowedMethods: ["GET", "DELETE", "OPTIONS"],
              allowedHeaders: ["x-senera-csrf"],
              isOriginAllowed: (origin, corsRequest) => this.accessGuard.allowsOrigin(origin, corsRequest),
            })
          ) {
            response.writeHead(403);
            response.end();
            return;
          }
          response.writeHead(409, { "Cache-Control": "no-store", "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              ok: false,
              error: { code: "workspace_in_use", workspaceId: error.workspaceId, message: error.message },
            }),
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
    this.channelSockets = createAgentChannelWebSocketServer(this.accessGuard, this.config.RequestMaxBytes);
    this.channelSockets.on("error", (error) => this.logger.error("渠道传输失败", { error: errorMessage(error) }));
    this.httpServer.on("upgrade", (request, socket, head) => {
      void this.upgrade(request, socket, head).catch((error) => {
        const pathname = new URL(request.url ?? "/", "http://senera.local").pathname;
        this.logger.warn(
          this.options.developmentFrontend?.canHandle(pathname) ? "开发热更新连接失败" : "工作区连接失败",
          {
            path: pathname,
            error: errorMessage(error),
          },
        );
        if (!socket.destroyed && socket.writable)
          socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
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
    await this.deviceConnections.restoreLan();
    this.modelsDevCatalog.start();
  }

  stop(): Promise<void> {
    this.accepting = false;
    return (this.stopPromise ??= (async () => {
      this.options.developmentFrontend?.close();
      await this.deviceConnections.stop();
      await this.modelsDevCatalog.stop();
      const server = this.httpServer;
      const sockets = this.sockets;
      const channelSockets = this.channelSockets;
      for (const socket of sockets?.clients ?? []) socket.close(1001, "Application shutting down");
      for (const socket of channelSockets?.clients ?? []) socket.close(1001, "Application shutting down");
      server?.closeIdleConnections();
      const forceClose = setTimeout(() => {
        for (const socket of sockets?.clients ?? []) socket.terminate();
        for (const socket of channelSockets?.clients ?? []) socket.terminate();
        server?.closeAllConnections();
      }, 250);
      forceClose.unref();
      const outcomes = await Promise.allSettled([
        new Promise<void>((resolve, reject) =>
          sockets ? sockets.close((error) => (error ? reject(error) : resolve())) : resolve(),
        ),
        new Promise<void>((resolve, reject) =>
          channelSockets ? channelSockets.close((error) => (error ? reject(error) : resolve())) : resolve(),
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
    if (this.options.developmentFrontend?.canHandle(url.pathname)) {
      const authorization = this.accessGuard.authorizeWebSocket(request);
      if (!authorization.ok) {
        this.rejectUpgrade(socket, authorization.failure);
        return;
      }
      await this.options.developmentFrontend.upgrade(request, socket, head);
      return;
    }
    const channelRoute = readAgentOneBot11ClientRoute(url.pathname);
    if (
      url.pathname !== "/" &&
      url.pathname !== AgentControlWebSocketPath &&
      channelRoute?.resource !== AgentOneBot11ClientSocketPath
    ) {
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
        channelRoute?.workspaceId ??
          url.searchParams.get(AgentWorkspaceScopeParameter) ??
          this.options.defaultWorkspaceId,
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
    const server = channelRoute ? this.channelSockets! : this.sockets!;
    server.handleUpgrade(request, socket, head, (webSocket) => {
      if (!channelRoute) endpoint.connect(webSocket, result.access);
      else if (endpoint.connectChannelClient) endpoint.connectChannelClient(webSocket, result.access, request);
      else webSocket.close(1008, "Channel client is unavailable");
    });
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
    const developmentUrl = new URL(request.url ?? "/", "http://senera.local");
    if (this.options.developmentFrontend?.canHandle(developmentUrl.pathname)) {
      const authorization = this.accessGuard.authorizeStaticResource(request);
      if (!authorization.ok) {
        response.writeHead(authorization.failure.status, { "Cache-Control": "no-store" });
        response.end();
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end();
        return;
      }
      await this.options.developmentFrontend.handle(request, response);
      return;
    }
    if (this.staticApi?.canHandle(request)) {
      this.staticApi.handle(request, response);
      return;
    }
    const url = new URL(request.url ?? "/", "http://senera.local");
    if (url.pathname === AgentWorkspaceCatalogRoute && this.options.catalog) {
      if (
        !applyCredentialedCors(request, response, {
          allowedMethods: ["GET", "DELETE", "OPTIONS"],
          allowedHeaders: ["x-senera-csrf"],
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
      const method = request.method ?? "GET";
      const authorization = this.accessGuard.authorizeHttp(request, { requireCsrf: method === "DELETE" });
      if (!authorization.ok) {
        response.writeHead(authorization.failure.status);
        response.end();
        return;
      }
      if (method === "GET") {
        const data = AgentWorkspaceCatalogSnapshotSchema.parse({
          workspaces: this.options.catalog.list(),
          defaultWorkspaceId: this.options.defaultWorkspaceId,
        });
        response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify(data));
        return;
      }
      if (method !== "DELETE") {
        response.writeHead(405, { Allow: "GET, DELETE" });
        response.end();
        return;
      }
      if (!this.options.forgetWorkspace) {
        response.writeHead(405, { Allow: "GET" });
        response.end();
        return;
      }
      const workspaceId = url.searchParams.get("workspaceId");
      const parsedWorkspaceId = workspaceId ? AgentWorkspaceIdSchema.safeParse(workspaceId) : undefined;
      if (!parsedWorkspaceId?.success) {
        response.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(
          JSON.stringify({
            ok: false,
            error: { code: "workspace_id_invalid", message: "A valid workspaceId is required." },
          }),
        );
        return;
      }
      const data = await this.options.forgetWorkspace(parsedWorkspaceId.data);
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(AgentWorkspaceCatalogSnapshotSchema.parse(data)));
      return;
    }
    if (url.pathname === AgentApplicationHttpRoutes.StorageMigrations) {
      if (
        !applyCredentialedCors(request, response, {
          allowedMethods: ["GET", "DELETE", "OPTIONS"],
          allowedHeaders: ["x-senera-csrf"],
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
      const authorization = this.accessGuard.authorizeHttp(request, { requireCsrf: request.method === "DELETE" });
      if (!authorization.ok) {
        response.writeHead(authorization.failure.status);
        response.end();
        return;
      }
      if (!this.options.catalog) {
        response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ ok: false, error: { code: "workspace_catalog_unavailable" } }));
        return;
      }
      if (request.method !== "GET" && request.method !== "DELETE") {
        response.writeHead(405, { Allow: "GET, DELETE" });
        response.end();
        return;
      }
      const workspaceId = url.searchParams.get("workspaceId");
      const parsedWorkspaceId = workspaceId ? AgentWorkspaceIdSchema.safeParse(workspaceId) : undefined;
      if (workspaceId && !parsedWorkspaceId?.success) {
        response.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ ok: false, error: { code: "workspace_id_invalid" } }));
        return;
      }
      const paths = resolveAgentApplicationPaths(this.options.applicationRoot);
      if (request.method === "DELETE") {
        if (!parsedWorkspaceId?.success || !url.searchParams.get("backupId")) {
          response.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          response.end(JSON.stringify({ ok: false, error: { code: "migration_backup_target_required" } }));
          return;
        }
        const workspace = this.options.catalog.get(parsedWorkspaceId.data);
        await removeAgentWorkspaceStateMigrationBackup({
          stateRoot: paths.workspaceLayout(workspace.root, workspace.id).stateRoot,
          backupId: url.searchParams.get("backupId")!,
        });
      }
      const workspaces = parsedWorkspaceId?.success
        ? [this.options.catalog.get(parsedWorkspaceId.data)]
        : this.options.catalog.list();
      const data = {
        workspaces: await Promise.all(
          workspaces.map(async (workspace) => ({
            id: workspace.id,
            name: workspace.name,
            root: workspace.root,
            inventory: await readAgentWorkspaceStateMigrationInventory(
              paths.workspaceLayout(workspace.root, workspace.id).stateRoot,
            ),
          })),
        ),
      };
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
      const requestedScope = url.searchParams.get("scope") ?? AgentApplicationStorageScopes.Runtime;
      const knownScopes = new Set(Object.values(AgentApplicationStorageScopes));
      if (!knownScopes.has(requestedScope as AgentApplicationStorageScope)) {
        response.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ ok: false, error: { code: "storage_scope_invalid" } }));
        return;
      }
      const projectWorkspaceId =
        requestedScope === AgentApplicationStorageScopes.Project ? url.searchParams.get("workspaceId") : undefined;
      if (projectWorkspaceId) {
        const parsedWorkspaceId = AgentWorkspaceIdSchema.safeParse(projectWorkspaceId);
        if (!parsedWorkspaceId.success) {
          response.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          response.end(JSON.stringify({ ok: false, error: { code: "storage_workspace_id_invalid" } }));
          return;
        }
        this.options.catalog?.get(parsedWorkspaceId.data);
      }
      const data = await readAgentApplicationStorage(
        resolveAgentApplicationPaths(this.options.applicationRoot),
        this.options.catalog,
        {
          includeProject: requestedScope === AgentApplicationStorageScopes.Project,
          ...(projectWorkspaceId ? { projectWorkspaceId } : {}),
        },
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
    const channelRoute = readAgentOneBot11ClientRoute(url.pathname);
    const workspaceId =
      channelRoute?.workspaceId ??
      url.searchParams.get(AgentWorkspaceScopeParameter) ??
      this.options.defaultWorkspaceId;
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
