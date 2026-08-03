import type http from "node:http";
import { describe, expect, test, vi } from "vitest";
import type { AgentAuthenticationHttpApi } from "../../../Source/AgentSystem/Auth/AgentAuthenticationHttpApi.js";
import type { AgentServerAccessGuard } from "../../../Source/AgentSystem/Auth/AgentServerAccessGuard.js";
import type { AgentPiProxyHttpApi } from "../../../Source/AgentSystem/PiProxy/AgentPiProxyHttpApi.js";
import type { AgentUploadHttpApi } from "../../../Source/AgentSystem/Uploads/AgentUploadHttpApi.js";
import type { AgentStaticFrontendHttpApi } from "../../../Source/AgentSystem/WebSocket/AgentStaticFrontendHttpApi.js";
import { AgentWebSocketHttpRouter } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketHttpRouter.js";
import type { AgentHealthHttpApi } from "../../../Source/AgentSystem/WebSocket/AgentHealthHttpApi.js";
import { AgentPiProxyProtocol } from "../../../Source/AgentSystem/PiShared/AgentPiProxyProtocol.js";

describe("WebSocket HTTP router", () => {
  test("routes authentication before generic access control", async () => {
    const fixture = createRouterFixture({ authentication: true, upload: true });

    await fixture.router.handle(request("POST", "/api/auth/login"), fixture.response.value);

    expect(fixture.authentication.handle).toHaveBeenCalledTimes(1);
    expect(fixture.upload.handle).not.toHaveBeenCalled();
    expect(fixture.authorizeHttp).not.toHaveBeenCalled();
  });

  test("allows upload preflight without authorization", async () => {
    const fixture = createRouterFixture({ upload: true });

    await fixture.router.handle(request("OPTIONS", "/api/uploads"), fixture.response.value);

    expect(fixture.authorizeHttp).not.toHaveBeenCalled();
    expect(fixture.upload.handle).toHaveBeenCalledTimes(1);
  });

  test("routes health probes without authentication or static frontend projection", async () => {
    const fixture = createRouterFixture({ health: true, staticFrontend: true });

    await fixture.router.handle(request("GET", "/health/ready"), fixture.response.value);

    expect(fixture.health.handle).toHaveBeenCalledTimes(1);
    expect(fixture.staticFrontend.handle).not.toHaveBeenCalled();
    expect(fixture.authorizeHttp).not.toHaveBeenCalled();
  });

  test("requires CSRF for mutating uploads and projects access failures", async () => {
    const fixture = createRouterFixture({
      upload: true,
      accessResult: {
        ok: false,
        failure: { status: 429, code: "rate_limited", retryAfterSeconds: 7 },
      },
    });

    await fixture.router.handle(request("POST", "/api/uploads"), fixture.response.value);

    expect(fixture.authorizeHttp).toHaveBeenCalledWith(expect.anything(), { requireCsrf: true });
    expect(fixture.upload.handle).not.toHaveBeenCalled();
    expect(fixture.response.setHeader).toHaveBeenCalledWith("Retry-After", "7");
    expect(fixture.response.writeHead).toHaveBeenCalledWith(
      429,
      expect.objectContaining({ "Cache-Control": "no-store" }),
    );
    expect(JSON.parse(String(fixture.response.end.mock.calls[0]?.[0]))).toMatchObject({
      ok: false,
      error: { code: "rate_limited" },
    });
  });

  test("authorizes upload content reads without CSRF", async () => {
    const fixture = createRouterFixture({ upload: true });

    await fixture.router.handle(request("GET", "/api/uploads/upl_fixture/content"), fixture.response.value);

    expect(fixture.authorizeHttp).toHaveBeenCalledWith(expect.anything(), { requireCsrf: false });
    expect(fixture.upload.handle).toHaveBeenCalledTimes(1);
  });

  test("authorizes local Pi proxy requests with the runtime credential instead of browser access", async () => {
    const fixture = createRouterFixture({ pi: true });

    await fixture.router.handle(
      request("GET", "/v1/models", {
        authorization: `Bearer ${AgentPiProxyProtocol.apiKey}`,
      }),
      fixture.response.value,
    );

    expect(fixture.authorizeHttp).not.toHaveBeenCalled();
    expect(fixture.pi.handle).toHaveBeenCalledTimes(1);
  });

  test("rejects Pi proxy requests without the runtime credential", async () => {
    const fixture = createRouterFixture({ pi: true });

    await fixture.router.handle(request("POST", "/v1/chat/completions"), fixture.response.value);

    expect(fixture.pi.handle).not.toHaveBeenCalled();
    expect(fixture.authorizeHttp).not.toHaveBeenCalled();
    expect(fixture.response.writeHead).toHaveBeenCalledWith(
      401,
      expect.objectContaining({ "Cache-Control": "no-store" }),
    );
  });

  test("rejects valid Pi proxy credentials from a remote connection", async () => {
    const fixture = createRouterFixture({ pi: true });

    await fixture.router.handle(
      request("POST", "/v1/chat/completions", {
        authorization: `Bearer ${AgentPiProxyProtocol.apiKey}`,
        remoteAddress: "203.0.113.8",
      }),
      fixture.response.value,
    );

    expect(fixture.pi.handle).not.toHaveBeenCalled();
    expect(fixture.response.writeHead).toHaveBeenCalledWith(401, expect.anything());
  });

  test("serves static frontend routes without invoking API authorization", async () => {
    const fixture = createRouterFixture({ staticFrontend: true });

    await fixture.router.handle(request("GET", "/settings"), fixture.response.value);

    expect(fixture.staticFrontend.handle).toHaveBeenCalledTimes(1);
    expect(fixture.authorizeHttp).not.toHaveBeenCalled();
  });

  test("returns a structured 404 for unknown routes", async () => {
    const fixture = createRouterFixture();

    await fixture.router.handle(request("DELETE", "/unknown"), fixture.response.value);

    expect(fixture.response.writeHead).toHaveBeenCalledWith(
      404,
      expect.objectContaining({ "Content-Type": "application/json; charset=utf-8" }),
    );
    expect(JSON.parse(String(fixture.response.end.mock.calls[0]?.[0]))).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });
});

function createRouterFixture(
  options: {
    authentication?: boolean;
    health?: boolean;
    upload?: boolean;
    pi?: boolean;
    staticFrontend?: boolean;
    accessResult?: unknown;
  } = {},
) {
  const authentication = createApi(options.authentication ?? false);
  const health = createApi(options.health ?? false);
  const upload = createApi(options.upload ?? false);
  const pi = createApi(options.pi ?? false);
  const staticFrontend = createApi(options.staticFrontend ?? false);
  const authorizeHttp = vi.fn(() => options.accessResult ?? { ok: true });
  const response = createResponse();
  return {
    authentication,
    health,
    upload,
    pi,
    staticFrontend,
    authorizeHttp,
    response,
    router: new AgentWebSocketHttpRouter({
      authenticationApi: authentication as unknown as AgentAuthenticationHttpApi,
      healthApi: health as unknown as AgentHealthHttpApi,
      uploadApi: upload as unknown as AgentUploadHttpApi,
      piProxyApi: pi as unknown as AgentPiProxyHttpApi,
      staticFrontendApi: staticFrontend as unknown as AgentStaticFrontendHttpApi,
      accessGuard: { authorizeHttp } as unknown as AgentServerAccessGuard,
    }),
  };
}

function createApi(canHandle: boolean) {
  return {
    canHandle: vi.fn(() => canHandle),
    handle: vi.fn(async () => undefined),
  };
}

function createResponse() {
  const writeHead = vi.fn();
  const setHeader = vi.fn();
  const end = vi.fn();
  return {
    writeHead,
    setHeader,
    end,
    value: { writeHead, setHeader, end } as unknown as http.ServerResponse,
  };
}

function request(
  method: string,
  url: string,
  options: {
    authorization?: string;
    localAddress?: string;
    remoteAddress?: string;
  } = {},
): http.IncomingMessage {
  return {
    method,
    url,
    headers: options.authorization ? { authorization: options.authorization } : {},
    socket: {
      localAddress: options.localAddress ?? "127.0.0.1",
      remoteAddress: options.remoteAddress ?? "127.0.0.1",
    },
  } as unknown as http.IncomingMessage;
}
