import type { IncomingMessage, ServerResponse } from "node:http";
import { applyCredentialedCors, writeCorsPreflight } from "../Auth/AgentCredentialedCors.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";

export const AgentProviderCredentialHttpRoute = "/api/provider-credentials";

export interface AgentProviderCredentialHttpApiOptions {
  readonly configSnapshot: () => AgentSystemConfig;
  readonly isOriginAllowed?: (origin: string) => boolean;
}

/**
 * Reveals one provider credential only while the authenticated settings UI is
 * editing that provider. General config snapshots remain redacted, so secrets
 * do not enter the event journal or runtime diagnostics.
 */
export class AgentProviderCredentialHttpApi {
  constructor(private readonly options: AgentProviderCredentialHttpApiOptions) {}

  canHandle(request: IncomingMessage): boolean {
    try {
      return new URL(request.url ?? "/", "http://senera.local").pathname === AgentProviderCredentialHttpRoute;
    } catch {
      return false;
    }
  }

  handle(request: IncomingMessage, response: ServerResponse): void {
    if (
      !applyCredentialedCors(request, response, {
        allowedMethods: ["GET", "OPTIONS"],
        isOriginAllowed: (origin) => this.options.isOriginAllowed?.(origin) ?? false,
      })
    ) {
      this.sendError(response, 403, "forbidden_origin", "The request origin is not allowed.");
      return;
    }
    if (request.method === "OPTIONS") {
      writeCorsPreflight(response);
      return;
    }
    if (request.method !== "GET") {
      this.sendError(response, 405, "method_not_allowed", "Use GET.");
      return;
    }

    const providerId = new URL(request.url ?? "/", "http://senera.local").searchParams.get("providerId")?.trim();
    if (!providerId) {
      this.sendError(response, 400, "provider_id_required", "A provider id is required.");
      return;
    }
    const endpoint = this.options
      .configSnapshot()
      .ModelProviderEndpoints?.find((candidate) => candidate.Id === providerId);
    if (!endpoint) {
      this.sendError(response, 404, "provider_not_found", "The provider was not found.");
      return;
    }

    this.sendJson(response, 200, {
      ok: true,
      providerId,
      apiKey: endpoint.ApiKey ?? "",
    });
  }

  private sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
    const body = JSON.stringify(value);
    response.writeHead(statusCode, {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Length": Buffer.byteLength(body),
      "Content-Security-Policy": "default-src 'none'",
      "Content-Type": "application/json; charset=utf-8",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(body);
  }

  private sendError(response: ServerResponse, statusCode: number, code: string, message: string): void {
    this.sendJson(response, statusCode, { ok: false, error: { code, message } });
  }
}
