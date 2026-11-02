import type { IncomingMessage, ServerResponse } from "node:http";
import { applyCredentialedCors, writeCorsPreflight } from "../Auth/AgentCredentialedCors.js";
import { AgentSessionInsightsRoute, type AgentSessionInsightsPage } from "./AgentSessionInsightsContract.js";

export class AgentSessionInsightsHttpApi {
  constructor(
    private readonly options: {
      read: (input: {
        sessionId: string;
        after?: number;
        through?: number;
        signal?: AbortSignal;
      }) => Promise<AgentSessionInsightsPage | undefined>;
      isOriginAllowed: (origin: string, request: IncomingMessage) => boolean;
    },
  ) {}

  canHandle(request: IncomingMessage): boolean {
    return new URL(request.url ?? "/", "http://senera.local").pathname === AgentSessionInsightsRoute;
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (
      !applyCredentialedCors(request, response, {
        allowedMethods: ["GET", "OPTIONS"],
        isOriginAllowed: this.options.isOriginAllowed,
      })
    ) {
      this.send(response, 403, { ok: false, error: { code: "forbidden_origin" } });
      return;
    }
    if (request.method === "OPTIONS") {
      writeCorsPreflight(response);
      return;
    }
    if (request.method !== "GET") {
      this.send(response, 405, { ok: false, error: { code: "method_not_allowed" } });
      return;
    }
    const params = new URL(request.url ?? "/", "http://senera.local").searchParams;
    const sessionId = params.get("sessionId");
    const cursor = (key: string) =>
      params.has(key) ? (/^\d+$/.test(params.get(key)!) ? Number(params.get(key)) : NaN) : undefined;
    const after = cursor("after");
    const through = cursor("through");
    if (
      !sessionId ||
      [after, through].some((value) => value !== undefined && (!Number.isSafeInteger(value) || value < 0))
    ) {
      this.send(response, 400, { ok: false, error: { code: "invalid_insights_query" } });
      return;
    }
    const abort = new AbortController();
    const onClose = () => {
      if (!response.writableEnded) abort.abort();
    };
    response.once("close", onClose);
    try {
      const page = await this.options.read({ sessionId, after, through, signal: abort.signal });
      if (!abort.signal.aborted)
        this.send(
          response,
          page ? 200 : 404,
          page ? { ok: true, ...page } : { ok: false, error: { code: "session_not_found" } },
        );
    } catch (error) {
      if (!abort.signal.aborted)
        this.send(response, 500, {
          ok: false,
          error: { code: "insights_unavailable", message: error instanceof Error ? error.message : String(error) },
        });
    } finally {
      response.off("close", onClose);
    }
  }

  private send(response: ServerResponse, status: number, payload: unknown): void {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(JSON.stringify(payload));
  }
}
