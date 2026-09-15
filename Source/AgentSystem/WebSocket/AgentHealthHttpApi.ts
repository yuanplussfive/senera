import type { IncomingMessage, ServerResponse } from "node:http";

export const AgentHealthHttpRoutes = {
  Liveness: "/health/live",
  Readiness: "/health/ready",
} as const;

export class AgentHealthHttpApi {
  constructor(private readonly isReady: () => boolean = () => true) {}

  canHandle(request: IncomingMessage): boolean {
    const pathname = new URL(request.url ?? "/", "http://senera.local").pathname;
    return Object.values(AgentHealthHttpRoutes).includes(
      pathname as (typeof AgentHealthHttpRoutes)[keyof typeof AgentHealthHttpRoutes],
    );
  }

  handle(request: IncomingMessage, response: ServerResponse): void {
    if (request.method !== "GET" && request.method !== "HEAD") {
      this.write(response, 405, { ok: false, status: "method_not_allowed" }, request.method);
      return;
    }

    const pathname = new URL(request.url ?? "/", "http://senera.local").pathname;
    if (pathname === AgentHealthHttpRoutes.Liveness) {
      this.write(response, 200, { ok: true, status: "live" }, request.method);
      return;
    }

    const ready = this.isReady();
    this.write(response, ready ? 200 : 503, { ok: ready, status: ready ? "ready" : "not_ready" }, request.method);
  }

  private write(response: ServerResponse, status: number, payload: unknown, method: string | undefined): void {
    response.writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(method === "HEAD" ? undefined : JSON.stringify(payload));
  }
}
