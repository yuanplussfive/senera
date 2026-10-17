import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { once } from "node:events";
import { WebSocket } from "ws";
import { expect, test } from "vitest";
import { startSeneraServer, SeneraServerDeployments, type SeneraServerHandle } from "../../../Apps/ServerRuntime.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";
import { removeAgentPathWithRetry } from "../../../Source/AgentSystem/Core/AgentFs.js";

test("real workspace opening isolates configuration, keeps the listener and survives an invalid target", async () => {
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
    expect(next.configPath).toBe(path.join(b, "senera.config.json"));
    const storage = await (await fetch(new URL("/api/application-storage", app.healthUrl))).json();
    expect(storage.root).toBe(path.join(root, "application"));
    expect(storage.scope).toBe("application-state");
    expect(storage.projectScanIncluded).toBe(false);
    expect(storage.workspaces).toHaveLength(2);
    expect(
      storage.workspaces.every(
        (workspace: { scope: string; stateRoot: string }) =>
          workspace.scope === "workspace-state" && workspace.stateRoot.endsWith(path.join(".senera")),
      ),
    ).toBe(true);
    const projectStorage = await (await fetch(new URL("/api/application-storage?scope=project", app.healthUrl))).json();
    expect(projectStorage.projectScanIncluded).toBe(true);
    expect(
      projectStorage.workspaces.every(
        (workspace: { projectBytes?: number }) => typeof workspace.projectBytes === "number",
      ),
    ).toBe(true);
    for (const handle of [app, next]) {
      const workspaceId = new URL(handle.websocketUrl).searchParams.get("workspaceId")!;
      const stateRoot = path.join(handle.workspaceRoot, ".senera");
      expect(
        JSON.parse(await fs.readFile(path.join(stateRoot, "data", "continuity-identity.json"), "utf8")),
      ).toMatchObject({ workspaceId });
      await fs.access(path.join(stateRoot, "data", "sessions", "sessions.sqlite"));
      await fs.access(path.join(handle.workspaceRoot, ".senera", "data", "sessions", "sessions.sqlite"));
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
    await fs.access(path.join(b, "senera.config.json"));
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
    expect(values[0]).not.toEqual(values[1]);
    const additionalA = new WebSocket(app.websocketUrl);
    sockets.push(additionalA);
    await once(additionalA, "open");
    const switchedRuntime = await app.switchWorkspace(b);
    expect(switchedRuntime.workspaceRoot).toBe(b);
    expect(sockets[0]!.readyState).toBe(WebSocket.OPEN);
    const oldWorkspaceClosed = once(sockets[0]!, "close");
    sockets[0]!.close();
    await oldWorkspaceClosed;
    expect(additionalA.readyState).toBe(WebSocket.OPEN);
    const finalWorkspaceClosed = once(additionalA, "close");
    additionalA.close();
    await finalWorkspaceClosed;
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
    expect(await workspace).toMatchObject({
      workspaceRoot: b,
      configPath: path.join(b, "senera.config.json"),
      websocketUrl: restoredUrl,
    });
  } finally {
    for (const socket of sockets) socket.terminate();
    await app?.stop();
    await removeAgentPathWithRetry(root, { recursive: true });
  }
}, 30_000);

test("keeps nested JSON configuration inside workspace roots with spaces and Unicode", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera 工作区 host "));
  const a = path.join(root, "初始 工作区"),
    b = path.join(root, "另一个 工作区");
  const configRelativePath = path.join("configs", "profiles", "runtime.json");
  let app: SeneraServerHandle | undefined;
  try {
    await Promise.all([fs.mkdir(path.join(a, "configs", "profiles"), { recursive: true }), fs.mkdir(b)]);
    const portProbe = net.createServer();
    portProbe.listen(0, "127.0.0.1");
    await once(portProbe, "listening");
    const address = portProbe.address();
    if (!address || typeof address === "string") throw new Error("No test port.");
    await new Promise<void>((resolve) => portProbe.close(() => resolve()));
    await fs.writeFile(
      path.join(a, configRelativePath),
      JSON.stringify({
        ConfigVersion: CurrentAgentConfigVersion,
        Server: { Host: "127.0.0.1", Port: address.port, HotReload: false },
        ModelProviderEndpoints: [{ Id: "local-test", BaseUrl: "http://127.0.0.1:1/v1" }],
        ModelProviders: [{ Id: "test", ProviderId: "local-test", Endpoint: "ChatCompletions", Model: "test" }],
        ContinuityLearning: { Enabled: false },
      }),
    );
    app = await startSeneraServer({
      workspaceRoot: a,
      applicationStateRoot: path.join(root, "application"),
      configPath: configRelativePath,
      deployment: SeneraServerDeployments.Local,
      automaticLoopbackHttp: true,
    });
    const next = await app.switchWorkspace(b);
    expect(app.configPath).toBe(path.join(a, configRelativePath));
    expect(next.configPath).toBe(path.join(b, configRelativePath));
    await fs.access(next.configPath);
    expect(next.configPath.startsWith(path.join(root, "application"))).toBe(false);
  } finally {
    await app?.stop();
    await removeAgentPathWithRetry(root, { recursive: true });
  }
}, 30_000);
