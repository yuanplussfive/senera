import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentChannelKind } from "../Channels/AgentChannelTypes.js";
import type { AgentChannelService } from "../Channels/AgentChannelService.js";

export const AgentChannelWebhookRoutes = {
  Telegram: "/api/channels/telegram/webhook",
  Qq: "/api/channels/qq/webhook",
} as const;

export interface AgentChannelWebhookApiOptions {
  readonly channels: AgentChannelService;
  readonly readBodyLimitBytes?: number;
}

const DefaultBodyLimitBytes = 1024 * 1024;

/**
 * Public webhook entries for channel platforms that push events over HTTP
 * (Telegram webhook mode, QQ open platform callbacks). Delivery is
 * authenticated by the platform-provided secret token/signature inside the
 * channel service; this handler only parses the payload and routes it. It sits
 * ahead of the CSRF-guarded routes by design: platform servers do not send
 * browser Origin headers.
 */
export class AgentChannelWebhookApi {
  private readonly channels: AgentChannelService;
  private readonly readBodyLimitBytes: number;

  constructor(options: AgentChannelWebhookApiOptions) {
    this.channels = options.channels;
    this.readBodyLimitBytes = options.readBodyLimitBytes ?? DefaultBodyLimitBytes;
  }

  canHandle(request: IncomingMessage): boolean {
    if (request.method !== "POST") return false;
    const pathname = routePath(request);
    return Object.values(AgentChannelWebhookRoutes).includes(
      pathname as (typeof AgentChannelWebhookRoutes)[keyof typeof AgentChannelWebhookRoutes],
    );
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const kind = kindForRoute(routePath(request));
    if (!kind) {
      this.writeError(response, 404, "not_found");
      return;
    }
    let rawBody: string;
    try {
      rawBody = await readRawBody(request, this.readBodyLimitBytes);
    } catch (error) {
      this.writeError(
        response,
        error instanceof RequestBodyLimitError ? 413 : 400,
        error instanceof RequestBodyLimitError ? "body_too_large" : "invalid_body",
      );
      return;
    }
    let payload: unknown;
    try {
      payload = rawBody ? (JSON.parse(rawBody) as unknown) : undefined;
    } catch {
      this.writeError(response, 400, "invalid_json");
      return;
    }
    if (payload === undefined) {
      this.writeError(response, 400, "empty_body");
      return;
    }
    const requestHeaders = headersOf(request);
    try {
      const verification = await this.channels.deliverWebhookVerification(kind, payload, rawBody, requestHeaders);
      if (verification) {
        this.writeJson(response, verification.status ?? 200, verification.body, verification.headers);
        return;
      }
      const handled = await this.channels.deliverWebhookUpdate(kind, payload, rawBody, requestHeaders);
      if (!handled) {
        this.writeError(response, 404, "no_listener");
        return;
      }
      this.writeJson(response, 200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const unauthorized = /signature verification|mismatched secret|token/i.test(message);
      const invalid = /invalid|requires event_ts|plain_token|empty_body|payload/i.test(message);
      this.writeError(
        response,
        unauthorized ? 401 : invalid ? 400 : 500,
        unauthorized ? "unauthorized" : invalid ? "invalid_request" : "internal_error",
      );
    }
  }

  private writeError(response: ServerResponse, status: number, code: string): void {
    this.writeJson(response, status, { ok: false, error: { code } });
  }

  private writeJson(
    response: ServerResponse,
    status: number,
    body: unknown,
    headers?: Readonly<Record<string, string>>,
  ): void {
    response.writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    });
    response.end(JSON.stringify(body));
  }
}

function routePath(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://senera.local").pathname;
}

function kindForRoute(path: string): AgentChannelKind | undefined {
  switch (path) {
    case AgentChannelWebhookRoutes.Telegram:
      return "telegram";
    case AgentChannelWebhookRoutes.Qq:
      return "qq";
    default:
      return undefined;
  }
}

function headersOf(request: IncomingMessage): Record<string, string | string[]> {
  return Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, value ?? ""])) as Record<
    string,
    string | string[]
  >;
}

function readRawBody(request: IncomingMessage, limitBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new RequestBodyLimitError(limitBytes));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

class RequestBodyLimitError extends Error {
  constructor(limitBytes: number) {
    super(`Request body exceeds ${limitBytes} bytes.`);
    this.name = "RequestBodyLimitError";
  }
}
