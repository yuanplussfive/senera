import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { projectAgentMessage } from "../I18n/AgentMessageProjection.js";
import { readStreamJsonBody } from "../Core/AgentJsonParsing.js";
import { applyCredentialedCors, writeCorsPreflight } from "./AgentCredentialedCors.js";
import { AgentServerAccessGuard, type AgentAccessFailure } from "./AgentServerAccessGuard.js";
import { AgentDeviceAuthenticationHttpApi } from "./AgentDeviceAuthenticationHttpApi.js";
import type { AgentDeviceConnectionService } from "./AgentDeviceConnectionService.js";
import {
  AgentAuthenticationHttpRoutes,
  AgentAuthenticationSessionStates,
  projectAgentAuthenticationSession,
  type AgentAuthenticationSessionResponse,
} from "./AgentAuthenticationProtocol.js";

export { AgentAuthenticationHttpRoutes } from "./AgentAuthenticationProtocol.js";

const LoginRequestSchema = z
  .object({
    loginName: z.string().min(1).max(64),
    password: z.string().min(1).max(1024),
  })
  .strict();

export class AgentAuthenticationHttpApi {
  private readonly deviceApi: AgentDeviceAuthenticationHttpApi;

  constructor(
    private readonly access: AgentServerAccessGuard,
    connections?: AgentDeviceConnectionService,
  ) {
    this.deviceApi = new AgentDeviceAuthenticationHttpApi(access, connections);
  }

  canHandle(request: IncomingMessage): boolean {
    return (
      this.deviceApi.canHandle(this.pathname(request)) ||
      Object.values(AgentAuthenticationHttpRoutes).includes(
        this.pathname(request) as (typeof AgentAuthenticationHttpRoutes)[keyof typeof AgentAuthenticationHttpRoutes],
      )
    );
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (
      !applyCredentialedCors(request, response, {
        allowedMethods: ["GET", "POST", "DELETE", "OPTIONS"],
        isOriginAllowed: (origin, corsRequest) => this.access.allowsOrigin(origin, corsRequest),
      })
    ) {
      this.writeFailure(response, { status: 403, code: "forbidden_origin" });
      return;
    }
    if (request.method === "OPTIONS") {
      writeCorsPreflight(response);
      return;
    }

    const pathname = this.pathname(request);
    if (this.deviceApi.canHandle(pathname)) {
      await this.deviceApi.handle(request, response);
      return;
    }
    if (pathname === AgentAuthenticationHttpRoutes.Session && (request.method === "GET" || request.method === "POST")) {
      this.handleSession(request, response);
      return;
    }
    if (pathname === AgentAuthenticationHttpRoutes.Login && request.method === "POST") {
      await this.handleLogin(request, response);
      return;
    }
    if (pathname === AgentAuthenticationHttpRoutes.Logout && request.method === "POST") {
      this.handleLogout(request, response);
      return;
    }
    this.writeJson(response, 405, {
      ok: false,
      error: { code: "method_not_allowed", ...projectAgentMessage("auth.methodNotAllowed") },
    });
  }

  private handleSession(request: IncomingMessage, response: ServerResponse): void {
    const result = this.access.authorizeHttp(request, { requireCsrf: false });
    if (!result.ok) {
      if (result.failure.code === "authentication_required") {
        this.writeJson(response, 200, {
          ok: true,
          session: { state: AgentAuthenticationSessionStates.Anonymous },
        } satisfies AgentAuthenticationSessionResponse);
        return;
      }
      this.writeFailure(response, result.failure);
      return;
    }
    let session = result.access.session;
    if (!session && request.method === "POST") {
      const local = this.access.initializeLocalOwnerSession(request);
      if (!local) throw new Error("Local access did not permit session initialization.");
      if (local.created) response.setHeader("Set-Cookie", this.access.issueCookie(local.token, request));
      session = local.session;
    }
    this.writeJson(response, 200, {
      ok: true,
      session: session
        ? projectAgentAuthenticationSession(session)
        : { state: AgentAuthenticationSessionStates.Disabled },
    } satisfies AgentAuthenticationSessionResponse);
  }

  private async handleLogin(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body: unknown;
    try {
      body = await readStreamJsonBody(request, {
        maximumBytes: 8 * 1024,
        contextLabel: "Authentication request body",
        onTooLarge: () => new AgentLocalizedError("auth.requestTooLarge"),
      });
    } catch {
      this.writeJson(response, 400, {
        ok: false,
        error: { code: "invalid_request", ...projectAgentMessage("auth.invalidRequest") },
      });
      return;
    }
    const parsed = LoginRequestSchema.safeParse(body);
    if (!parsed.success) {
      this.writeJson(response, 400, {
        ok: false,
        error: { code: "invalid_request", ...projectAgentMessage("auth.invalidRequest") },
      });
      return;
    }

    const result = await this.access.login(request, parsed.data);
    if (!result.ok) {
      this.writeFailure(response, result.failure);
      return;
    }
    response.setHeader("Set-Cookie", this.access.issueCookie(result.token, request));
    this.writeJson(response, 200, {
      ok: true,
      session: projectAgentAuthenticationSession(result.session),
    } satisfies AgentAuthenticationSessionResponse);
  }

  private handleLogout(request: IncomingMessage, response: ServerResponse): void {
    const result = this.access.authorizeHttp(request, { requireCsrf: true });
    if (!result.ok) {
      this.writeFailure(response, result.failure);
      return;
    }
    this.access.revoke(result.access.sessionToken);
    response.setHeader("Set-Cookie", this.access.clearCookie(request));
    this.writeJson(response, 200, { ok: true });
  }

  private writeFailure(response: ServerResponse, failure: AgentAccessFailure): void {
    if (failure.retryAfterSeconds) {
      response.setHeader("Retry-After", String(failure.retryAfterSeconds));
    }
    if (failure.status === 401) {
      response.setHeader("WWW-Authenticate", 'Session realm="senera"');
    }
    const message = projectAgentMessage(failure.status === 401 ? "auth.loginRejected" : "auth.requestDenied");
    this.writeJson(response, failure.status, { ok: false, error: { code: failure.code, ...message } });
  }

  private writeJson(response: ServerResponse, status: number, payload: unknown): void {
    response.writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(payload));
  }

  private pathname(request: IncomingMessage): string {
    return new URL(request.url ?? "/", "http://senera.local").pathname;
  }
}
