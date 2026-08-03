import type { IncomingMessage, ServerResponse } from "node:http";

export function applyCredentialedCors(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    readonly allowedMethods: readonly string[];
    readonly isOriginAllowed: (origin: string) => boolean;
  },
): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== "string") {
    return true;
  }
  if (!options.isOriginAllowed(origin)) {
    return false;
  }

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Methods", options.allowedMethods.join(", "));
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Senera-Csrf");
  appendVaryHeader(response, "Origin");
  return true;
}

export function writeCorsPreflight(response: ServerResponse): void {
  response.writeHead(204);
  response.end();
}

function appendVaryHeader(response: ServerResponse, value: string): void {
  const existing = response.getHeader("Vary");
  const values = (Array.isArray(existing) ? existing.join(",") : String(existing ?? ""))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!values.some((item) => item.toLowerCase() === value.toLowerCase())) {
    values.push(value);
  }
  response.setHeader("Vary", values.join(", "));
}
