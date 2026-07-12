import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { resolveServerConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import { AgentAuthenticationHttpApi } from "../../../Source/AgentSystem/Auth/AgentAuthenticationHttpApi.js";
import { AgentLocalAdminAccountStore } from "../../../Source/AgentSystem/Auth/AgentLocalAdminAccount.js";
import { AgentServerAccessGuard } from "../../../Source/AgentSystem/Auth/AgentServerAccessGuard.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

const roots: string[] = [];
const closers: Array<() => Promise<void>> = [];
const Origin = "http://app.test";

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("administrator authentication HTTP API", () => {
  test("returns anonymous status before a local administrator logs in", async () => {
    const harness = await createHarness();
    const response = await fetch(`${harness.baseUrl}/api/auth/session`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "authentication_required" } });
  });

  test("issues an HttpOnly session cookie and exposes only the CSRF token to the browser", async () => {
    const harness = await createHarness();
    const login = await loginAsOwner(harness.baseUrl);
    expect(login.response.status).toBe(200);
    expect(login.cookie).toMatch(/^senera_local_session=/);
    expect(login.response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(login.response.headers.get("set-cookie")).toContain("SameSite=Strict");

    const session = await fetch(`${harness.baseUrl}/api/auth/session`, {
      headers: { Cookie: login.cookie },
    });
    expect(await session.json()).toMatchObject({
      ok: true,
      authentication: {
        required: true,
        account: { loginName: "owner", role: "owner" },
        csrfToken: login.payload.authentication.csrfToken,
      },
    });
  });

  test("requires a session-bound CSRF token before revoking a session", async () => {
    const harness = await createHarness();
    const login = await loginAsOwner(harness.baseUrl);
    const denied = await fetch(`${harness.baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: login.cookie, Origin },
    });
    expect(denied.status).toBe(403);

    const logout = await fetch(`${harness.baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: {
        Cookie: login.cookie,
        Origin,
        "X-Senera-Csrf": login.payload.authentication.csrfToken,
      },
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    const session = await fetch(`${harness.baseUrl}/api/auth/session`, {
      headers: { Cookie: login.cookie },
    });
    expect(session.status).toBe(401);
  });

  test("returns credentialed CORS headers only for an approved browser origin", async () => {
    const harness = await createHarness();
    const allowed = await fetch(`${harness.baseUrl}/api/auth/session`, { headers: { Origin } });
    expect(allowed.status).toBe(401);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(Origin);
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");
    expect(allowed.headers.get("vary")).toContain("Origin");

    const denied = await fetch(`${harness.baseUrl}/api/auth/session`, {
      headers: { Origin: "https://untrusted.example" },
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("answers approved authentication preflight requests without creating a session", async () => {
    const harness = await createHarness();
    const response = await fetch(`${harness.baseUrl}/api/auth/login`, {
      method: "OPTIONS",
      headers: {
        Origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(Origin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });
});

async function createHarness(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const root = mkdtempSync(path.join(os.tmpdir(), "senera-auth-http-"));
  roots.push(root);
  const account = new AgentLocalAdminAccountStore(path.join(root, "admin-account.json"));
  await account.initialize({
    loginName: "owner",
    displayName: "Owner",
    password: "a long administrator password",
  });
  const guard = new AgentServerAccessGuard({
    workspaceRoot: root,
    server: resolveServerConfig({
      ...minimalConfig(),
      Server: {
        Host: "127.0.0.1",
        AccessControl: {
          Mode: "required",
          AccountFile: "admin-account.json",
          AllowedOrigins: [Origin],
          Limits: {
            LoginAttemptsPerMinute: 20,
            HttpRequestsPerMinute: 100,
          },
        },
      },
    }),
  });
  const api = new AgentAuthenticationHttpApi(guard);
  const server = http.createServer((request, response) => {
    void api.handle(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to start authentication HTTP test server.");
  }
  const close = () =>
    new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  closers.push(close);
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close,
  };
}

async function loginAsOwner(baseUrl: string): Promise<{
  response: Response;
  cookie: string;
  payload: { authentication: { csrfToken: string } };
}> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin,
    },
    body: JSON.stringify({ loginName: "owner", password: "a long administrator password" }),
  });
  const payload = (await response.json()) as { authentication: { csrfToken: string } };
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) {
    throw new Error("Expected a session cookie from login.");
  }
  return { response, cookie, payload };
}

function minimalConfig(): AgentSystemConfig {
  return { ModelProviders: [] };
}
