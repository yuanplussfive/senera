import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { once } from "node:events";
import { WebSocket } from "ws";
import { expect, test } from "vitest";
import { startSeneraServer, SeneraServerDeployments, type SeneraServerHandle } from "../../../Apps/ServerRuntime.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";

test("real workspace opening shares configuration, keeps the listener and survives an invalid target", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-workspace-host-"));
  const a = path.join(root, "a"),
    b = path.join(root, "b");
  let app: SeneraServerHandle | undefined;
  const sockets: WebSocket[] = [];
  try {
    await Promise.all([fs.mkdir(a), fs.mkdir(b)]);
    const portProbe = net.createServer();
    portProbe.listen(0, "127.0.0.1");
    await once(portProbe, "listening");
    const address = portProbe.address();
    if (!address || typeof address === "string") throw new Error("No test port.");
    await new Promise<void>((resolve) => portProbe.close(() => resolve()));
    await fs.writeFile(
      path.join(a, "senera.config.json"),
      JSON.stringify({
        ConfigVersion: CurrentAgentConfigVersion,
        Server: { Host: "127.0.0.1", Port: address.port, HotReload: false },
        ModelProviderEndpoints: [{ Id: "local-test", BaseUrl: "http://127.0.0.1:1/v1" }],
        ModelProviders: [{ Id: "test", ProviderId: "local-test", Endpoint: "ChatCompletions", Model: "test" }],
        ContinuityLearning: { Enabled: false },
        Extensions: { "workspace-tools": { Enabled: true } },
      }),
    );
    app = await startSeneraServer({
      workspaceRoot: a,
      applicationStateRoot: path.join(root, "application"),
      configPath: path.join(a, "senera.config.json"),
      deployment: SeneraServerDeployments.Local,
      automaticLoopbackHttp: true,
    });
    await expect(app.switchWorkspace(path.join(root, "missing"))).rejects.toThrow();
    expect((await fetch(app.healthUrl)).status).toBe(200);
    const [next, concurrent] = await Promise.all([app.switchWorkspace(b), app.switchWorkspace(b)]);
    expect(next.websocketUrl).toBe(concurrent.websocketUrl);
    expect(new URL(next.websocketUrl).origin).toBe(new URL(app.websocketUrl).origin);
    expect(next.configPath).toBe(app.configPath);
    const storage = await (await fetch(new URL("/api/application-storage", app.healthUrl))).json();
    expect(storage.root).toBe(path.join(root, "application"));
    expect(storage.workspaces).toHaveLength(2);
    for (const handle of [app, next]) {
      const workspaceId = new URL(handle.websocketUrl).searchParams.get("workspaceId")!;
      const stateRoot = path.join(root, "application", ".senera", "workspaces", workspaceId);
      expect(
        JSON.parse(await fs.readFile(path.join(stateRoot, "data", "continuity-identity.json"), "utf8")),
      ).toMatchObject({ workspaceId });
      await fs.access(path.join(stateRoot, "data", "sessions", "sessions.sqlite"));
      await expect(
        fs.access(path.join(handle.workspaceRoot, ".senera", "data", "sessions", "sessions.sqlite")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
    const storedResources: { handle: SeneraServerHandle; resourceUri: string; text: string }[] = [];
    for (const [handle, text] of [
      [app, "workspace A attachment"],
      [next, "workspace B attachment"],
    ] as const) {
      const uploadUrl = new URL("/api/resources", handle.healthUrl);
      uploadUrl.search = new URL(handle.websocketUrl).search;
      const form = new FormData();
      form.append("file", new Blob([text], { type: "text/plain" }), "notes.txt");
      const response = await fetch(uploadUrl, { method: "POST", body: form });
      expect(response.status).toBe(200);
      const payload = await response.json();
      storedResources.push({ handle, resourceUri: payload.resources[0].resourceUri, text });
    }
    for (const { handle, resourceUri, text } of storedResources) {
      const resourcePath = `/api/resources${new URL(resourceUri).pathname}`;
      const contentUrl = new URL(resourcePath, handle.healthUrl);
      contentUrl.search = new URL(handle.websocketUrl).search;
      expect(await (await fetch(contentUrl)).text()).toBe(text);
      expect((await fetch(contentUrl, { method: "HEAD" })).status).toBe(200);
      const other = handle === app ? next : app;
      contentUrl.search = new URL(other.websocketUrl).search;
      expect((await fetch(contentUrl)).status).toBe(404);
      contentUrl.search = new URL(handle.websocketUrl).search;
      contentUrl.searchParams.set("unexpected", "query");
      expect((await fetch(contentUrl)).status).toBe(404);
    }
    await expect(fs.access(path.join(b, "senera.config.json"))).rejects.toMatchObject({ code: "ENOENT" });
    const values = [];
    for (const handle of [app, next]) {
      const socket = new WebSocket(handle.websocketUrl);
      sockets.push(socket);
      await once(socket, "open");
      const config = new Promise<unknown>((resolve) =>
        socket.on("message", (data) => {
          const event = JSON.parse(data.toString());
          if (event.kind === "config.snapshot") resolve(event.data.value);
        }),
      );
      socket.send(JSON.stringify({ type: "config.get" }));
      values.push(await config);
    }
    expect(values[0]).toEqual(values[1]);
    expect((await app.switchWorkspace(a)).websocketUrl).toBe(app.websocketUrl);
    const restoredUrl = next.websocketUrl;
    for (const socket of sockets.splice(0)) socket.terminate();
    await app.stop();
    app = await startSeneraServer({
      workspaceRoot: a,
      applicationStateRoot: path.join(root, "application"),
      configPath: path.join(a, "senera.config.json"),
      deployment: SeneraServerDeployments.Local,
      automaticLoopbackHttp: true,
    });
    const restored = new WebSocket(restoredUrl);
    sockets.push(restored);
    const workspace = new Promise<unknown>((resolve) =>
      restored.on("message", (data) => {
        const event = JSON.parse(data.toString());
        if (event.kind === "workspace.snapshot") resolve(event.data);
      }),
    );
    await once(restored, "open");
    restored.send(JSON.stringify({ type: "workspace.get" }));
    expect(await workspace).toMatchObject({ workspaceRoot: b, configPath: app.configPath, websocketUrl: restoredUrl });
  } finally {
    for (const socket of sockets) socket.terminate();
    await app?.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
