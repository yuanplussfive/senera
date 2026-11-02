import http from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import {
  acceptAgentPrivateJsonGet,
  sendAgentPrivateJson,
} from "../../../Source/AgentSystem/Web/AgentPrivateJsonHttp.js";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("private JSON response policy", () => {
  test.each([
    { method: "GET", origin: "http://settings.test", status: 200, code: undefined },
    { method: "GET", origin: "http://untrusted.test", status: 403, code: "forbidden_origin" },
    { method: "POST", origin: "http://settings.test", status: 405, code: "method_not_allowed" },
  ])("protects $method responses with status $status", async ({ method, origin, status, code }) => {
    const baseUrl = await createHarness();
    const response = await fetch(baseUrl, { method, headers: { Origin: origin } });
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await response.text();
    expect(Number(response.headers.get("content-length"))).toBe(Buffer.byteLength(body));
    expect(JSON.parse(body)).toMatchObject(code ? { ok: false, error: { code } } : { ok: true, value: "密钥" });
    if (code) expect(body).not.toContain("密钥");
  });

  test("handles credentialed preflight before reading any secret", async () => {
    const response = await fetch(await createHarness(), {
      method: "OPTIONS",
      headers: { Origin: "http://settings.test", "Access-Control-Request-Method": "GET" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://settings.test");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(await response.text()).toBe("");
  });
});

async function createHarness(): Promise<string> {
  const server = http.createServer((request, response) => {
    if (!acceptAgentPrivateJsonGet(request, response, (origin) => origin === "http://settings.test")) return;
    sendAgentPrivateJson(response, 200, { ok: true, value: "密钥" });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Private JSON test server did not bind.");
  return `http://127.0.0.1:${address.port}`;
}
