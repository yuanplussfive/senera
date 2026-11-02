import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { readStreamJsonBody } from "../Core/AgentJsonParsing.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { AgentDeviceAuthenticationRoutes, type AgentDeviceSessionGrant } from "./AgentDeviceAuthenticationContract.js";
import { AgentDevicePairingStore } from "./AgentDevicePairingStore.js";
import { AgentDeviceConnectionService } from "./AgentDeviceConnectionService.js";
import type { AgentAdminSession } from "./AgentAdminSessionStore.js";
import type { AgentServerAccessGuard } from "./AgentServerAccessGuard.js";
import { projectAgentAuthenticationSession } from "./AgentAuthenticationProtocol.js";

const DeviceName = z.string().trim().min(1).max(80);
const Secret = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);
const Login = z
  .object({ loginName: z.string().min(1).max(64), password: z.string().min(1).max(1024), deviceName: DeviceName })
  .strict();
const Claim = z.object({ pairingId: Secret, code: Secret, deviceName: DeviceName, secret: Secret }).strict();
const Exchange = z.object({ pairingId: Secret, secret: Secret }).strict();
const Decision = z.object({ pairingId: Secret, approve: z.boolean() }).strict();
const Revoke = z.object({ deviceId: z.string().min(1).max(128) }).strict();
const ConnectionAddress = z
  .object({
    serverUrl: z.string().max(2048).optional(),
    method: z.enum(["lan", "domain", "private-network"]).optional(),
  })
  .strict()
  .refine((data) => data.serverUrl !== undefined || data.method !== undefined);
const Lan = z
  .object({ host: z.string(), port: z.number().int().min(1).max(65535) })
  .strict()
  .nullable();

export class AgentDeviceAuthenticationHttpApi {
  private readonly pairings: AgentDevicePairingStore;
  private readonly connections: AgentDeviceConnectionService;

  constructor(
    private readonly access: AgentServerAccessGuard,
    connections?: AgentDeviceConnectionService,
  ) {
    this.connections = connections ?? new AgentDeviceConnectionService(access);
    this.pairings = new AgentDevicePairingStore({
      maxPairings: access.maximumDevicePairings,
      isOwnerActive: (id) => access.hasSession(id),
    });
  }

  canHandle(pathname: string): boolean {
    return Object.values(AgentDeviceAuthenticationRoutes).includes(
      pathname as (typeof AgentDeviceAuthenticationRoutes)[keyof typeof AgentDeviceAuthenticationRoutes],
    );
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const pathname = new URL(request.url ?? "/", "http://senera.local").pathname;
    if (pathname === AgentDeviceAuthenticationRoutes.Connection && request.method === "GET") {
      const owner = this.access.authorizeDeviceOwner(request, { requireCsrf: false });
      if (!owner.ok && owner.failure.code !== "authentication_required")
        return reply(response, owner.failure.status, { ok: false, error: { code: owner.failure.code } });
      const authorization = owner.ok ? "authorized" : "login";
      const refresh = new URL(request.url!, "http://senera.local").searchParams.get("refresh") === "true";
      return reply(response, 200, {
        ok: true,
        authorization,
        ...(owner.ok ? { csrfToken: owner.access.session!.csrfToken } : {}),
        ...(await this.connections.snapshot(request, authorization, refresh)),
      });
    }
    const publicExchange = [
      AgentDeviceAuthenticationRoutes.Login,
      AgentDeviceAuthenticationRoutes.Claim,
      AgentDeviceAuthenticationRoutes.Exchange,
    ].some((route) => route === pathname);
    if (publicExchange) {
      const failure = this.access.authorizeDeviceExchange(request);
      if (failure) {
        if (failure.retryAfterSeconds) response.setHeader("Retry-After", failure.retryAfterSeconds);
        return reply(response, failure.status, { ok: false, error: { code: failure.code } });
      }
      if (request.method !== "POST") return reply(response, 405, { ok: false, error: { code: "method_not_allowed" } });
      const body = await readBody(request);
      if (pathname === AgentDeviceAuthenticationRoutes.Login) {
        if (!this.access.isAuthenticationRequired)
          return reply(response, 409, { ok: false, error: { code: "password_login_unavailable" } });
        const parsed = Login.safeParse(body);
        if (!parsed.success) return invalid(response);
        const result = await this.access.login(request, parsed.data, parsed.data.deviceName);
        if (!result.ok)
          return reply(response, result.failure.status, { ok: false, error: { code: result.failure.code } });
        return this.grant(request, response, result);
      }
      if (pathname === AgentDeviceAuthenticationRoutes.Claim) {
        const parsed = Claim.safeParse(body);
        if (!parsed.success) return invalid(response);
        const { pairingId, code, deviceName, secret } = parsed.data;
        if (!this.pairings.claim(pairingId, code, deviceName, secret)) return expired(response);
        return reply(response, 200, { ok: true, state: "pending" });
      }
      const parsed = Exchange.safeParse(body);
      if (!parsed.success) return invalid(response);
      const result = this.pairings.exchange(parsed.data.pairingId, parsed.data.secret);
      if (!result) return expired(response);
      if (result.state === "pending") return reply(response, 200, { ok: true, state: "pending" });
      const issued = this.access.issueDeviceSession(result.deviceName, result.ownerSessionId);
      return issued ? this.grant(request, response, issued) : expired(response);
    }

    const authorization = this.access.authorizeDeviceOwner(request, { requireCsrf: request.method !== "GET" });
    if (!authorization.ok)
      return reply(response, authorization.failure.status, { ok: false, error: { code: authorization.failure.code } });
    const session = authorization.access.session;
    if (!session) return reply(response, 409, { ok: false, error: { code: "account_login_required" } });
    if (pathname === AgentDeviceAuthenticationRoutes.Connection && request.method === "POST") {
      const parsed = ConnectionAddress.safeParse(await readBody(request));
      if (!parsed.success) return invalid(response);
      try {
        if (parsed.data.serverUrl !== undefined) this.connections.saveAddress(parsed.data.serverUrl);
        if (parsed.data.method) this.connections.selectMethod(parsed.data.method);
      } catch {
        return invalid(response);
      }
      return reply(response, 200, {
        ok: true,
        authorization: "authorized",
        csrfToken: session.csrfToken,
        ...(await this.connections.snapshot(request, "authorized")),
      });
    }
    if (pathname === AgentDeviceAuthenticationRoutes.Lan && request.method === "POST") {
      if (!this.access.isLocalRequest(request))
        return reply(response, 403, { ok: false, error: { code: "forbidden_origin" } });
      const parsed = Lan.safeParse(await readBody(request));
      if (!parsed.success) return invalid(response);
      try {
        await this.connections.configureLan(parsed.data);
      } catch (error) {
        return reply(response, 409, {
          ok: false,
          error: { code: error instanceof Error ? error.message : "lan_unavailable" },
        });
      }
      return reply(response, 200, {
        ok: true,
        authorization: "authorized",
        csrfToken: session.csrfToken,
        ...(await this.connections.snapshot(request, "authorized")),
      });
    }
    if (pathname === AgentDeviceAuthenticationRoutes.PrivateNetwork && request.method === "POST") {
      if (!this.access.isLocalRequest(request))
        return reply(response, 403, { ok: false, error: { code: "forbidden_origin" } });
      const privateNetwork = await this.connections.enablePrivateNetwork();
      return reply(response, 200, {
        ok: true,
        authorization: "authorized",
        csrfToken: session.csrfToken,
        ...(await this.connections.snapshot(request, "authorized")),
        privateNetwork,
      });
    }
    if (pathname === AgentDeviceAuthenticationRoutes.Pairings && request.method === "POST") {
      const pairing = this.pairings.create(session.id);
      return pairing
        ? reply(response, 201, { ok: true, ...pairing })
        : reply(response, 429, { ok: false, error: { code: "capacity_exceeded" } });
    }
    if (pathname === AgentDeviceAuthenticationRoutes.Pairings && request.method === "GET") {
      return reply(response, 200, { ok: true, pending: this.pairings.pending(session.id) });
    }
    if (pathname === AgentDeviceAuthenticationRoutes.Approve && request.method === "POST") {
      const parsed = Decision.safeParse(await readBody(request));
      if (!parsed.success) return invalid(response);
      if (!this.pairings.decide(parsed.data.pairingId, session.id, parsed.data.approve)) return expired(response);
      return reply(response, 200, { ok: true });
    }
    if (pathname === AgentDeviceAuthenticationRoutes.Devices && request.method === "GET") {
      const devices = this.access.listDevices(session.principal.id).map((device) => ({
        id: device.id,
        name: device.deviceName,
        createdAt: new Date(device.createdAt).toISOString(),
        lastSeenAt: new Date(device.lastSeenAt).toISOString(),
        expiresAt: new Date(device.expiresAt).toISOString(),
        current: device.id === session.id,
      }));
      return reply(response, 200, { ok: true, devices });
    }
    if (pathname === AgentDeviceAuthenticationRoutes.Devices && request.method === "DELETE") {
      const parsed = Revoke.safeParse(await readBody(request));
      if (!parsed.success) return invalid(response);
      if (!this.access.revokeDevice(parsed.data.deviceId, session.principal.id)) return expired(response);
      return reply(response, 200, { ok: true });
    }
    reply(response, 405, { ok: false, error: { code: "method_not_allowed" } });
  }

  private grant(
    request: IncomingMessage,
    response: ServerResponse,
    issued: { token: string; session: AgentAdminSession },
  ): void {
    const cookie = this.access.issueDeviceCookie(issued.token, request);
    const session = issued.session;
    response.setHeader("Set-Cookie", cookie);
    reply(response, 200, {
      ok: true,
      cookie,
      deviceName: session.deviceName!,
      session: projectAgentAuthenticationSession(session),
    } satisfies AgentDeviceSessionGrant & { ok: true });
  }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  try {
    return await readStreamJsonBody(request, {
      maximumBytes: 8 * 1024,
      contextLabel: "Device authentication",
      onTooLarge: () => new AgentLocalizedError("auth.requestTooLarge"),
    });
  } catch {
    return undefined;
  }
}

function reply(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
  });
  response.end(JSON.stringify(payload));
}

function invalid(response: ServerResponse): void {
  reply(response, 400, { ok: false, error: { code: "invalid_request" } });
}
function expired(response: ServerResponse): void {
  reply(response, 404, { ok: false, error: { code: "pairing_unavailable" } });
}
