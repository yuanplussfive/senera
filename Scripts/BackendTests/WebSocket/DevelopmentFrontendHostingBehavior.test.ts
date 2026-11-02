import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, expect, test, vi } from "vitest";
import { createDevelopmentFrontendProxy } from "../../../Apps/DevelopmentFrontendProxy.js";
import { AgentWebSocketTransport } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketTransport.js";
import { AgentLocalAdminAccountStore } from "../../../Source/AgentSystem/Auth/AgentLocalAdminAccount.js";
import { resolveAgentDevelopmentClientDocument } from "../../../Source/AgentSystem/Channels/Client/AgentDevelopmentClientDocument.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

test("authenticated development modules and HMR share the host without forwarding credentials or using API budget", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-development-host-"));
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
  const received: http.IncomingHttpHeaders[] = [];
  const upstream = http.createServer((request, response) => {
    received.push(request.headers);
    response.writeHead(200, { "Content-Type": "text/javascript" });
    response.end(`export const path = ${JSON.stringify(request.url)};`);
  });
  const hmr = new WebSocketServer({ server: upstream });
  hmr.on("connection", (socket, request) => {
    received.push(request.headers);
    socket.send("connected");
    socket.on("message", (data) => socket.send(data));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  cleanups.push(() => new Promise<void>((resolve) => upstream.close(() => resolve())));
  const upstreamOrigin = `http://127.0.0.1:${(upstream.address() as import("node:net").AddressInfo).port}`;
  const account = new AgentLocalAdminAccountStore(path.join(root, "admin.json"));
  await account.initialize({ loginName: "owner", displayName: "Owner", password: "test administrator password" });
  const reservation = http.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as import("node:net").AddressInfo).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const transport = new AgentWebSocketTransport({
    applicationRoot: root,
    defaultWorkspaceId: "test-workspace",
    developmentFrontend: createDevelopmentFrontendProxy(upstreamOrigin),
    config: () => ({
      ModelProviders: [],
      Server: {
        Host: "127.0.0.1",
        Port: port,
        AccessControl: {
          Mode: "required",
          AccountFile: "admin.json",
          AllowInsecureLoopback: true,
          Limits: { HttpRequestsPerMinute: 1 },
        },
      },
    }),
  });
  cleanups.push(() => transport.stop());
  await transport.start();
  const origin = `http://127.0.0.1:${port}`;
  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ loginName: "owner", password: "test administrator password" }),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  expect((await fetch(`${origin}/development/main.ts`)).status).toBe(401);
  expect(
    (await fetch(`${origin}/development/main.ts`, { headers: { Cookie: cookie, Origin: "https://other.test" } }))
      .status,
  ).toBe(403);
  for (let index = 0; index < 24; index++) {
    const modulePath = `/development/module.ts?v=${index}`;
    const response = await fetch(`${origin}${modulePath}`, {
      headers: { Cookie: cookie, Origin: origin, Authorization: "private", "x-senera-csrf": "private" },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(JSON.stringify(modulePath));
  }
  // Static imports neither exhaust nor bypass the independently enforced API budget.
  expect((await fetch(`${origin}/api/auth/session`, { headers: { Cookie: cookie } })).status).toBe(200);
  expect((await fetch(`${origin}/api/auth/session`, { headers: { Cookie: cookie } })).status).toBe(429);
  const rejected = new WebSocket(`${origin.replace("http:", "ws:")}/development/`, { origin });
  rejected.on("error", () => undefined);
  cleanups.push(async () => rejected.terminate());
  const rejection = once(rejected, "unexpected-response");
  const [, response] = await rejection;
  expect(response.statusCode).toBe(401);
  response.resume();
  rejected.terminate();
  const socket = new WebSocket(`${origin.replace("http:", "ws:")}/development/`, {
    origin,
    headers: { Cookie: cookie, Authorization: "private", "x-senera-csrf": "private" },
  });
  cleanups.push(async () => socket.terminate());
  expect(String((await once(socket, "message"))[0])).toBe("connected");
  const echo = once(socket, "message");
  socket.send("hot update");
  expect(String((await echo)[0])).toBe("hot update");
  expect(received).toHaveLength(25);
  for (const headers of received) {
    expect(headers.origin).toBe(upstreamOrigin);
    expect(headers.cookie).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
    expect(headers["x-senera-csrf"]).toBeUndefined();
  }
  const closed = once(socket, "close");
  await transport.stop();
  await closed;
});

test("development inline imports remain on the document origin", async () => {
  const html = await resolveAgentDevelopmentClientDocument(
    '<script type="module">import Refresh from "/development/@react-refresh"; import("./feature.ts"); const text = "http://127.0.0.1:5173/not-an-import";</script>',
    new URL("http://127.0.0.1:5173/development/qq/index.html"),
  );
  expect(html).toContain('from "/development/@react-refresh"');
  expect(html).toContain('import("/development/qq/feature.ts")');
  expect(html).toContain('const text = "http://127.0.0.1:5173/not-an-import"');
});

test("HMR upgrade completes at the handshake; later upstream resets do not become failed workspace upgrades", async () => {
  const upstream = http.createServer();
  const hmr = new WebSocketServer({ server: upstream });
  let peer: import("node:net").Socket | undefined;
  hmr.on("connection", (socket, request) => {
    peer = request.socket;
    socket.send("connected");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  cleanups.push(() => new Promise<void>((resolve) => upstream.close(() => resolve())));
  const proxy = createDevelopmentFrontendProxy(
    `http://127.0.0.1:${(upstream.address() as import("node:net").AddressInfo).port}`,
  );
  const downstream = http.createServer();
  let upgraded = false;
  const failures: unknown[] = [];
  downstream.on("upgrade", (request, socket, head) => {
    void proxy.upgrade(request, socket, head).then(
      () => {
        upgraded = true;
      },
      (error) => {
        failures.push(error);
        socket.destroy();
      },
    );
  });
  downstream.listen(0, "127.0.0.1");
  await once(downstream, "listening");
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        proxy.close();
        downstream.close(() => resolve());
      }),
  );
  const client = new WebSocket(
    `ws://127.0.0.1:${(downstream.address() as import("node:net").AddressInfo).port}/development/`,
  );
  client.on("error", () => undefined);
  cleanups.push(async () => client.terminate());
  expect(String((await once(client, "message"))[0])).toBe("connected");
  await vi.waitFor(() => expect(upgraded).toBe(true));
  const closed = once(client, "close");
  peer!.resetAndDestroy();
  await closed;
  expect(failures).toEqual([]);
});
