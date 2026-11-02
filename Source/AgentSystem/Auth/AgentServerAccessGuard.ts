import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import type http from "node:http";
import { type WebSocket } from "ws";
import type { ResolvedAgentServerConfig } from "../Types/AgentConfigTypes.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { AgentAdminSessionStore, type AgentAdminSession, type AgentServerPrincipal } from "./AgentAdminSessionStore.js";
import {
  AgentLocalAdminAccountStore,
  resolveAgentLocalAdminAccountPath,
  type AgentLocalAdminAccount,
} from "./AgentLocalAdminAccount.js";
import { AgentTokenBucket } from "./AgentTokenBucket.js";
import {
  AgentWebSocketCloseCodes,
  AgentWebSocketCloseReasons,
  type AgentWebSocketCloseCode,
} from "../WebSocket/AgentWebSocketCloseContract.js";
import {
  AgentDeviceCookieName,
  AgentLanDeviceCookieName,
  AgentMobileOrigin,
} from "./AgentDeviceAuthenticationContract.js";

import {
  isLoopbackHost,
  resolveAgentServerAccessPolicy,
  type AgentServerAccessPolicy,
  type AgentServerAccessProfile,
} from "./AgentServerAccessPolicy.js";

export { isLoopbackHost } from "./AgentServerAccessPolicy.js";
import { AgentAuthenticationMethods } from "./AgentAuthenticationProtocol.js";

const MinuteMs = 60_000;
const SecureSessionCookieName = "__Host-senera_session";
const InsecureSessionCookieName = "senera_local_session";
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
  readonly deviceLanOrigin?: string;
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
  private readonly policy: AgentServerAccessPolicy;
  private readonly server: ResolvedAgentServerConfig;
  private readonly deviceProxyOrigins = new Set<string>();
  private readonly deviceLanOrigins = new Set<string>();

  constructor(
    private readonly options: {
      server: ResolvedAgentServerConfig;
      workspaceRoot: string;
      now?: () => number;
      accessProfile?: AgentServerAccessProfile;
    },
  ) {
    this.policy = resolveAgentServerAccessPolicy(options.server, options.accessProfile);
    this.server = this.policy.server;
    this.accountStore = new AgentLocalAdminAccountStore(
      resolveAgentLocalAdminAccountPath(options.workspaceRoot, options.server.AccessControl.AccountFile),
    );
    this.sessions = new AgentAdminSessionStore({
      absoluteTtlMs: options.server.AccessControl.Session.AbsoluteTtlHours * 60 * MinuteMs,
      idleTtlMs: options.server.AccessControl.Session.IdleTtlHours * 60 * MinuteMs,
      maxSessions: options.server.AccessControl.Session.MaxSessions,
      now: options.now,
    });
    const maxRateLimitClients = options.server.AccessControl.Limits.MaxRateLimitClients;
    this.loginAttempts = createRateLimiter(
      options.server.AccessControl.Limits.LoginAttemptsPerMinute,
      maxRateLimitClients,
      options.now,
    );
    this.httpRequests = createRateLimiter(
      options.server.AccessControl.Limits.HttpRequestsPerMinute,
      maxRateLimitClients,
      options.now,
    );
    this.upgradeAttempts = createRateLimiter(
      options.server.AccessControl.Limits.UpgradeRequestsPerMinute,
      maxRateLimitClients,
      options.now,
    );
    this.messages = createRateLimiter(
      options.server.AccessControl.Limits.MessagesPerMinute,
      maxRateLimitClients,
      options.now,
    );

    this.assertConfiguration();
  }

  get isAuthenticationRequired(): boolean {
    return this.policy.authenticationRequired;
  }

  get deviceConnectionOptions(): { root: string; target: string } {
    const host = ["0.0.0.0", "::", "[::]"].includes(this.server.Host) ? "127.0.0.1" : this.server.Host;
    const hostname = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    return { root: this.options.workspaceRoot, target: `http://${hostname}:${this.server.Port}` };
  }

  setDeviceProxyOrigins(origins: readonly string[]): void {
    this.deviceProxyOrigins.clear();
    for (const origin of origins) this.deviceProxyOrigins.add(origin);
  }

  setDeviceLanOrigins(origins: readonly string[]): void {
    this.deviceLanOrigins.clear();
    for (const origin of origins) this.deviceLanOrigins.add(origin);
    for (const connection of this.connections.values()) {
      if (connection.deviceLanOrigin && !this.deviceLanOrigins.has(connection.deviceLanOrigin))
        connection.socket.close(1008, "LAN connection closed");
    }
  }

  private isDeviceLanRequest(request: http.IncomingMessage): boolean {
    const origin = `http://${readHeader(request, "host") ?? ""}`;
    if (!this.deviceLanOrigins.has(origin)) return false;
    const target = new URL(origin);
    return (
      normalizeAddress(request.socket.localAddress ?? "") === target.hostname &&
      request.socket.localPort === Number(target.port || 80)
    );
  }

  deviceRequestOrigin(request: http.IncomingMessage): string | undefined {
    if (!this.isSecureTransport(request)) return undefined;
    try {
      const url = new URL(`https://${readHeader(request, "host") ?? ""}`);
      return isLoopbackHost(url.hostname) ? undefined : url.origin;
    } catch {
      return undefined;
    }
  }

  requiresAuthentication(request: http.IncomingMessage): boolean {
    return this.policy.authenticationRequired || !this.isLocalRequest(request);
  }

  /** A proxy arriving over loopback must never inherit the local console's trust. */
  isLocalRequest(request: http.IncomingMessage): boolean {
    if (!isLoopbackHost(this.clientAddress(request))) return false;
    const origin = readHeader(request, "origin");
    if (origin && !isLoopbackOrigin(origin)) return false;
    if (
      readHeader(request, "forwarded") ||
      readHeader(request, "x-forwarded-for") ||
      readHeader(request, "x-forwarded-host") ||
      readHeader(request, "x-forwarded-proto")
    )
      return false;
    try {
      return isLoopbackHost(new URL(`http://${readHeader(request, "host") ?? ""}`).hostname);
    } catch {
      return false;
    }
  }

  initializeLocalOwnerSession(
    request: http.IncomingMessage,
  ): { token: string; session: AgentAdminSession; created: boolean } | undefined {
    if (this.requiresAuthentication(request)) return undefined;
    const token = this.readSessionToken(request);
    const session = this.sessions.read(token, true);
    if (token && session) return { token, session, created: false };
    return {
      ...this.sessions.issue(
        { ...DefaultLocalPrincipal, displayName: hostname() },
        undefined,
        AgentAuthenticationMethods.Local,
      ),
      created: true,
    };
  }

  get cookieName(): string {
    return this.usesSecureCookie ? SecureSessionCookieName : InsecureSessionCookieName;
  }

  get sessionMaxAgeSeconds(): number {
    return this.server.AccessControl.Session.AbsoluteTtlHours * 60 * 60;
  }

  get heartbeatIntervalMs(): number {
    return this.server.AccessControl.Limits.HeartbeatIntervalSeconds * 1000;
  }

  get idleSocketTimeoutMs(): number {
    return this.server.AccessControl.Limits.IdleSocketTimeoutSeconds * 1000;
  }

  account(): AgentLocalAdminAccount | undefined {
    return this.policy.authenticationRequired ? this.accountStore.require() : undefined;
  }

  allowsOrigin(origin: string | undefined, request?: http.IncomingMessage): boolean {
    if (!origin) {
      return false;
    }
    try {
      const parsedOrigin = new URL(origin);
      if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") return false;
      const normalized = parsedOrigin.origin;
      if (request && this.isDeviceLanRequest(request) && this.isSameOrigin(request, normalized)) return true;
      if (normalized === AgentMobileOrigin && request && this.isSecureTransport(request)) return true;
      if (this.deviceProxyOrigins.has(normalized)) return true;
      if (this.server.AccessControl.AllowedOrigins.includes(normalized)) return true;
      // Development and container entrypoints may serve the UI from a separate
      // loopback port. Keep the exception scoped to loopback origins rather
      // than allowing arbitrary cross-origin browser requests.
      if (this.policy.allowLoopbackHttp === true && isLoopbackOrigin(normalized)) {
        return true;
      }
      if (this.server.AccessControl.AllowedOrigins.length > 0) {
        return isLoopbackHost(this.server.Host) && isLoopbackOrigin(normalized);
      }
      if (request) return this.isSameOrigin(request, normalized);
      return isLoopbackHost(this.server.Host) && isLoopbackOrigin(normalized);
    } catch {
      return false;
    }
  }

  async login(
    request: http.IncomingMessage,
    credentials: { loginName: string; password: string },
    deviceName?: string,
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
    if (!this.policy.authenticationRequired) {
      return { ok: false, failure: { status: 403, code: "authentication_required" } };
    }
    if (
      (!isLoopbackHost(this.server.Host) && !this.isSecureRequest(request)) ||
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
    if (deviceName && !this.allowsDeviceAuthentication(request)) {
      return { ok: false, failure: { status: 403, code: "forbidden_origin" } };
    }
    return {
      ok: true,
      ...this.sessions.issue(
        account,
        deviceName,
        deviceName ? AgentAuthenticationMethods.Device : AgentAuthenticationMethods.Account,
      ),
    };
  }

  allowsDeviceAuthentication(request: http.IncomingMessage): boolean {
    return (
      (this.isSecureTransport(request) || this.isDeviceLanRequest(request)) && this.isAllowedBrowserOrigin(request)
    );
  }

  authorizeDeviceExchange(request: http.IncomingMessage): AgentAccessFailure | undefined {
    if (!this.allowsDeviceAuthentication(request)) return { status: 403, code: "forbidden_origin" };
    const rate = this.httpRequests.consume(this.clientAddress(request));
    return rate.allowed ? undefined : { status: 429, code: "rate_limited", retryAfterSeconds: rate.retryAfterSeconds };
  }

  get maximumDevicePairings(): number {
    return this.server.AccessControl.Session.MaxSessions;
  }

  hasSession(id: string): boolean {
    return this.sessions.hasSession(id);
  }

  issueDeviceSession(
    deviceName: string,
    ownerSessionId: string,
  ): { token: string; session: AgentAdminSession } | undefined {
    const owner = this.sessions.findById(ownerSessionId);
    return owner ? this.sessions.issue(owner.principal, deviceName, AgentAuthenticationMethods.Device) : undefined;
  }

  listDevices(principalId: string): AgentAdminSession[] {
    return this.sessions.listDevices(principalId);
  }

  revokeDevice(id: string, principalId: string): boolean {
    return this.sessions.revokeDevice(id, principalId);
  }

  issueDeviceCookie(token: string, request?: http.IncomingMessage): string {
    if (request && this.isDeviceLanRequest(request) && !this.isSecureTransport(request))
      return `${AgentLanDeviceCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${this.sessionMaxAgeSeconds}`;
    return `${AgentDeviceCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${this.sessionMaxAgeSeconds}`;
  }

  authorizeHttp(
    request: http.IncomingMessage,
    options: { requireCsrf: boolean; requireSession?: boolean },
  ): AgentAccessResult {
    const clientAddress = this.clientAddress(request);
    const rate = this.httpRequests.consume(clientAddress);
    if (!rate.allowed) {
      return {
        ok: false,
        failure: { status: 429, code: "rate_limited", retryAfterSeconds: rate.retryAfterSeconds },
      };
    }
    return this.authorizeRequestIdentity(request, options);
  }

  /** Module graphs are static resources, not API operations; each import still requires host authentication. */
  authorizeStaticResource(request: http.IncomingMessage): AgentAccessResult {
    if (readHeader(request, "origin") && !this.isAllowedBrowserOrigin(request)) {
      return { ok: false, failure: { status: 403, code: "forbidden_origin" } };
    }
    return this.authorizeRequestIdentity(request, { requireCsrf: false });
  }

  authorizeDeviceOwner(request: http.IncomingMessage, options: { requireCsrf: boolean }): AgentAccessResult {
    return this.authorizeHttp(request, { ...options, requireSession: true });
  }

  private authorizeRequestIdentity(
    request: http.IncomingMessage,
    options: { requireCsrf: boolean; requireSession?: boolean },
  ): AgentAccessResult {
    const clientAddress = this.clientAddress(request);
    const sessionToken = this.readSessionToken(request);
    const session = this.sessions.read(sessionToken, true);
    if (!session) {
      if (!options.requireSession && !this.requiresAuthentication(request)) {
        return { ok: true, access: { principal: DefaultLocalPrincipal, clientAddress } };
      }
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
        ...(this.isDeviceLanRequest(request) ? { deviceLanOrigin: `http://${readHeader(request, "host")}` } : {}),
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
    if (this.connections.size >= this.server.AccessControl.Limits.MaxConnections) {
      return { ok: false, failure: { status: 503, code: "capacity_exceeded" } };
    }
    if (
      (this.connectionsByClient.get(clientAddress)?.size ?? 0) >=
      this.server.AccessControl.Limits.MaxConnectionsPerClient
    ) {
      return { ok: false, failure: { status: 503, code: "capacity_exceeded" } };
    }
    if (this.requiresAuthentication(request) && !this.isAllowedBrowserOrigin(request)) {
      return { ok: false, failure: { status: 403, code: "forbidden_origin" } };
    }
    return this.authorizeRequestIdentity(request, { requireCsrf: false });
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
    if (connection.sessionToken) {
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

  connectionFailure(
    socket: WebSocket,
  ): { readonly code: AgentWebSocketCloseCode; readonly reason: string } | undefined {
    const connection = this.connections.get(socket);
    if (!connection || (connection.sessionToken !== undefined && !this.sessions.read(connection.sessionToken, false)))
      return {
        code: AgentWebSocketCloseCodes.AuthenticationRequired,
        reason: AgentWebSocketCloseReasons.AuthenticationRequired,
      };
    if (this.now() - connection.lastPongAt > this.idleSocketTimeoutMs) {
      return { code: AgentWebSocketCloseCodes.HeartbeatTimeout, reason: AgentWebSocketCloseReasons.HeartbeatTimeout };
    }
    return undefined;
  }

  issueCookie(token: string, request?: http.IncomingMessage): string {
    const secure = request ? this.isSecureTransport(request) : this.usesSecureCookie;
    const cookieName = request ? this.cookieNameForRequest(request) : this.cookieName;
    const attributes = [
      `${cookieName}=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${this.sessionMaxAgeSeconds}`,
    ];
    if (secure) {
      attributes.push("Secure");
    }
    return attributes.join("; ");
  }

  clearCookie(request?: http.IncomingMessage): string {
    const secure = request ? this.isSecureTransport(request) : this.usesSecureCookie;
    const isLanDevice =
      request && this.isDeviceLanRequest(request) && readCookie(request, AgentLanDeviceCookieName) !== undefined;
    const isDevice = request && readCookie(request, AgentDeviceCookieName) !== undefined;
    const cookieName = isDevice
      ? AgentDeviceCookieName
      : isLanDevice
        ? AgentLanDeviceCookieName
        : request
          ? this.cookieNameForRequest(request)
          : this.cookieName;
    const attributes = [
      `${cookieName}=`,
      "Path=/",
      "HttpOnly",
      isDevice ? "SameSite=None" : "SameSite=Strict",
      "Max-Age=0",
    ];
    if (secure) {
      attributes.push("Secure");
    }
    return attributes.join("; ");
  }

  revoke(sessionToken: string | undefined): void {
    this.sessions.revoke(sessionToken);
  }

  private assertConfiguration(): void {
    const externalHost = !isLoopbackHost(this.server.Host);
    if (this.server.AccessControl.Mode === "disabled" && externalHost) {
      throw new AgentLocalizedError("auth.publicAccessControlRequired");
    }
    if (!this.policy.authenticationRequired) {
      return;
    }
    this.accountStore.require();
  }

  private isAllowedBrowserOrigin(request: http.IncomingMessage): boolean {
    return this.allowsOrigin(readHeader(request, "origin"), request);
  }

  private isSecureRequest(request: http.IncomingMessage): boolean {
    if (this.isSecureTransport(request) || this.isDeviceLanRequest(request)) {
      return true;
    }
    return this.allowsInsecureHttp(request) || this.allowsInsecureLoopback(request);
  }

  private get usesSecureCookie(): boolean {
    return (
      !isLoopbackHost(this.server.Host) &&
      !this.policy.allowLoopbackHttp &&
      !this.server.AccessControl.AllowInsecureLoopback &&
      !this.server.AccessControl.AllowInsecureHttp
    );
  }

  private allowsInsecureHttp(request: http.IncomingMessage): boolean {
    return this.server.AccessControl.AllowInsecureHttp && this.isAllowedBrowserOrigin(request);
  }

  private allowsInsecureLoopback(request: http.IncomingMessage): boolean {
    return (
      isLoopbackOrigin(readHeader(request, "origin") ?? "") &&
      (this.server.AccessControl.AllowInsecureLoopback || this.policy.allowLoopbackHttp === true)
    );
  }

  private isSecureTransport(request: http.IncomingMessage): boolean {
    if ((request.socket as { encrypted?: boolean }).encrypted === true) {
      return true;
    }
    const forwarded = readHeader(request, "x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    let proxyOrigin: string | undefined;
    try {
      proxyOrigin = new URL(`https://${readHeader(request, "host") ?? ""}`).origin;
    } catch {
      return false;
    }
    return (
      forwarded === "https" &&
      (this.server.AccessControl.TrustedProxyAddresses.includes(this.clientAddress(request)) ||
        (isLoopbackHost(this.clientAddress(request)) && this.deviceProxyOrigins.has(proxyOrigin)))
    );
  }

  private cookieNameForRequest(request: http.IncomingMessage): string {
    return this.isSecureTransport(request) ? SecureSessionCookieName : InsecureSessionCookieName;
  }

  private readSessionToken(request: http.IncomingMessage): string | undefined {
    const lanToken = readCookie(request, AgentLanDeviceCookieName);
    if (lanToken && this.isDeviceLanRequest(request)) return lanToken;
    const deviceToken = readCookie(request, AgentDeviceCookieName);
    if (deviceToken && this.isSecureTransport(request)) return deviceToken;
    const preferred = this.cookieNameForRequest(request);
    for (const name of [preferred, SecureSessionCookieName, InsecureSessionCookieName]) {
      const token = readCookie(request, name);
      if (token) return token;
    }
    return undefined;
  }

  private isSameOrigin(request: http.IncomingMessage, origin = readHeader(request, "origin")): boolean {
    if (!origin) return false;
    const host = readHeader(request, "host");
    if (!host) return false;
    try {
      const originUrl = new URL(origin);
      const requestUrl = new URL(`${originUrl.protocol}//${host}`);
      return originUrl.host.toLowerCase() === requestUrl.host.toLowerCase();
    } catch {
      return false;
    }
  }

  private clientAddress(request: http.IncomingMessage): string {
    return normalizeAddress(request.socket.remoteAddress ?? "unknown");
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

function createRateLimiter(capacity: number, maxEntries: number, now: (() => number) | undefined): AgentTokenBucket {
  return new AgentTokenBucket({
    capacity,
    refillPeriodMs: MinuteMs,
    maxEntries,
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
