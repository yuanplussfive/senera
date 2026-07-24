import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, test, vi } from "vitest";
import { AgentHealthHttpApi, AgentHealthHttpRoutes } from "../../../Source/AgentSystem/WebSocket/AgentHealthHttpApi.js";

describe("server health HTTP API", () => {
  test("reports liveness independently from readiness", () => {
    const api = new AgentHealthHttpApi(() => false);
    const liveness = responseFixture();
    const readiness = responseFixture();

    api.handle(request("GET", AgentHealthHttpRoutes.Liveness), liveness.response);
    api.handle(request("GET", AgentHealthHttpRoutes.Readiness), readiness.response);

    expect(liveness.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Cache-Control": "no-store" }));
    expect(JSON.parse(String(liveness.end.mock.calls[0]?.[0]))).toEqual({ ok: true, status: "live" });
    expect(readiness.writeHead).toHaveBeenCalledWith(503, expect.anything());
    expect(JSON.parse(String(readiness.end.mock.calls[0]?.[0]))).toEqual({ ok: false, status: "not_ready" });
  });

  test("supports bodyless readiness probes and rejects mutating methods", () => {
    const api = new AgentHealthHttpApi(() => true);
    const head = responseFixture();
    const post = responseFixture();

    expect(api.canHandle(request("HEAD", AgentHealthHttpRoutes.Readiness))).toBe(true);
    api.handle(request("HEAD", AgentHealthHttpRoutes.Readiness), head.response);
    api.handle(request("POST", AgentHealthHttpRoutes.Readiness), post.response);

    expect(head.writeHead).toHaveBeenCalledWith(200, expect.anything());
    expect(head.end).toHaveBeenCalledWith(undefined);
    expect(post.writeHead).toHaveBeenCalledWith(405, expect.anything());
  });
});

function request(method: string, url: string): IncomingMessage {
  return { method, url } as IncomingMessage;
}

function responseFixture(): {
  response: ServerResponse;
  writeHead: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} {
  const writeHead = vi.fn();
  const end = vi.fn();
  return {
    response: { writeHead, end } as unknown as ServerResponse,
    writeHead,
    end,
  };
}
