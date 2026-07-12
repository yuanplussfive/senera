import { randomBytes } from "node:crypto";
import type http from "node:http";
import path from "node:path";
import { type WebSocket } from "ws";
import type { ResolvedAgentServerConfig } from "../Types/AgentConfigTypes.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { AgentAdminSessionStore, type AgentAdminSession, type AgentServerPrincipal } from "./AgentAdminSessionStore.js";
import { AgentLocalAdminAccountStore, type AgentLocalAdminAccount } from "./AgentLocalAdminAccount.js";
import { AgentTokenBucket } from "./AgentTokenBucket.js";

const MinuteMs = 60_000;
const DefaultLocalPrincipal: AgentServerPrincipal = {
  id: "local-runtime",
  loginName: "local",
  displayName: "Local runtime",
  role: "owner",
};

export interface AgentAccessFailure {
  readonly status: 401 | 403 | 429 | 503;
  readonly code:
    "authentication_required" | "forbidden_origin" | "csrf_required" | "rate_limited" | "capacity_exceeded";
  readonly retryAfterSeconds?: number;
}

export interface AgentAuthenticatedAccess {
  readonly principal: AgentServerPrincipal;
  readonly session?: AgentAdminSession;
  readonly sessionToken?: string;
  readonly clientAddress: string;
}

export type AgentAccessResult =
  | {
      readonly ok: true;
      readonly access: AgentAuthenticatedAccess;
    }
  | {
      readonly ok: false;
      readonly failure: AgentAccessFailure;
    };

interface ManagedConnection extends AgentAuthenticatedAccess {
  readonly id: string;
  readonly socket: WebSocket;
  lastPongAt: number;
}

export class AgentServerAccessGuard {
  private readonly accountStore: AgentLocalAdminAccountStore;
  private readonly sessions: AgentAdminSessionStore;
  private readonly loginAttempts: AgentTokenBucket;
  private readonly httpRequests: AgentTokenBucket;
  private readonly upgradeAttempts: AgentTokenBucket;
  private readonly messages: AgentTokenBucket;
  private readonly connections = new Map<WebSocket, ManagedConnection>();
  private readonly connectionsByClient = new Map<string, Set<WebSocket>>();
  private readonly required: boolean;

  constructor(
    private readonly options: {
      server: ResolvedAgentServerConfig;
      workspaceRoot: string;
      now?: () => number;
    },
  ) {
    this.required = resolveAuthenticationRequired(options.server);
    this.accountStore = new AgentLocalAdminAccountStore(resolveAccountPath(options.workspaceRoot, options.server));
    this.sessions = new AgentAdminSessionStore({
      absoluteTtlMs: options.server.AccessControl.Session.AbsoluteTtlHours * 60 * MinuteMs,
      idleTtlMs: options.server.AccessControl.Session.IdleTtlHours * 60 * MinuteMs,
      maxSessions: options.server.AccessControl.Session.MaxSessions,
      now: options.now,
    });
    this.loginAttempts = createRateLimiter(options.server.AccessControl.Limits.LoginAttemptsPerMinute, options.now);
    this.httpRequests = createRateLimiter(options.server.AccessControl.Limits.HttpRequestsPerMinute, options.now);
    this.upgradeAttempts = createRateLimiter(options.server.AccessControl.Limits.UpgradeRequestsPerMinute, options.now);
    this.messages = createRateLimiter(options.server.AccessControl.Limits.MessagesPerMinute, options.now);

    this.assertConfiguration();
  }

  get isAuthenticationRequired(): boolean {
    return this.required;
  }

  get cookieName(): string {
    return this.usesSecureCookie ? "__Host-senera_session" : "senera_local_session";
  }

  get sessionMaxAgeSeconds(): number {
    return this.options.server.AccessControl.Session.AbsoluteTtlHours * 60 * 60;
  }

  get heartbeatIntervalMs(): number {
    return this.options.server.AccessControl.Limits.HeartbeatIntervalSeconds * 1000;
  }

  get idleSocketTimeoutMs(): number {
    return this.options.server.AccessControl.Limits.IdleSocketTimeoutSeconds * 1000;
  }

  account(): AgentLocalAdminAccount | undefined {
    return this.required ? this.accountStore.require() : undefined;
  }

  allowsOrigin(origin: string | undefined): boolean {
    if (!origin) {
      return false;
    }
    try {
      const normalized = new URL(origin).origin;
      return (
        this.options.server.AccessControl.AllowedOrigins.includes(normalized) ||
        (isLoopbackHost(this.options.server.Host) && isLoopbackOrigin(normalized))
      );
    } catch {
      return false;
    }
  }

  async login(
    request: http.IncomingMessage,
    credentials: { loginName: string; password: string },
  ): Promise<
    | {
        readonly ok: true;
        readonly token: string;
        readonly session: AgentAdminSession;
      }
    | {
        readonly ok: false;
        readonly failure: AgentAccessFailure;
      }
  > {
    if (!this.required) {
      return { ok: false, failure: { status: 403, code: "authentication_required" } };
    }
    if (
      (!isLoopbackHost(this.options.server.Host) && !this.isSecureRequest(request)) ||
      !this.isAllowedBrowserOrigin(request)
    ) {
      return { ok: false, failure: { status: 403, code: "forbidden_origin" } };
    }

    const rate = this.loginAttempts.consume(this.clientAddress(request));
    if (!rate.allowed) {
      return {
        ok: false,
        failure: { status: 429, code: "rate_limited", retryAfterSeconds: rate.retryAfterSeconds },
      };
    }

    const account = await this.accountStore.verify(credentials.loginName, credentials.password);
    if (!account) {
      return { ok: false, failure: { status: 401, code: "authentication_required" } };
    }
    return { ok: true, ...this.sessions.issue(account) };
  }

  authorizeHttp(request: http.IncomingMessage, options: { requireCsrf: boolean }): AgentAccessResult {
    const clientAddress = this.clientAddress(request);
    const rate = this.httpRequests.consume(clientAddress);
    if (!rate.allowed) {
      return {
        ok: false,
        failure: { status: 429, code: "rate_limited", retryAfterSeconds: rate.retryAfterSeconds },
      };
    }
    if (!this.required) {
      return { ok: true, access: { principal: DefaultLocalPrincipal, clientAddress } };
    }

    const sessionToken = readCookie(request, this.cookieName);
    const session = this.sessions.read(sessionToken, true);
    if (!session) {
      return { ok: false, failure: { status: 401, code: "authentication_required" } };
    }
    if (options.requireCsrf) {
      if (!this.isAllowedBrowserOrigin(request)) {
        return { ok: false, failure: { status: 403, code: "forbidden_origin" } };
      }
      if (!this.sessions.verifyCsrf(session, readHeader(request, "x-senera-csrf"))) {
        return { ok: false, failure: { status: 403, code: "csrf_required" } };
      }
    }
    return {
      ok: true,
      access: {
        principal: session.principal,
        session,
        sessionToken,
        clientAddress,
      },
    };
  }

  authorizeWebSocket(request: http.IncomingMessage): AgentAccessResult {
    const clientAddress = this.clientAddress(request);
    const rate = this.upgradeAttempts.consume(clientAddress);
    if (!rate.allowed) {
      return {
        ok: false,
        failure: { status: 429, code: "rate_limited", retryAfterSeconds: rate.retryAfterSeconds },
      };
    }
    if (this.connections.size >= this.options.server.AccessControl.Limits.MaxConnections) {
      return { ok: false, failure: { status: 503, code: "capacity_exceeded" } };
    }
    if (
      (this.connectionsByClient.get(clientAddress)?.size ?? 0) >=
      this.options.server.AccessControl.Limits.MaxConnectionsPerClient
    ) {
      return { ok: false, failure: { status: 503, code: "capacity_exceeded" } };
    }
    if (!this.required) {
      return { ok: true, access: { principal: DefaultLocalPrincipal, clientAddress } };
    }
    if (!this.isAllowedBrowserOrigin(request)) {
      return { ok: false, failure: { status: 403, code: "forbidden_origin" } };
    }
    const sessionToken = readCookie(request, this.cookieName);
    const session = this.sessions.read(sessionToken, true);
    if (!session) {
      return { ok: false, failure: { status: 401, code: "authentication_required" } };
    }
    return {
      ok: true,
      access: {
        principal: session.principal,
        session,
        sessionToken,
        clientAddress,
      },
    };
  }

  registerConnection(socket: WebSocket, access: AgentAuthenticatedAccess): void {
    const connection: ManagedConnection = {
      ...access,
      id: randomConnectionId(),
      socket,
      lastPongAt: this.now(),
    };
    this.connections.set(socket, connection);
    const clientConnections = this.connectionsByClient.get(access.clientAddress) ?? new Set<WebSocket>();
    clientConnections.add(socket);
    this.connectionsByClient.set(access.clientAddress, clientConnections);
  }

  unregisterConnection(socket: WebSocket): void {
    const connection = this.connections.get(socket);
    if (!connection) {
      return;
    }
    this.connections.delete(socket);
    const clientConnections = this.connectionsByClient.get(connection.clientAddress);
    clientConnections?.delete(socket);
    if (clientConnections?.size === 0) {
      this.connectionsByClient.delete(connection.clientAddress);
    }
  }

  recordPong(socket: WebSocket): void {
    const connection = this.connections.get(socket);
    if (connection) {
      connection.lastPongAt = this.now();
    }
  }

  authorizeMessage(socket: WebSocket): AgentAccessResult {
    const connection = this.connections.get(socket);
    if (!connection) {
      return { ok: false, failure: { status: 401, code: "authentication_required" } };
    }
    const rate = this.messages.consume(connection.id);
    if (!rate.allowed) {
      return {
        ok: false,
        failure: { status: 429, code: "rate_limited", retryAfterSeconds: rate.retryAfterSeconds },
      };
    }
    if (this.required) {
      const session = this.sessions.read(connection.sessionToken, true);
      if (!session) {
        return { ok: false, failure: { status: 401, code: "authentication_required" } };
      }
      return {
        ok: true,
        access: {
          ...connection,
          session,
          principal: session.principal,
        },
      };
    }
    return { ok: true, access: connection };
  }

  shouldTerminateConnection(socket: WebSocket): boolean {
    const connection = this.connections.get(socket);
    if (!connection) {
      return true;
    }
    if (this.now() - connection.lastPongAt > this.idleSocketTimeoutMs) {
      return true;
    }
    return this.required && !this.sessions.read(connection.sessionToken, false);
  }

  issueCookie(token: string): string {
    const attributes = [
      `${this.cookieName}=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${this.sessionMaxAgeSeconds}`,
    ];
    if (this.usesSecureCookie) {
      attributes.push("Secure");
    }
    return attributes.join("; ");
  }

  clearCookie(): string {
    const attributes = [`${this.cookieName}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
    if (this.usesSecureCookie) {
      attributes.push("Secure");
    }
    return attributes.join("; ");
  }

  revoke(sessionToken: string | undefined): void {
    this.sessions.revoke(sessionToken);
  }

  private assertConfiguration(): void {
    const externalHost = !isLoopbackHost(this.options.server.Host);
    if (this.options.server.AccessControl.Mode === "disabled" && externalHost) {
      throw new Error(agentErrorMessage("auth.publicAccessControlRequired"));
    }
    if (!this.required) {
      return;
    }
    if (externalHost && this.options.server.AccessControl.AllowedOrigins.length === 0) {
      throw new Error(agentErrorMessage("auth.allowedOriginsRequired"));
    }
    this.accountStore.require();
  }

  private isAllowedBrowserOrigin(request: http.IncomingMessage): boolean {
    return this.allowsOrigin(readHeader(request, "origin"));
  }

  private isSecureRequest(request: http.IncomingMessage): boolean {
    if ((request.socket as { encrypted?: boolean }).encrypted === true) {
      return true;
    }
    const forwarded = readHeader(request, "x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    return (
      (forwarded === "https" &&
        this.options.server.AccessControl.TrustedProxyAddresses.includes(this.clientAddress(request))) ||
      this.allowsInsecureLoopback(request)
    );
  }

  private get usesSecureCookie(): boolean {
    return !isLoopbackHost(this.options.server.Host) && !this.options.server.AccessControl.AllowInsecureLoopback;
  }

  private allowsInsecureLoopback(request: http.IncomingMessage): boolean {
    return (
      this.options.server.AccessControl.AllowInsecureLoopback && isLoopbackOrigin(readHeader(request, "origin") ?? "")
    );
  }

  private clientAddress(request: http.IncomingMessage): string {
    return normalizeAddress(request.socket.remoteAddress ?? "unknown");
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

export function resolveAuthenticationRequired(server: ResolvedAgentServerConfig): boolean {
  if (server.AccessControl.Mode === "required") {
    return true;
  }
  if (server.AccessControl.Mode === "disabled") {
    return false;
  }
  return !isLoopbackHost(server.Host);
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function resolveAccountPath(workspaceRoot: string, server: ResolvedAgentServerConfig): string {
  const configured = server.AccessControl.AccountFile;
  return path.isAbsolute(configured) ? path.normalize(configured) : path.resolve(workspaceRoot, configured);
}

function createRateLimiter(capacity: number, now: (() => number) | undefined): AgentTokenBucket {
  return new AgentTokenBucket({
    capacity,
    refillPeriodMs: MinuteMs,
    maxEntries: 4_096,
    now,
  });
}

function readCookie(request: http.IncomingMessage, name: string): string | undefined {
  const cookie = readHeader(request, "cookie");
  if (!cookie) {
    return undefined;
  }
  for (const part of cookie.split(";")) {
    const [candidateName, ...valueParts] = part.trim().split("=");
    if (candidateName !== name) {
      continue;
    }
    try {
      return decodeURIComponent(valueParts.join("="));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function readHeader(request: http.IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function normalizeAddress(value: string): string {
  return value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function randomConnectionId(): string {
  return randomBytes(18).toString("base64url");
}
