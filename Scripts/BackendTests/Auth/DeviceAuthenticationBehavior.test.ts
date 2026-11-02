import { AgentServerAccessProfiles } from "../../../Source/AgentSystem/Auth/AgentServerAccessPolicy.js";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { resolveServerConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import { AgentAuthenticationHttpApi } from "../../../Source/AgentSystem/Auth/AgentAuthenticationHttpApi.js";
import { AgentAuthenticationHttpRoutes as AuthRoutes } from "../../../Source/AgentSystem/Auth/AgentAuthenticationProtocol.js";
import { AgentLocalAdminAccountStore } from "../../../Source/AgentSystem/Auth/AgentLocalAdminAccount.js";
import { AgentServerAccessGuard } from "../../../Source/AgentSystem/Auth/AgentServerAccessGuard.js";
import {
  AgentDeviceAuthenticationRoutes as Routes,
  AgentMobileOrigin,
} from "../../../Source/AgentSystem/Auth/AgentDeviceAuthenticationContract.js";
import { AgentDevicePairingStore } from "../../../Source/AgentSystem/Auth/AgentDevicePairingStore.js";

const closers: Array<() => Promise<void>> = [];
const DesktopOrigin = "https://computer.test";
const Password = "a long device login password";
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

describe("mobile account and QR authentication", () => {
  test("pairs a local computer without an account while requiring authorization on its HTTPS proxy", async () => {
    const h = await harness({ local: true });
    const local = { origin: "http://localhost:5173", secure: false };
    expect((await (await h.request(AuthRoutes.Session, local)).json()).session.state).toBe("disabled");
    const bootstrap = await h.request(AuthRoutes.Session, { ...local, body: {} });
    expect(bootstrap.status).toBe(200);
    const owner = {
      ...local,
      cookie: bootstrap.headers.get("set-cookie")!.split(";")[0],
      csrfToken: (await bootstrap.json()).session.csrfToken,
    };
    const configuration = await h.request(Routes.Connection, { ...owner, body: { serverUrl: DesktopOrigin } });
    expect(configuration.status).toBe(200);
    expect((await configuration.json()).address).toEqual({ url: DesktopOrigin, source: "saved" });
    const remote = { host: "computer.test" };
    expect((await (await h.request("/api/auth/session", remote)).json()).session.state).toBe("anonymous");
    expect((await h.request(Routes.Devices, remote)).status).toBe(401);
    const pairing = await (await h.request(Routes.Pairings, { ...owner, body: {} })).json();
    const secret = "s".repeat(64);
    expect(
      (
        await h.request(Routes.Claim, {
          ...remote,
          body: { pairingId: pairing.pairingId, code: pairing.code, secret, deviceName: "My phone" },
        })
      ).status,
    ).toBe(200);
    expect(
      (await h.request(Routes.Approve, { ...owner, body: { pairingId: pairing.pairingId, approve: true } })).status,
    ).toBe(200);
    const grant = await (
      await h.request(Routes.Exchange, { ...remote, body: { pairingId: pairing.pairingId, secret } })
    ).json();
    expect(grant.session.state).toBe("authenticated");
    const cookie = grant.cookie.split(";")[0];
    expect((await (await h.request("/api/auth/session", { ...remote, cookie })).json()).session.state).toBe(
      "authenticated",
    );
    const socket = await h.socket(cookie, "computer.test");
    const devices = await (await h.request(Routes.Devices, owner)).json();
    await h.request(Routes.Devices, { ...owner, method: "DELETE", body: { deviceId: devices.devices[0].id } });
    const closed = new Promise<number>((resolve) => socket.once("close", resolve));
    socket.send("revoked device");
    expect(await closed).toBe(4401);
    expect((await (await h.request("/api/auth/session", { ...remote, cookie })).json()).session.state).toBe(
      "anonymous",
    );
  });

  test("keeps same-origin desktop device setup local when the request omits Origin", async () => {
    const h = await harness({ local: true });
    const session = await h.request(AuthRoutes.Session, { omitOrigin: true, secure: false, body: {} });
    expect(session.status).toBe(200);
    const connection = await h.request(Routes.Connection, {
      omitOrigin: true,
      secure: false,
      cookie: session.headers.get("set-cookie")!.split(";")[0],
    });
    expect(connection.status).toBe(200);
    expect((await connection.json()).authorization).toBe("authorized");
  });

  test("never permits proxy or foreign-origin requests to bootstrap a local owner", async () => {
    const h = await harness({ local: true });
    const proxy = await h.request(AuthRoutes.Session, { body: {}, origin: "http://localhost:5173" });
    expect((await proxy.json()).session.state).toBe("anonymous");
    expect(proxy.headers.has("set-cookie")).toBe(false);
    expect(
      (await h.request(AuthRoutes.Session, { body: {}, origin: "https://attacker.example", secure: false })).status,
    ).toBe(403);
    const foreignHost = await h.request(AuthRoutes.Session, {
      body: {},
      origin: "http://localhost:5173",
      host: "attacker.example",
      secure: false,
    });
    expect((await foreignHost.json()).session.state).toBe("anonymous");
    expect(foreignHost.headers.has("set-cookie")).toBe(false);
    const publicStatus = await (
      await h.request(Routes.Connection, { origin: "http://localhost:5173", host: "computer.test", secure: false })
    ).json();
    expect(publicStatus).toEqual({ ok: true, authorization: "login" });
  });
  test("password login issues a dedicated secure device cookie and reuses account authorization", async () => {
    const h = await harness();
    const login = await h.request(Routes.Login, {
      body: { loginName: "owner", password: Password, deviceName: "My phone" },
    });
    expect(login.status).toBe(200);
    const grant = await login.json();
    expect(grant.cookie).toContain("__Host-senera_device=");
    expect(grant.cookie).toContain("HttpOnly; Secure; SameSite=None");
    expect(grant.session.account.loginName).toBe("owner");
    expect(grant.deviceName).toBe("My phone");
    const session = await h.request("/api/auth/session", { cookie: grant.cookie.split(";")[0] });
    expect((await session.json()).session.state).toBe("authenticated");
    const denied = await h.request(Routes.Devices, {
      method: "DELETE",
      cookie: grant.cookie.split(";")[0],
      body: { deviceId: "id" },
    });
    expect(denied.status).toBe(403);
  });

  test("rejects device password authentication over plaintext and from an unapproved origin", async () => {
    const h = await harness();
    const body = { loginName: "owner", password: Password, deviceName: "Phone" };
    expect((await h.request(Routes.Login, { body, secure: false })).status).toBe(403);
    expect((await h.request(Routes.Login, { body, origin: "https://attacker.example" })).status).toBe(403);
    expect((await h.request(Routes.Login, { body: { ...body, password: "incorrect" } })).status).toBe(401);
  });

  test("scanning requires explicit approval, binds the claimant secret and permits only one exchange", async () => {
    const h = await harness();
    const owner = await h.owner();
    const pairing = await (await h.request(Routes.Pairings, { ...owner, body: {} })).json();
    const claim = {
      pairingId: pairing.pairingId,
      code: pairing.code,
      deviceName: "Android phone",
      secret: "s".repeat(64),
    };
    expect((await h.request(Routes.Claim, { body: claim })).status).toBe(200);
    expect((await h.request(Routes.Claim, { body: claim })).status).toBe(404);
    expect(
      await (await h.request(Routes.Exchange, { body: { pairingId: pairing.pairingId, secret: claim.secret } })).json(),
    ).toMatchObject({ state: "pending" });
    expect(
      (await h.request(Routes.Exchange, { body: { pairingId: pairing.pairingId, secret: "x".repeat(64) } })).status,
    ).toBe(404);
    const pending = await (await h.request(Routes.Pairings, owner)).json();
    expect(pending.pending).toEqual([expect.objectContaining({ deviceName: claim.deviceName })]);
    expect(JSON.stringify(pending)).not.toContain(claim.secret);
    expect(
      (await h.request(Routes.Approve, { cookie: owner.cookie, body: { pairingId: pairing.pairingId, approve: true } }))
        .status,
    ).toBe(403);
    const other = await h.owner();
    expect(
      (await h.request(Routes.Approve, { ...other, body: { pairingId: pairing.pairingId, approve: true } })).status,
    ).toBe(404);
    expect(
      (await h.request(Routes.Approve, { ...owner, body: { pairingId: pairing.pairingId, approve: true } })).status,
    ).toBe(200);
    const grant = await (
      await h.request(Routes.Exchange, { body: { pairingId: pairing.pairingId, secret: claim.secret } })
    ).json();
    expect(grant.session.state).toBe("authenticated");
    expect(grant.deviceName).toBe(claim.deviceName);
    expect(
      (await h.request(Routes.Exchange, { body: { pairingId: pairing.pairingId, secret: claim.secret } })).status,
    ).toBe(404);
  });

  test("device revocation invalidates HTTP and existing WebSocket authorization without revoking the owner", async () => {
    const h = await harness();
    const owner = await h.owner();
    const grant = await (
      await h.request(Routes.Login, { body: { loginName: "owner", password: Password, deviceName: "Phone" } })
    ).json();
    const deviceCookie = grant.cookie.split(";")[0];
    const socket = await h.socket(deviceCookie);
    const firstMessage = new Promise<string>((resolve) => socket.once("message", (data) => resolve(data.toString())));
    socket.send("authorized");
    expect(await firstMessage).toBe("authorized");
    const devices = await (await h.request(Routes.Devices, owner)).json();
    expect(devices.devices).toHaveLength(1);
    expect(JSON.stringify(devices)).not.toContain(grant.cookie);
    expect(
      (await h.request(Routes.Devices, { ...owner, method: "DELETE", body: { deviceId: devices.devices[0].id } }))
        .status,
    ).toBe(200);
    const closed = new Promise<number>((resolve) => socket.once("close", (code) => resolve(code)));
    socket.send("must not execute");
    expect(await closed).toBe(4401);
    expect((await (await h.request("/api/auth/session", { cookie: deviceCookie })).json()).session.state).toBe(
      "anonymous",
    );
    expect((await (await h.request("/api/auth/session", owner)).json()).session.state).toBe("authenticated");
  });

  test("rejecting a scan or revoking the approving session invalidates the pending exchange", async () => {
    const h = await harness();
    const owner = await h.owner();
    const create = async () => (await h.request(Routes.Pairings, { ...owner, body: {} })).json();
    const first = await create();
    await h.request(Routes.Claim, {
      body: { pairingId: first.pairingId, code: first.code, deviceName: "Phone", secret: "s".repeat(64) },
    });
    await h.request(Routes.Approve, { ...owner, body: { pairingId: first.pairingId, approve: false } });
    expect(
      (await h.request(Routes.Exchange, { body: { pairingId: first.pairingId, secret: "s".repeat(64) } })).status,
    ).toBe(404);
    const second = await create();
    await h.request(Routes.Claim, {
      body: { pairingId: second.pairingId, code: second.code, deviceName: "Phone", secret: "s".repeat(64) },
    });
    await h.request("/api/auth/logout", { ...owner, body: {} });
    expect(
      (await h.request(Routes.Exchange, { body: { pairingId: second.pairingId, secret: "s".repeat(64) } })).status,
    ).toBe(404);
  });

  test("expired codes and rotated codes cannot be claimed; capacity is bounded without evicting another owner", () => {
    let now = 0;
    const store = new AgentDevicePairingStore({ maxPairings: 1, isOwnerActive: () => true, now: () => now });
    const first = store.create("owner")!;
    const second = store.create("owner")!;
    expect(store.create("another-owner")).toBeUndefined();
    expect(store.claim(first.pairingId, first.code, "Phone", "secret")).toBe(false);
    now = Date.parse(second.expiresAt);
    expect(store.claim(second.pairingId, second.code, "Phone", "secret")).toBe(false);
    expect(store.create("another-owner")).toBeDefined();
  });

  test("creating another code preserves an approved claim until the phone exchanges it", () => {
    const store = new AgentDevicePairingStore({ maxPairings: 8, isOwnerActive: () => true });
    const approved = store.create("owner")!;
    expect(store.claim(approved.pairingId, approved.code, "Phone", "secret")).toBe(true);
    expect(store.decide(approved.pairingId, "owner", true)).toBe(true);

    expect(store.create("owner")).toBeDefined();
    expect(store.exchange(approved.pairingId, "secret")).toEqual({
      state: "approved",
      deviceName: "Phone",
      ownerSessionId: "owner",
    });
  });
});

async function harness(options: { local?: boolean } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "senera-device-auth-"));
  const account = new AgentLocalAdminAccountStore(path.join(root, "account.json"));
  if (!options.local) await account.initialize({ loginName: "owner", displayName: "Owner", password: Password });
  const guard = new AgentServerAccessGuard({
    workspaceRoot: root,
    accessProfile: options.local ? AgentServerAccessProfiles.Desktop : AgentServerAccessProfiles.Configured,
    server: resolveServerConfig({
      ModelProviders: [],
      Server: {
        Host: "127.0.0.1",
        AccessControl: {
          Mode: options.local ? "auto" : "required",
          AccountFile: "account.json",
          AllowedOrigins: [DesktopOrigin],
          TrustedProxyAddresses: options.local ? [] : ["127.0.0.1"],
          Limits: { LoginAttemptsPerMinute: 100, HttpRequestsPerMinute: 1000 },
        },
      },
    }),
  });
  const api = new AgentAuthenticationHttpApi(guard);
  const sockets = new WebSocketServer({ noServer: true });
  const server = http.createServer((request, response) => {
    void api.handle(request, response).catch(() => {
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: "authentication_failed" }));
    });
  });
  server.on("upgrade", (request, stream, head) => {
    const access = guard.authorizeWebSocket(request);
    if (!access.ok) {
      stream.destroy();
      return;
    }
    sockets.handleUpgrade(request, stream, head, (socket) => {
      guard.registerConnection(socket, access.access);
      socket.on("message", (data) => {
        if (guard.authorizeMessage(socket).ok) socket.send(data);
        else socket.close(4401);
      });
      socket.on("close", () => guard.unregisterConnection(socket));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test listener is unavailable.");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  closers.push(async () => {
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    rmSync(root, { recursive: true, force: true });
  });
  const request = (
    route: string,
    options: {
      body?: unknown;
      method?: string;
      cookie?: string;
      csrfToken?: string;
      origin?: string;
      omitOrigin?: boolean;
      secure?: boolean;
      host?: string;
    } = {},
  ) =>
    httpRequest(baseUrl + route, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: {
        ...(options.omitOrigin ? {} : { Origin: options.origin ?? AgentMobileOrigin }),
        ...(options.host ? { Host: options.host } : {}),
        ...(options.secure === false ? {} : { "X-Forwarded-Proto": "https" }),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(options.csrfToken ? { "X-Senera-Csrf": options.csrfToken } : {}),
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  const owner = async () => {
    const response = await request("/api/auth/login", {
      origin: DesktopOrigin,
      body: { loginName: "owner", password: Password },
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    return {
      cookie: response.headers.get("set-cookie")!.split(";")[0],
      csrfToken: result.session.csrfToken,
      origin: DesktopOrigin,
    };
  };
  const socket = async (cookie: string, host?: string): Promise<WebSocket> => {
    const connection = new WebSocket(baseUrl.replace("http:", "ws:"), {
      headers: {
        Cookie: cookie,
        Origin: AgentMobileOrigin,
        "X-Forwarded-Proto": "https",
        ...(host ? { Host: host } : {}),
      },
    });
    await new Promise<void>((resolve, reject) => {
      connection.once("open", resolve);
      connection.once("error", reject);
    });
    return connection;
  };
  return { request, owner, guard, socket };
}

// Use the HTTP transport directly so tests can faithfully supply a proxy's Host header.
function httpRequest(
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string },
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: options.method,
        headers: {
          ...options.headers,
          ...(options.body ? { "Content-Length": String(Buffer.byteLength(options.body)) } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) for (const item of value) headers.append(name, item);
            else if (value !== undefined) headers.set(name, value);
          }
          resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers }));
        });
      },
    );
    request.on("error", reject);
    request.end(options.body);
  });
}
