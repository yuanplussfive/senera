// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ServerAuthenticationError,
  buildServerApiUrl,
  loginServerAuthentication,
  logoutServerAuthentication,
  readServerAuthentication,
} from "../../../Frontend/src/api/authClient.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("server authentication API", () => {
  test("projects WebSocket origins into same-server HTTP authentication routes", () => {
    expect(buildServerApiUrl("wss://agent.example/socket", "/api/auth/session")).toBe(
      "https://agent.example/api/auth/session",
    );
  });

  test("reads an anonymous session probe as normal server state", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true, session: { state: "anonymous" } }));
    vi.stubGlobal("fetch", fetch);

    await expect(readServerAuthentication("ws://agent.test")).resolves.toEqual({ state: "anonymous" });
    expect(fetch).toHaveBeenCalledWith(
      "http://agent.test/api/auth/session",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  test("sends login credentials only in a JSON POST body", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        session: {
          state: "authenticated",
          account: { id: "account", loginName: "owner", displayName: "Owner", role: "owner" },
          csrfToken: "csrf",
          expiresAt: "2026-07-25T00:00:00.000Z",
        },
      }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      loginServerAuthentication("ws://agent.test", { loginName: "owner", password: "secret" }),
    ).resolves.toMatchObject({
      account: { loginName: "owner" },
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://agent.test/api/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ loginName: "owner", password: "secret" }),
      }),
    );
  });

  test("keeps authentication failure detail empty when the server omits a message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: false }, 503)));

    await expect(
      loginServerAuthentication("ws://agent.test", { loginName: "owner", password: "secret" }),
    ).rejects.toMatchObject({ name: ServerAuthenticationError.name, status: 503, message: "" });
  });

  test("keeps logout failure detail empty when the server omits a message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));

    await expect(logoutServerAuthentication("ws://agent.test", "csrf")).rejects.toMatchObject({
      name: ServerAuthenticationError.name,
      status: 503,
      message: "",
    });
  });

  test("rejects malformed or failed authentication responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: { message: "Denied" } }, 403)));

    await expect(
      loginServerAuthentication("ws://agent.test", { loginName: "owner", password: "secret" }),
    ).rejects.toEqual(expect.objectContaining({ name: ServerAuthenticationError.name, status: 403 }));

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, session: { state: "unknown" } })));
    await expect(readServerAuthentication("ws://agent.test")).rejects.toMatchObject({
      name: ServerAuthenticationError.name,
      status: 200,
    });
  });
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
