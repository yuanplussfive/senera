import { AgentServerAccessProfiles } from "../../../Source/AgentSystem/Auth/AgentServerAccessPolicy.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { expect, test, vi } from "vitest";
import { AgentWebSocketServer } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketServer.js";
import { AgentWebSocketTransport } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketTransport.js";
import { AgentCallbackRunEventWriter } from "../../../Source/AgentSystem/WebSocket/AgentCallbackRunEventWriter.js";
import { AgentUserProfileManager } from "../../../Source/AgentSystem/Session/AgentUserProfile.js";
import { InMemorySessionRepository } from "../../../Source/AgentSystem/SessionPersistence/InMemorySessionRepository.js";
import type { AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import type { AgentSessionManager } from "../../../Source/AgentSystem/Session/AgentSessionManager.js";
import {
  AgentWorkspaceCatalog,
  AgentWorkspaceInUseError,
} from "../../../Source/AgentSystem/WorkspaceResources/AgentWorkspaceCatalog.js";
import { AgentWorkspaceCatalogRoute } from "../../../Source/AgentSystem/WorkspaceResources/AgentWorkspaceCatalogContract.js";
import {
  AgentWebSocketCloseCodes,
  AgentWebSocketCloseReasons,
} from "../../../Source/AgentSystem/WebSocket/AgentWebSocketCloseContract.js";
import { AgentControlWebSocketPath } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketRoutes.js";

test("unknown scopes close permanently and the application catalog remains accessible without opening a workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-workspace-recovery-"));
  const catalog = new AgentWorkspaceCatalog({ stateRoot: path.join(root, ".senera") });
  const workspace = catalog.register(root);
  const missing = randomUUID();
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("No test port.");
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const openWorkspace = vi.fn(async () => undefined);
  const config = { Server: { Host: "127.0.0.1", Port: address.port }, ModelProviders: [] };
  const transport = new AgentWebSocketTransport({
    applicationRoot: root,
    config: () => config,
    defaultWorkspaceId: workspace.id,
    catalog,
    openWorkspace,
    accessProfile: AgentServerAccessProfiles.Development,
  });
  let socket: WebSocket | undefined;
  try {
    await transport.start();
    const origin = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${origin}${AgentWorkspaceCatalogRoute}?workspaceId=${missing}`, {
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
    expect(await response.json()).toEqual({ workspaces: [workspace], defaultWorkspaceId: workspace.id });
    expect(openWorkspace).not.toHaveBeenCalled();
    const invalid = await fetch(`${origin}/api/resources?workspaceId=${missing}`);
    expect(invalid.status).toBe(404);
    expect(await invalid.json()).toMatchObject({
      ok: false,
      error: { code: "workspace_not_found", workspaceId: missing },
    });
    socket = new WebSocket(`ws://127.0.0.1:${address.port}/?workspaceId=${missing}`);
    const closed = once(socket, "close");
    await once(socket, "open");
    const [code, reason] = await closed;
    expect(code).toBe(AgentWebSocketCloseCodes.WorkspaceNotFound);
    expect(reason.toString()).toBe(AgentWebSocketCloseReasons.WorkspaceNotFound);
    expect(openWorkspace).not.toHaveBeenCalled();
    expect((await fetch(`${origin}/health/ready`)).status).toBe(200);
    expect((await fetch(`${origin}${AgentWorkspaceCatalogRoute}`, { method: "POST" })).status).toBe(405);
    expect(
      (await fetch(`${origin}${AgentWorkspaceCatalogRoute}`, { headers: { Origin: "https://untrusted.example" } }))
        .status,
    ).toBe(403);
  } finally {
    socket?.terminate();
    await transport.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("one transport isolates workspace events and files while sharing application notifications", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-workspace-transport-"));
  const a = path.join(root, "a"),
    b = path.join(root, "b");
  await Promise.all([fs.mkdir(a), fs.mkdir(b)]);
  await Promise.all([
    fs.writeFile(path.join(a, "sample.txt"), "workspace a"),
    fs.writeFile(path.join(b, "sample.txt"), "workspace b"),
  ]);
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("No test port.");
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const port = address.port,
    aId = randomUUID(),
    bId = randomUUID();
  const config = { Server: { Host: "127.0.0.1", Port: port }, ModelProviders: [] };
  let finishRun!: () => void;
  const runFinished = new Promise<void>((resolve) => {
    finishRun = resolve;
  });
  const sessionManager = {
    submitMessage: async (request: Parameters<AgentSessionManager["submitMessage"]>[0]) => {
      const context = { sessionId: request.sessionId, requestId: request.requestId!, step: 1 };
      await request.onEvent?.({ kind: "run.started", context, data: { input: request.input } });
      await request.onEvent?.({ kind: "model.delta", context, data: { text: "streaming from the phone" } });
      await runFinished;
      await request.onEvent?.({ kind: "run.completed", context, data: {} });
    },
    replayHistory: async (request: Parameters<AgentSessionManager["replayHistory"]>[0]) => {
      await request.onEvent?.({
        kind: "session.history.completed",
        context: { sessionId: request.sessionId },
        data: { sessionId: request.sessionId },
      });
    },
    closeSession: async (request: Parameters<AgentSessionManager["closeSession"]>[0]) => {
      await request.onEvent?.({
        kind: "session.not_found",
        context: { sessionId: request.sessionId },
        data: { sessionId: request.sessionId, operation: "session.close", message: "No such session" },
      });
    },
  };
  const common = {
    config,
    accessProfile: AgentServerAccessProfiles.Development,
    sessionManager: sessionManager as unknown as AgentSessionManager,
    userProfileManager: {} as never,
    eventWriter: new AgentCallbackRunEventWriter(vi.fn()),
  };
  const transport = new AgentWebSocketTransport({
    applicationRoot: root,
    config: () => config,
    defaultWorkspaceId: aId,
    accessProfile: AgentServerAccessProfiles.Development,
  });
  const primary = new AgentWebSocketServer({
    ...common,
    workspaceRoot: a,
    workspaceId: aId,
    transport,
    userProfileManager: new AgentUserProfileManager(new InMemorySessionRepository()),
  });
  const secondary = new AgentWebSocketServer({ ...common, workspaceRoot: b, workspaceId: bId, transport });
  const sockets: WebSocket[] = [];
  try {
    await primary.start();
    await secondary.start();
    await transport.start();
    const messagesA: { kind: string; data: unknown }[] = [],
      messagesB: { kind: string; data: unknown }[] = [];
    for (const [id, messages] of [
      [aId, messagesA],
      [bId, messagesB],
    ] as const) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}${AgentControlWebSocketPath}?workspaceId=${id}`);
      sockets.push(socket);
      socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
      await once(socket, "open");
    }
    const event: AgentDomainEvent = {
      kind: "run.started",
      context: { requestId: "request-a" },
      data: { input: "hello" },
    };
    await primary.broadcast(event);
    await primary.broadcastApplication({
      kind: "config.reloaded",
      context: {},
      data: { configPath: "shared", revision: 1, diagnostics: [] },
    });
    await vi.waitFor(() => {
      expect(messagesA.some((message) => message.kind === "config.reloaded")).toBe(true);
      expect(messagesB.some((message) => message.kind === "config.reloaded")).toBe(true);
    });
    expect(messagesA.some((message) => message.kind === "run.started")).toBe(true);
    expect(messagesB.some((message) => message.kind === "run.started")).toBe(false);
    const peer = new WebSocket(`ws://127.0.0.1:${port}/?workspaceId=${aId}`);
    sockets.push(peer);
    const peerMessages: { kind: string; data: unknown }[] = [];
    peer.on("message", (data) => peerMessages.push(JSON.parse(data.toString())));
    await once(peer, "open");
    sockets[0]!.send(
      JSON.stringify({ type: "profile.update", profile: { name: "Updated operator", avatarPath: null } }),
    );
    await vi.waitFor(() => {
      expect(messagesA).toContainEqual(
        expect.objectContaining({
          kind: "profile.snapshot",
          data: expect.objectContaining({ name: "Updated operator" }),
        }),
      );
      expect(peerMessages).toContainEqual(
        expect.objectContaining({
          kind: "profile.snapshot",
          data: expect.objectContaining({ name: "Updated operator" }),
        }),
      );
    });
    expect(messagesB.some((message) => message.kind === "profile.snapshot")).toBe(false);
    const requestId = randomUUID();
    peer.send(
      JSON.stringify({
        type: "session.message",
        sessionId: "shared-session",
        requestId,
        input: "from phone",
        approvalMode: "agent",
      }),
    );
    await vi.waitFor(() => {
      for (const messages of [messagesA, peerMessages]) {
        expect(messages.filter((message) => message.kind === "model.delta")).toHaveLength(1);
        expect(messages.some((message) => message.kind === "run.completed")).toBe(false);
      }
    });
    expect(messagesB.some((message) => message.kind === "model.delta")).toBe(false);
    finishRun();
    await vi.waitFor(() => {
      for (const messages of [messagesA, peerMessages])
        expect(messages.some((message) => message.kind === "run.completed")).toBe(true);
    });
    peer.send(JSON.stringify({ type: "session.history", sessionId: "shared-session" }));
    await vi.waitFor(() =>
      expect(peerMessages.some((message) => message.kind === "session.history.completed")).toBe(true),
    );
    expect(messagesA.some((message) => message.kind === "session.history.completed")).toBe(false);
    expect(messagesB.some((message) => message.kind === "session.history.completed")).toBe(false);
    peer.send(JSON.stringify({ type: "session.close", sessionId: "missing-session" }));
    await vi.waitFor(() => expect(peerMessages.some((message) => message.kind === "session.not_found")).toBe(true));
    expect(messagesA.some((message) => message.kind === "session.not_found")).toBe(false);
    expect(messagesB.some((message) => message.kind === "session.not_found")).toBe(false);
    for (const [id, content] of [
      [aId, "workspace a"],
      [bId, "workspace b"],
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/resources?workspaceId=${id}&path=sample.txt`);
      expect(await response.json()).toMatchObject({ resource: { content } });
    }
    const invalidSwitchRequestId = randomUUID();
    sockets[1]!.send(
      JSON.stringify({ type: "workspace.switch", requestId: invalidSwitchRequestId, workspaceRoot: 42 }),
    );
    await vi.waitFor(() => {
      expect(messagesB).toContainEqual(
        expect.objectContaining({
          kind: "workspace.switch.failed",
          data: expect.objectContaining({
            requestId: invalidSwitchRequestId,
            localizedMessage: expect.objectContaining({ key: "websocket.requestInvalid" }),
          }),
        }),
      );
    });
    expect(messagesA.some((message) => message.kind === "workspace.switch.failed")).toBe(false);
    await secondary.stop();
    expect((await fetch(`http://127.0.0.1:${port}/health/ready`)).status).toBe(200);
    await primary.stop();
    expect((await fetch(`http://127.0.0.1:${port}/health/ready`)).status).toBe(200);
  } finally {
    finishRun();
    for (const socket of sockets) socket.terminate();
    await secondary.stop();
    await primary.stop();
    await transport.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("catalog DELETE forgets a registration without deleting its workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-workspace-forget-"));
  const child = path.join(root, "child");
  await fs.mkdir(child);
  const catalog = new AgentWorkspaceCatalog({ stateRoot: path.join(root, ".senera") });
  const primary = catalog.register(root);
  const forgotten = catalog.register(child);
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("No test port.");
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const config = { Server: { Host: "127.0.0.1", Port: address.port }, ModelProviders: [] };
  const transport = new AgentWebSocketTransport({
    applicationRoot: root,
    config: () => config,
    defaultWorkspaceId: primary.id,
    catalog,
    accessProfile: AgentServerAccessProfiles.Development,
    forgetWorkspace: async (id) => {
      if (id === primary.id) throw new AgentWorkspaceInUseError(id);
      catalog.forget(id);
      return { workspaces: [...catalog.list()], defaultWorkspaceId: primary.id };
    },
  });
  try {
    await transport.start();
    const origin = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${origin}${AgentWorkspaceCatalogRoute}?workspaceId=${forgotten.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ workspaces: [primary], defaultWorkspaceId: primary.id });
    await fs.access(child);
    const protectedResponse = await fetch(`${origin}${AgentWorkspaceCatalogRoute}?workspaceId=${primary.id}`, {
      method: "DELETE",
    });
    expect(protectedResponse.status).toBe(409);
  } finally {
    await transport.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});
