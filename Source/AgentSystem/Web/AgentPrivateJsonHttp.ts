import type { IncomingMessage, ServerResponse } from "node:http";
import { applyCredentialedCors, writeCorsPreflight } from "../Auth/AgentCredentialedCors.js";

/** Private JSON is never cacheable, including validation and origin errors. */
export function sendAgentPrivateJson(response: ServerResponse, statusCode: number, value: unknown): void {
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

export function sendAgentPrivateJsonError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
): void {
  sendAgentPrivateJson(response, statusCode, { ok: false, error: { code, message } });
}

/** CORS and method admission only; authentication remains owned by the host router. */
export function acceptAgentPrivateJsonGet(
  request: IncomingMessage,
  response: ServerResponse,
  isOriginAllowed?: (origin: string, request: IncomingMessage) => boolean,
): boolean {
  if (
    !applyCredentialedCors(request, response, {
      allowedMethods: ["GET", "OPTIONS"],
      isOriginAllowed: (origin, corsRequest) => isOriginAllowed?.(origin, corsRequest) ?? false,
    })
  ) {
    sendAgentPrivateJsonError(response, 403, "forbidden_origin", "The request origin is not allowed.");
    return false;
  }
  if (request.method === "OPTIONS") {
    writeCorsPreflight(response);
    return false;
  }
  if (request.method !== "GET") {
    sendAgentPrivateJsonError(response, 405, "method_not_allowed", "Use GET.");
    return false;
  }
  return true;
}
