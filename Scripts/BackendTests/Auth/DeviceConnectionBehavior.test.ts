import http, { type IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resolveServerConfig, resolveUploadsConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import { AgentUploadHttpApi } from "../../../Source/AgentSystem/Uploads/AgentUploadHttpApi.js";
import { AgentUploadStore } from "../../../Source/AgentSystem/Uploads/AgentUploadStore.js";
import { AgentServerAccessGuard } from "../../../Source/AgentSystem/Auth/AgentServerAccessGuard.js";
import { AgentDeviceConnectionService } from "../../../Source/AgentSystem/Auth/AgentDeviceConnectionService.js";
import { AgentAuthenticationHttpApi } from "../../../Source/AgentSystem/Auth/AgentAuthenticationHttpApi.js";
import {
  AgentDeviceAuthenticationRoutes as Routes,
  isDeviceLanHost,
} from "../../../Source/AgentSystem/Auth/AgentDeviceAuthenticationContract.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const running = JSON.stringify({ BackendState: "Running", Self: { DNSName: "computer.example.ts.net." } });
const authority = "computer.example.ts.net:443";
function request(host: string, secure = false): IncomingMessage {
  return {
    headers: { host, origin: "https://localhost", ...(secure ? { "x-forwarded-proto": "https" } : {}) },
    socket: { remoteAddress: "127.0.0.1" },
  } as IncomingMessage;
}
function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), "senera-connections-"));
  roots.push(root);
  const guard = new AgentServerAccessGuard({
    workspaceRoot: root,
    server: resolveServerConfig({ ModelProviders: [], Server: { Host: "127.0.0.1", Port: 8787 } }),
  });
  return { guard, root };
}

describe("device connection addresses and private network", () => {
  test("default LAN recommendations never inspect or enable Tailscale", async () => {
    const { guard } = setup();
    const command = vi.fn();
    const service = new AgentDeviceConnectionService(guard, command, {
      listener: { host: "127.0.0.1", port: 8787 },
      createServer: () => http.createServer(),
      interfaces: () => [{ name: "Wi-Fi", address: "192.168.1.5" }],
    });
    expect(await service.snapshot(request("127.0.0.1"), "authorized")).toMatchObject({
      method: "lan",
      recommended: "lan",
      lan: { state: "disabled" },
    });
    expect(command).not.toHaveBeenCalled();
    service.selectMethod("private-network");
    command.mockRejectedValue(Object.assign(new Error("not installed"), { code: "ENOENT" }));
    expect(await service.snapshot(request("127.0.0.1"), "authorized")).toMatchObject({
      method: "private-network",
      privateNetwork: { state: "missing" },
    });
  });

  test("an unavailable saved interface is reported without preventing the main server from starting", async () => {
    const { guard } = setup();
    let available = true;
    const options = {
      listener: { host: "192.168.1.5", port: 8787 },
      createServer: vi.fn(),
      interfaces: () => (available ? [{ name: "Wi-Fi", address: "192.168.1.5" }] : []),
    };
    const service = new AgentDeviceConnectionService(guard, vi.fn(), options);
    await service.configureLan({ host: "192.168.1.5", port: 8787 });
    available = false;
    const restored = new AgentDeviceConnectionService(guard, vi.fn(), options);
    await expect(restored.restoreLan()).resolves.toBeUndefined();
    expect(await restored.snapshot(request("127.0.0.1"), "authorized")).toMatchObject({
      lan: { state: "failed", code: "lan_interface_unavailable" },
    });
    expect(options.createServer).not.toHaveBeenCalled();
    await service.stop();
    await restored.stop();
  });
  test("persists one configured origin, validates it, and trusts only its local HTTPS proxy", async () => {
    const { guard } = setup();
    const command = vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    const service = new AgentDeviceConnectionService(guard, command);
    for (const value of [
      "http://computer.test",
      "https://localhost",
      "https://127.0.0.1",
      "https://computer.test/path",
      "https://user:secret@computer.test",
    ])
      expect(() => service.saveAddress(value)).toThrow();
    service.saveAddress("https://COMPUTER.test/");
    expect(guard.allowsDeviceAuthentication(request("computer.test", true))).toBe(true);
    expect(guard.allowsDeviceAuthentication(request("other.test", true))).toBe(false);
    expect(guard.authorizeHttp(request("computer.test", true), { requireCsrf: false }).ok).toBe(false);
    const restored = new AgentDeviceConnectionService(guard, command);
    expect((await restored.snapshot(request("127.0.0.1"), "authorized")).address).toEqual({
      url: "https://computer.test",
      source: "saved",
    });
    restored.saveAddress("");
    expect(guard.allowsDeviceAuthentication(request("computer.test", true))).toBe(false);
  });
  test("uses a deployed HTTPS origin without inspecting the server's private network", async () => {
    const { guard } = setup();
    guard.setDeviceProxyOrigins(["https://console.test"]);
    const command = vi.fn();
    const service = new AgentDeviceConnectionService(guard, command);
    guard.setDeviceProxyOrigins(["https://console.test"]);
    expect(await service.snapshot(request("console.test", true), "authorized")).toMatchObject({
      address: { url: "https://console.test", source: "current" },
      method: "domain",
      recommended: "domain",
    });
    expect(command).not.toHaveBeenCalled();
    expect(await service.snapshot(request("console.test", true), "login")).toEqual({});
  });
  test("enables private HTTPS explicitly and preserves the detected address across restarts", async () => {
    const { guard } = setup();
    let serving = false;
    const command = vi.fn(async (args: readonly string[]) => {
      if (args[0] === "status") return running;
      if (args[1] === "status")
        return JSON.stringify(
          serving ? { Web: { [authority]: { Handlers: { "/": { Proxy: "http://127.0.0.1:8787/" } } } } } : {},
        );
      serving = true;
      return "";
    });
    const service = new AgentDeviceConnectionService(guard, command);
    expect(await service.checkNetwork()).toMatchObject({ state: "available" });
    expect(command.mock.calls.every(([args]) => args[1] !== "--bg")).toBe(true);
    expect(await service.enablePrivateNetwork()).toMatchObject({
      state: "serving",
      url: "https://computer.example.ts.net",
    });
    expect(command).toHaveBeenCalledWith(["serve", "--bg", "--https=443", "http://127.0.0.1:8787"]);
    new AgentDeviceConnectionService(guard, command);
    expect(guard.allowsDeviceAuthentication(request("computer.example.ts.net", true))).toBe(true);
  });
  test.each([false, true])("does not overwrite an existing service or a public Funnel (%s)", async (funnel) => {
    const { guard } = setup();
    const command = vi.fn(async (args: readonly string[]) =>
      args[0] === "status"
        ? running
        : JSON.stringify({
            Web: { [authority]: { Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } } } },
            AllowFunnel: { [authority]: funnel },
          }),
    );
    const service = new AgentDeviceConnectionService(guard, command);
    expect(await service.enablePrivateNetwork()).toMatchObject({ state: "conflict" });
    expect(command.mock.calls).toHaveLength(2);
  });
  test("distinguishes a missing CLI from operational errors and coalesces concurrent checks", async () => {
    const { guard } = setup();
    const missing = vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    const service = new AgentDeviceConnectionService(guard, missing);
    expect(await Promise.all([service.checkNetwork(true), service.checkNetwork(true)])).toEqual([
      { state: "missing" },
      { state: "missing" },
    ]);
    expect(missing).toHaveBeenCalledOnce();
    const failed = new AgentDeviceConnectionService(
      guard,
      vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("failed"), { code: 1, stderr: "Tailscale service is stopped" })),
    );
    expect(await failed.checkNetwork()).toEqual({ state: "failed", detail: "Tailscale service is stopped" });
  });
});

const lanAddress = Object.values(os.networkInterfaces())
  .flat()
  .find((entry) => entry && !entry.internal && entry.family === "IPv4" && isDeviceLanHost(entry.address))?.address;
describe.skipIf(!lanAddress)("real LAN authentication ingress", () => {
  test("requires approval for LAN access, uses a first-party cookie, reports port conflicts, and closes the listener", async () => {
    const { guard, root } = setup();
    const uploads = new AgentUploadHttpApi({
      store: new AgentUploadStore({ workspaceRoot: root, config: resolveUploadsConfig({ ModelProviders: [] }) }),
      isOriginAllowed: (origin, req) => guard.allowsOrigin(origin, req),
    });
    const sockets = new WebSocketServer({ noServer: true });
    const service = new AgentDeviceConnectionService(guard, vi.fn(), {
      listener: { host: "127.0.0.1", port: 8787 },
      interfaces: () => [{ name: "test interface", address: lanAddress! }],
      createServer: () => {
        const server = http.createServer((req, res) => {
          if (uploads.canHandle(req)) {
            const access = guard.authorizeHttp(req, { requireCsrf: req.method === "POST" });
            if (!access.ok) {
              res.writeHead(access.failure.status);
              res.end();
              return;
            }
            void uploads.handle(req, res);
            return;
          }
          void api.handle(req, res);
        });
        server.on("upgrade", (req, socket, head) => {
          const authorization = guard.authorizeWebSocket(req);
          if (!authorization.ok) {
            socket.destroy();
            return;
          }
          sockets.handleUpgrade(req, socket, head, (webSocket) => {
            guard.registerConnection(webSocket, authorization.access);
            webSocket.once("close", () => guard.unregisterConnection(webSocket));
          });
        });
        return server;
      },
    });
    const api = new AgentAuthenticationHttpApi(guard, service);
    await service.configureLan({ host: lanAddress!, port: 0 });
    const snapshot = await service.snapshot(request("127.0.0.1"), "authorized");
    const url = snapshot.lan!.url!;
    const ownerRequest = {
      headers: { host: "127.0.0.1", origin: "http://127.0.0.1" },
      socket: { remoteAddress: "127.0.0.1" },
    } as IncomingMessage;
    const owner = guard.initializeLocalOwnerSession(ownerRequest)!;
    const cookie = guard.issueCookie(owner.token, ownerRequest).split(";")[0];
    const send = (route: string, body?: unknown, credential?: string, csrfToken?: string) =>
      fetch(new URL(route, url), {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: url,
          "Content-Type": "application/json",
          ...(credential ? { Cookie: credential } : {}),
          ...(csrfToken ? { "X-Senera-Csrf": csrfToken } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    try {
      expect((await (await send("/api/auth/session")).json()).session.state).toBe("anonymous");
      const remoteSession = await send("/api/auth/session", {});
      expect((await remoteSession.json()).session.state).toBe("anonymous");
      expect(remoteSession.headers.has("set-cookie")).toBe(false);
      const pairing = await (await send(Routes.Pairings, {}, cookie, owner.session.csrfToken)).json();
      const secret = "s".repeat(64);
      expect(
        (
          await send(Routes.Claim, {
            pairingId: pairing.pairingId,
            code: pairing.code,
            deviceName: "LAN phone",
            secret,
          })
        ).status,
      ).toBe(200);
      const exchange = { pairingId: pairing.pairingId, secret };
      expect((await (await send(Routes.Exchange, exchange)).json()).state).toBe("pending");
      await send(Routes.Approve, { pairingId: pairing.pairingId, approve: true }, cookie, owner.session.csrfToken);
      const grant = await (await send(Routes.Exchange, exchange)).json();
      expect(grant.cookie).toContain("senera_lan_device=");
      expect(grant.cookie).toContain("SameSite=Strict");
      expect(grant.cookie).not.toContain("Secure");
      expect(
        (await (await send("/api/auth/session", undefined, grant.cookie.split(";")[0])).json()).session.state,
      ).toBe("authenticated");
      const picture = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      );
      const body = new FormData();
      body.append("file", new Blob([picture], { type: "image/png" }), "phone.png");
      const credential = grant.cookie.split(";")[0];
      expect(
        (await fetch(`${url}/api/resources`, { method: "POST", headers: { Origin: url, Cookie: credential }, body }))
          .status,
      ).toBe(403);
      const uploaded = await fetch(`${url}/api/resources`, {
        method: "POST",
        headers: { Origin: url, Cookie: credential, "X-Senera-Csrf": grant.session.csrfToken },
        body,
      });
      expect(uploaded.status).toBe(200);
      const {
        resources: [image],
      } = await uploaded.json();
      const contentUrl = `${url}/api/resources/${new URL(image.resourceUri).pathname.slice(1)}`;
      expect((await fetch(contentUrl)).status).toBe(401);
      // HTML image requests omit Origin; XHR/fetch requests include it. Both keep the paired cookie.
      const contentHeaders: Record<string, string>[] = [{ Cookie: credential }, { Cookie: credential, Origin: url }];
      for (const headers of contentHeaders) {
        const content = await fetch(contentUrl, { headers });
        expect(content.status).toBe(200);
        expect(content.headers.get("content-type")).toBe("image/png");
        expect(Buffer.from(await content.arrayBuffer())).toEqual(picture);
      }
      expect((await send(Routes.PrivateNetwork, {}, grant.cookie.split(";")[0], grant.session.csrfToken)).status).toBe(
        403,
      );
      const wire = new WebSocket(url.replace("http:", "ws:"), {
        headers: { Origin: url, Cookie: grant.cookie.split(";")[0] },
      });
      await new Promise<void>((resolve, reject) => {
        wire.once("open", resolve);
        wire.once("error", reject);
      });
      const conflict = new AgentDeviceConnectionService(setup().guard, vi.fn(), {
        listener: { host: "127.0.0.1", port: 8787 },
        interfaces: () => [{ name: "test", address: lanAddress! }],
        createServer: () => http.createServer(),
      });
      await conflict.configureLan({ host: lanAddress!, port: Number(new URL(url).port) });
      expect(await conflict.snapshot(ownerRequest, "authorized")).toMatchObject({
        lan: { state: "failed", code: "EADDRINUSE" },
      });
      await conflict.stop();
      const closed = new Promise<void>((resolve) => wire.once("close", () => resolve()));
      await service.configureLan(null);
      await closed;
    } finally {
      await service.stop();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
    }
    await expect(fetch(`${url}/api/auth/session`)).rejects.toThrow();
  });
});
