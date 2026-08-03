import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { projectAgentMessage } from "../I18n/AgentMessageProjection.js";
import { readStreamJsonBody } from "../Core/AgentJsonParsing.js";
import { applyCredentialedCors, writeCorsPreflight } from "./AgentCredentialedCors.js";
import { AgentServerAccessGuard, type AgentAccessFailure } from "./AgentServerAccessGuard.js";
import {
  AgentAuthenticationHttpRoutes,
  AgentAuthenticationSessionStates,
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
  constructor(private readonly access: AgentServerAccessGuard) {}

  canHandle(request: IncomingMessage): boolean {
    return Object.values(AgentAuthenticationHttpRoutes).includes(
      this.pathname(request) as (typeof AgentAuthenticationHttpRoutes)[keyof typeof AgentAuthenticationHttpRoutes],
    );
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (
      !applyCredentialedCors(request, response, {
        allowedMethods: ["GET", "POST", "OPTIONS"],
        isOriginAllowed: (origin) => this.access.allowsOrigin(origin),
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
    if (pathname === AgentAuthenticationHttpRoutes.Session && request.method === "GET") {
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
    if (!this.access.isAuthenticationRequired) {
      this.writeJson(response, 200, {
        ok: true,
        session: { state: AgentAuthenticationSessionStates.Disabled },
      } satisfies AgentAuthenticationSessionResponse);
      return;
    }

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
    const session = result.access.session;
    if (!session) {
      throw new Error("Authenticated access did not include its server session.");
    }
    this.writeJson(response, 200, {
      ok: true,
      session: {
        state: AgentAuthenticationSessionStates.Authenticated,
        account: result.access.principal,
        csrfToken: session.csrfToken,
        expiresAt: new Date(session.expiresAt).toISOString(),
      },
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
    response.setHeader("Set-Cookie", this.access.issueCookie(result.token));
    this.writeJson(response, 200, {
      ok: true,
      session: {
        state: AgentAuthenticationSessionStates.Authenticated,
        account: result.session.principal,
        csrfToken: result.session.csrfToken,
        expiresAt: new Date(result.session.expiresAt).toISOString(),
      },
    } satisfies AgentAuthenticationSessionResponse);
  }

  private handleLogout(request: IncomingMessage, response: ServerResponse): void {
    const result = this.access.authorizeHttp(request, { requireCsrf: true });
    if (!result.ok) {
      this.writeFailure(response, result.failure);
      return;
    }
    this.access.revoke(result.access.sessionToken);
    response.setHeader("Set-Cookie", this.access.clearCookie());
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
