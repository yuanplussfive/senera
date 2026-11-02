import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { afterEach, expect, test, vi } from "vitest";
import { createTestAgentDirectory } from "../Support/AgentDirectoryTestFixture.js";
import { prepareQqClientBuild, qqClientArchive } from "../Support/QqClientBuildFixture.js";
import { seedTestModelsDevCatalog } from "../Support/AgentModelsDevCatalogFixture.js";
import { AgentWebSocketServer } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketServer.js";
import { AgentWebSocketTransport } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketTransport.js";
import { AgentCallbackRunEventWriter } from "../../../Source/AgentSystem/WebSocket/AgentCallbackRunEventWriter.js";
import { AgentOneBot11ChannelAdapter } from "../../../Source/AgentSystem/Channels/Adapters/AgentOneBot11ChannelAdapter.js";
import { agentOneBot11ClientPath } from "../../../Source/AgentSystem/Channels/AgentChannelClientRoutes.js";
import { AgentLocalAdminAccountStore } from "../../../Source/AgentSystem/Auth/AgentLocalAdminAccount.js";
import { AgentWorkspaceCatalog } from "../../../Source/AgentSystem/WorkspaceResources/AgentWorkspaceCatalog.js";
import { AgentUploadStore } from "../../../Source/AgentSystem/Uploads/AgentUploadStore.js";
import { resolveUploadsConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import { ingestAgentChannelAttachment } from "../../../Source/AgentSystem/Channels/AgentChannelAttachmentIngestor.js";
import type { AgentChannelInboundMessage } from "../../../Source/AgentSystem/Channels/AgentChannelTypes.js";
import { AgentResourceResolver } from "../../../Source/AgentSystem/Resources/AgentResourceResolver.js";
import { AgentOneBot11MessageStore } from "../../../Source/AgentSystem/Channels/Adapters/AgentOneBot11MessageStore.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

test("one listener hosts the built-in client, media and authenticated OneBot traffic", async () => {
  const host = await createHost();
  const entry = await fetch(`${host.origin}${host.clientPath}`, { headers: { Cookie: host.cookie } });
  expect(entry.status).toBe(200);
  const html = await entry.text();
  expect(html).toContain('meta name="senera-qq-options-key"');
  expect(html).toContain('rel="license"');
  expect(html).toContain('<meta name="senera-time-zone" content="Asia/Shanghai">');
  expect(html).toContain('<meta name="senera-console-path" content="/">');
  const versionRoot = /<base href="([^"]+)"/u.exec(html)![1]!;
  expect(versionRoot).toMatch(/\/releases\/[a-f0-9]{64}\/qq\/$/u);
  const buildRoot = new URL("../", `${host.origin}${versionRoot}`).href;
  const pinnedAsset = await fetch(`${buildRoot}assets/client.js`, { headers: { Cookie: host.cookie } });
  expect(await pinnedAsset.text()).toBe("window.clientLoaded = true;");
  const source = await fetch(`${buildRoot}source.tar.gz`, { headers: { Cookie: host.cookie }, redirect: "manual" });
  expect(source.status).toBe(302);
  expect(source.headers.get("location")).toBe("https://example.com/client-source.tar.gz");
  const missingRelease = await fetch(`${host.origin}${host.clientPath}releases/${"f".repeat(64)}/assets/client.js`, {
    headers: { Cookie: host.cookie },
  });
  expect(missingRelease.status).toBe(404);
  const asset = await fetch(`${host.origin}${host.clientPath}assets/client.js`, { headers: { Cookie: host.cookie } });
  expect(await asset.text()).toBe("window.clientLoaded = true;");
  expect((await fetch(`${host.origin}${host.clientPath}`)).status).toBe(401);
  expect((await fetch(`${host.origin}${host.clientPath}assets/client.js`)).status).toBe(401);
  const unauthorized = new WebSocket(`${host.wsOrigin}${host.clientPath}socket`, { origin: host.origin });
  cleanups.push(async () => unauthorized.terminate());
  const rejected = once(unauthorized, "unexpected-response");
  unauthorized.on("error", () => undefined);
  const [, response] = await rejected;
  expect(response.statusCode).toBe(401);
  response.resume();
  unauthorized.terminate();

  const socket = new WebSocket(`${host.wsOrigin}${host.clientPath}socket`, {
    origin: host.origin,
    headers: { Cookie: host.cookie },
  });
  cleanups.push(async () => socket.terminate());
  const frames: Array<Record<string, unknown>> = [];
  socket.on("message", (data) => frames.push(JSON.parse(data.toString())));
  await once(socket, "open");
  socket.send(JSON.stringify({ action: "get_login_info", echo: "login" }));
  await vi.waitFor(() =>
    expect(frames.find((frame) => frame.echo === "login")).toMatchObject({
      status: "ok",
      data: { user_id: host.operatorId, nickname: "Test user" },
    }),
  );
  const bytes = await fs.readFile(path.resolve("Apps/Desktop/Assets/senera-icon.png"));
  socket.send(
    JSON.stringify({
      action: "send_private_msg",
      echo: "image",
      params: {
        user_id: host.selfId,
        message: [
          { type: "text", data: { text: "image and text" } },
          { type: "image", data: { file: `base64://${bytes.toString("base64")}` } },
        ],
      },
    }),
  );
  await vi.waitFor(() => expect(frames.find((frame) => frame.echo === "image")).toMatchObject({ status: "ok" }));
  await vi.waitFor(() => expect(host.inbound).toHaveLength(1));
  expect(host.inbound[0]).toMatchObject({
    text: expect.stringContaining("image and text"),
    attachments: [{ inlineData: { data: bytes.toString("base64") } }],
  });
  socket.send(JSON.stringify({ action: "get_msg", echo: "stored", params: { message_id: 1 } }));
  await vi.waitFor(() => expect(frames.find((frame) => frame.echo === "stored")).toBeDefined());
  const stored = frames.find((frame) => frame.echo === "stored")!;
  const media = (stored.data as { message: Array<{ type: string; data: { url?: string } }> }).message.find(
    (part) => part.type === "image",
  )!.data.url!;
  expect(media).toMatch(new RegExp(`^${host.clientPath}media/`));
  const image = await fetch(`${host.origin}${media}`, { headers: { Cookie: host.cookie } });
  expect(image.status).toBe(200);
  expect(Buffer.from(await image.arrayBuffer())).toEqual(bytes);
  expect((await fetch(`${host.origin}${media}`)).status).toBe(401);
  const missingPath = agentOneBot11ClientPath(randomUUID());
  expect((await fetch(`${host.origin}${missingPath}`, { headers: { Cookie: host.cookie } })).status).toBe(404);
  await host.server.stop();
  await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.CLOSED));
});

test("optional client installation uses host authentication and CSRF without changing the channel", async () => {
  const host = await createHost();
  const url = `${host.origin}${host.clientPath}extension`;
  expect((await fetch(url)).status).toBe(401);
  expect((await fetch(url, { method: "DELETE", headers: { Cookie: host.cookie, Origin: host.origin } })).status).toBe(
    403,
  );
  const headers = { Cookie: host.cookie, Origin: host.origin, "X-Senera-Csrf": host.csrfToken };
  const removed = await fetch(url, { method: "DELETE", headers });
  expect(removed.status).toBe(200);
  expect(await removed.json()).toMatchObject({ installed: false });
  expect((await fetch(`${host.origin}${host.clientPath}`, { headers })).status).toBe(404);
  const archive = qqClientArchive().archive;
  const installed = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/zip" },
    body: new Uint8Array(archive),
  });
  expect(installed.status).toBe(200);
  expect(await installed.json()).toMatchObject({ installed: true });
  expect((await fetch(`${host.origin}${host.clientPath}`, { headers })).status).toBe(200);
  const client = await openClient(host, host.clientPath);
  client.socket.send(JSON.stringify({ action: "get_login_info", echo: "still-connected" }));
  await vi.waitFor(() =>
    expect(client.frames.find((frame) => frame.echo === "still-connected")).toMatchObject({ status: "ok" }),
  );
});

test("normal client documents stay on installed assets even when the host has a development frontend", async () => {
  const host = await createHost({ developmentFrontendUrl: "http://127.0.0.1:1" });
  const response = await fetch(`${host.origin}${host.clientPath}`, { headers: { Cookie: host.cookie } });
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toMatch(/releases\/[a-f0-9]{64}\/qq\//u);
  expect(html).not.toContain("@vite/client");
});

test("workspaces share client installation, updates and removal while retaining pinned releases", async () => {
  const host = await createHost();
  const other = await host.addWorkspace(await fs.mkdtemp(path.join(host.root, "workspace-")));
  const headers = { Cookie: host.cookie, Origin: host.origin, "X-Senera-Csrf": host.csrfToken };
  const firstUrl = `${host.origin}${host.clientPath}`;
  const otherUrl = `${host.origin}${other.clientPath}`;
  const entry = await fetch(otherUrl, { headers });
  expect(entry.status).toBe(200);
  const oldBase = /<base href="([^"]+)"/u.exec(await entry.text())![1]!;
  const oldEntry = new URL("index.html", `${host.origin}${oldBase}`);
  const initial = qqClientArchive();

  expect((await fetch(`${firstUrl}extension`, { method: "DELETE", headers })).status).toBe(200);
  expect(await (await fetch(`${otherUrl}extension`, { headers })).json()).toMatchObject({ installed: false });
  expect((await fetch(oldEntry, { headers })).status).toBe(404);
  expect((await fetch(otherUrl, { headers })).status).toBe(404);

  const install = await fetch(`${firstUrl}extension`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/zip" },
    body: new Uint8Array(initial.archive),
  });
  expect(install.status).toBe(200);
  expect(await (await fetch(`${otherUrl}extension`, { headers })).json()).toMatchObject({
    installed: true,
    manifest: { revision: initial.manifest.revision },
  });
  // Both workspace HTTP handlers have now cached the original revision.
  expect((await fetch(firstUrl, { headers })).status).toBe(200);
  expect((await fetch(otherUrl, { headers })).status).toBe(200);

  const updated = qqClientArchive({ "qq/index.html": "<html><head></head><body>shared update</body></html>" });
  expect(
    (
      await fetch(`${otherUrl}extension`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/zip" },
        body: new Uint8Array(updated.archive),
      })
    ).status,
  ).toBe(200);
  expect(await (await fetch(firstUrl, { headers })).text()).toContain("shared update");
  expect(await (await fetch(oldEntry, { headers })).text()).toContain("QQ client");

  expect((await fetch(`${otherUrl}extension`, { method: "DELETE", headers })).status).toBe(200);
  for (const url of [firstUrl, otherUrl]) {
    expect(await (await fetch(`${url}extension`, { headers })).json()).toMatchObject({ installed: false });
    expect((await fetch(`${url}releases/${initial.manifest.revision}/qq/index.html`, { headers })).status).toBe(404);
    expect((await fetch(`${url}conversations`, { headers })).status).toBe(200);
  }
});

test("recent conversations use the same authenticated workspace boundary as message history", async () => {
  const host = await createHost();
  const endpoint = `${host.origin}${host.clientPath}conversations`;
  expect((await fetch(endpoint)).status).toBe(401);
  const headers = { Cookie: host.cookie };
  expect(await (await fetch(endpoint, { headers })).json()).toEqual({ conversations: [] });
  const source = host.adapter.resolveClientSource({ chatType: "direct", chatId: String(host.selfId) });
  await host.adapter.send(source, "Persisted reply");
  const restored = await fetch(endpoint, { headers });
  expect(restored.headers.get("cache-control")).toBe("no-store");
  expect(await restored.json()).toMatchObject({
    conversations: [
      {
        chatType: "direct",
        chatId: String(host.selfId),
        name: "Test assistant",
        latest: { payload: { post_type: "message", message: [{ type: "text", data: { text: "Persisted reply" } }] } },
      },
    ],
  });
});

test("hosted media and component assets cannot traverse outside their respective roots", async () => {
  const host = await createHost();
  const rootSecret = path.join(host.root, "secret.txt");
  await fs.writeFile(rootSecret, "workspace secret");
  // Encoded separators survive URL normalization and exercise the canonical static-file boundary.
  const traversal = await fetch(`${host.origin}${host.clientPath}media/%2e%2e%2fsecret.txt`, {
    headers: { Cookie: host.cookie },
  });
  expect(traversal.status).toBe(404);
  expect(await traversal.text()).not.toContain("workspace secret");
  expect(
    (await fetch(`${host.origin}${host.clientPath}`, { method: "POST", headers: { Cookie: host.cookie } })).status,
  ).toBe(403);
});

test("multiple workspaces use the same listener and stopping one does not interrupt the other", async () => {
  const host = await createHost();
  const listen = vi.spyOn(net.Server.prototype, "listen");
  const secondRoot = await fs.mkdtemp(path.join(host.root, "workspace-"));
  const second = await host.addWorkspace(secondRoot);
  expect(listen).not.toHaveBeenCalled();
  listen.mockRestore();

  const firstClient = await openClient(host, host.clientPath);
  const secondClient = await openClient(host, second.clientPath);
  const firstSource = host.adapter.resolveClientSource({ chatType: "direct", chatId: String(host.selfId) });
  await host.adapter.send(firstSource, "only workspace one");
  await vi.waitFor(() =>
    expect(firstClient.frames.some((frame) => frame.raw_message === "only workspace one")).toBe(true),
  );
  expect(secondClient.frames.some((frame) => frame.raw_message === "only workspace one")).toBe(false);

  await host.adapter.disconnect();
  await vi.waitFor(() => expect(firstClient.socket.readyState).toBe(WebSocket.CLOSED));
  secondClient.socket.send(JSON.stringify({ action: "get_login_info", echo: "still-connected" }));
  await vi.waitFor(() =>
    expect(secondClient.frames.find((frame) => frame.echo === "still-connected")).toMatchObject({
      status: "ok",
      data: { user_id: second.operatorId },
    }),
  );
  expect(second.server.clientCount).toBe(1);
  expect(host.server.clientCount).toBe(0);
});

test("revoked host sessions cannot execute another channel action on an existing socket", async () => {
  const host = await createHost();
  const client = await openClient(host, host.clientPath);
  const logout = await fetch(`${host.origin}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: host.cookie, Origin: host.origin, "x-senera-csrf": host.csrfToken },
  });
  expect(logout.status).toBe(200);
  const closed = once(client.socket, "close");
  client.socket.send(
    JSON.stringify({
      action: "send_private_msg",
      echo: "unauthorized-send",
      params: { user_id: host.selfId, message: "must not run" },
    }),
  );
  const [code] = await closed;
  expect(code).toBe(4401);
  expect(host.inbound).toEqual([]);
  expect(client.frames.find((frame) => frame.echo === "unauthorized-send")).toBeUndefined();
  await vi.waitFor(() => expect(host.server.clientCount).toBe(0));
});

test("the host rate limit rejects channel actions before they reach the protocol", async () => {
  const host = await createHost({ messagesPerMinute: 1 });
  const client = await openClient(host, host.clientPath);
  client.socket.send(JSON.stringify({ action: "get_login_info", echo: "allowed" }));
  await vi.waitFor(() =>
    expect(client.frames.find((frame) => frame.echo === "allowed")).toMatchObject({ status: "ok" }),
  );
  const closed = once(client.socket, "close");
  client.socket.send(
    JSON.stringify({ action: "send_private_msg", params: { user_id: host.selfId, message: "limited" } }),
  );
  const [code, reason] = await closed;
  expect(code).toBe(1013);
  expect(reason.toString()).toBe("rate_limited");
  expect(host.inbound).toEqual([]);
});

async function openClient(host: { wsOrigin: string; origin: string; cookie: string }, clientPath: string) {
  const socket = new WebSocket(`${host.wsOrigin}${clientPath}socket`, {
    origin: host.origin,
    headers: { Cookie: host.cookie },
  });
  cleanups.push(async () => socket.terminate());
  const frames: Array<Record<string, unknown>> = [];
  socket.on("message", (data) => frames.push(JSON.parse(data.toString())));
  await once(socket, "open");
  return { socket, frames };
}

test("channel SVGs preserve relative workspace resolution, bytes and renderable MIME across history", async () => {
  const host = await createHost();
  const relative = "generated/channel-image.svg";
  const bytes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path fill="blue" d="M0 0h8v8H0z"/></svg>',
  );
  await fs.mkdir(path.join(host.root, "generated"));
  await fs.writeFile(path.join(host.root, relative), bytes);
  const resolver = new AgentResourceResolver({
    workspaceRoot: host.root,
    config: { ModelProviders: [] },
    uploadStore: host.uploadStore,
  });
  const resource = await resolver.resolveWorkspacePath(relative);
  expect(resource).toMatchObject({ name: "channel-image.svg", mime: "image/svg+xml", size: bytes.length });
  const source = host.adapter.resolveClientSource({ chatType: "direct", chatId: String(host.selfId) });
  await host.adapter.send(source, "", {
    chatType: "direct",
    media: [
      {
        kind: "image",
        path: resource!.filePath,
        filename: resource!.name,
        contentType: resource!.mime,
        size: resource!.size,
      },
    ],
  });
  const timeline = await host.adapter.readClientTimeline(source);
  const image = timeline.entries.at(-1)!.payload.message as Array<{
    type: string;
    data: { url: string; name: string; content_type: string };
  }>;
  expect(image[0]).toMatchObject({ type: "image", data: { name: resource!.name, content_type: resource!.mime } });
  expect(image[0]!.data.url).toMatch(/\.svg$/u);
  const url = `${host.origin}${image[0]!.data.url}`;
  const response = await fetch(url, { headers: { Cookie: host.cookie } });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/svg+xml");
  expect(response.headers.get("content-disposition")).toContain("channel-image.svg");
  expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  expect((await fetch(url)).status).toBe(401);

  // Old builds stored intact SVGs under a .bin name; their durable message
  // metadata restores the response type without rewriting historical URLs.
  const legacyName = `${randomUUID()}.bin`;
  await fs.writeFile(path.join(host.root, "gateway/media", legacyName), bytes);
  host.messageStore.append({
    direction: "outbound",
    source,
    text: "",
    segments: [{ type: "image", data: { file: `/${legacyName}`, name: resource!.name, content_type: resource!.mime } }],
  });
  const legacy = await fetch(`${host.origin}${host.clientPath}media/${legacyName}`, {
    headers: { Cookie: host.cookie },
  });
  expect(legacy.headers.get("content-type")).toBe("image/svg+xml");
  expect(Buffer.from(await legacy.arrayBuffer())).toEqual(bytes);
});

test("QQ files use authenticated workspace uploads once and keep OneBot frames small", async () => {
  const host = await createHost();
  const { socket, frames } = await openClient(host, host.clientPath);
  const bytes = Buffer.alloc(5 * 1024 * 1024, 0x61);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "text/plain" }), "资料.txt");
  const response = await fetch(`${host.origin}/api/resources?workspaceId=${host.workspaceId}`, {
    method: "POST",
    headers: { Origin: host.origin, Cookie: host.cookie, "X-Senera-Csrf": host.csrfToken },
    body: form,
  });
  expect(response.status).toBe(200);
  const uploaded = ((await response.json()) as { resources: Array<{ resourceUri: string }> }).resources[0]!;
  const wire = JSON.stringify({
    action: "send_private_msg",
    echo: "uploaded-file",
    params: { user_id: host.selfId, message: [{ type: "file", data: { file: uploaded.resourceUri } }] },
  });
  expect(Buffer.byteLength(wire)).toBeLessThan(512);
  socket.send(wire);
  await vi.waitFor(() =>
    expect(frames.find((frame) => frame.echo === "uploaded-file")).toMatchObject({ status: "ok" }),
  );
  await vi.waitFor(() => expect(host.inbound).toHaveLength(1));
  const message = host.inbound[0] as AgentChannelInboundMessage;
  expect(message.attachments).toMatchObject([
    { resourceUri: uploaded.resourceUri, filename: "资料.txt", size: bytes.length },
  ]);
  const save = vi.spyOn(host.uploadStore, "save");
  const reused = await ingestAgentChannelAttachment(host.uploadStore, message.attachments![0]!);
  expect(reused).toMatchObject({ resourceUri: uploaded.resourceUri, size: bytes.length });
  expect(save).not.toHaveBeenCalled();
  host.directory.importLegacyGroups([{ id: "900001", name: "Files" }]);
  socket.send(
    JSON.stringify({
      action: "send_group_msg",
      echo: "group-file",
      params: { group_id: 900001, message: [{ type: "file", data: { file: uploaded.resourceUri } }] },
    }),
  );
  await vi.waitFor(() => expect(frames.find((frame) => frame.echo === "group-file")).toMatchObject({ status: "ok" }));
  await vi.waitFor(() => expect(host.inbound).toHaveLength(2));
  expect(host.inbound[1]).toMatchObject({
    source: { chatType: "group" },
    attachments: [{ resourceUri: uploaded.resourceUri }],
  });
  const id = uploaded.resourceUri.split("/").at(-1);
  const preview = await fetch(`${host.origin}/api/resources/${id}?workspaceId=${host.workspaceId}`, {
    headers: { Cookie: host.cookie },
  });
  expect(preview.status).toBe(200);
  expect(Buffer.from(await preview.arrayBuffer()).equals(bytes)).toBe(true);
  const other = await host.addWorkspace(await fs.mkdtemp(path.join(host.root, "other-")));
  const otherClient = await openClient(host, other.clientPath);
  const foreign = JSON.parse(wire);
  foreign.params.user_id = other.selfId;
  otherClient.socket.send(JSON.stringify(foreign));
  await vi.waitFor(() =>
    expect(otherClient.frames.find((frame) => frame.echo === "uploaded-file")).toMatchObject({ status: "failed" }),
  );
  expect(other.inbound).toEqual([]);
  expect(socket.readyState).toBe(WebSocket.OPEN);
});

async function createHost(options: { messagesPerMinute?: number; developmentFrontendUrl?: string } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-client-host-"));
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
  await seedTestModelsDevCatalog(root);
  const catalog = new AgentWorkspaceCatalog({ stateRoot: path.join(root, "host") });
  const workspaceId = catalog.register(root).id;
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const extensions = await prepareQqClientBuild(root);
  const account = new AgentLocalAdminAccountStore(path.join(root, "admin-account.json"));
  await account.initialize({ loginName: "owner", displayName: "Owner", password: "long test administrator password" });
  const config = {
    Server: {
      Host: "127.0.0.1",
      Port: port,
      AccessControl: {
        Mode: "required" as const,
        AccountFile: "admin-account.json",
        AllowedOrigins: [origin],
        ...(options.messagesPerMinute === undefined
          ? {}
          : { Limits: { MessagesPerMinute: options.messagesPerMinute } }),
      },
    },
    ModelProviders: [],
  };
  const transport = new AgentWebSocketTransport({
    applicationRoot: root,
    config: () => config,
    defaultWorkspaceId: workspaceId,
    catalog,
  });
  cleanups.push(() => transport.stop());

  async function addWorkspace(workspaceRoot = root) {
    const id = catalog.register(workspaceRoot).id;
    const clientPath = agentOneBot11ClientPath(id);
    const runtimeDirectory = path.join(workspaceRoot, "gateway");
    const directory = createTestAgentDirectory("Test assistant");
    const inbound: unknown[] = [];
    const uploadStore = new AgentUploadStore({ workspaceRoot, config: resolveUploadsConfig(config) });
    const messageStore = new AgentOneBot11MessageStore(path.join(runtimeDirectory, "messages.sqlite"));
    cleanups.push(async () => messageStore.close());
    const adapter = new AgentOneBot11ChannelAdapter({
      directory,
      runtimeDirectory,
      resolveOperatorDisplayName: () => "Test user",
      mediaBasePath: `${clientPath}media`,
      uploadStore,
      messageStore,
    });
    adapter.bind({
      onMessage: (message) => {
        inbound.push(message);
      },
      onFatal: (error) => {
        throw error;
      },
    });
    await adapter.connect(new AbortController().signal);
    cleanups.push(() => adapter.disconnect());
    const server = new AgentWebSocketServer({
      transport,
      workspaceId: id,
      workspaceRoot,
      config,
      uploadStore,
      sessionManager: {} as never,
      userProfileManager: {} as never,
      eventWriter: new AgentCallbackRunEventWriter(vi.fn()),
      channelClient: {
        resourcesRoot: root,
        developmentFrontendUrl: options.developmentFrontendUrl,
        extensions,
        product: { version: "1.0.0" },
        mediaRoot: path.join(runtimeDirectory, "media"),
        resolveMediaMetadata: (name) => messageStore.mediaMetadata(name),
        conversations: {
          readClientConversations: () => adapter.readClientConversations(),
          resolveClientConversation: vi.fn(),
          clearClientConversation: vi.fn(),
          readClientTimeline: vi.fn(),
          deleteClientTask: vi.fn(),
        },
      },
      channelControl: {
        statuses: [],
        connectChannel: async () => undefined,
        connectOneBot11Client: (socket, request) => adapter.connectClient(socket, request),
      },
    });
    await server.start();
    cleanups.push(() => server.stop());
    return {
      adapter,
      server,
      directory,
      clientPath,
      inbound,
      uploadStore,
      workspaceId: id,
      messageStore,
      operatorId: directory.snapshot().operatorId!,
      selfId: directory.get().qqUserId!,
    };
  }

  const workspace = await addWorkspace();
  await transport.start();
  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ loginName: "owner", password: "long test administrator password" }),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  return {
    ...workspace,
    root,
    origin,
    wsOrigin: origin.replace("http:", "ws:"),
    cookie,
    csrfToken: ((await login.json()) as { session: { csrfToken: string } }).session.csrfToken,
    addWorkspace,
    transport,
  };
}

async function reservePort(): Promise<number> {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port.");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
