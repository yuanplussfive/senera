import { describe, expect, test, vi } from "vitest";
import type { AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentLocalizedError } from "../../../Source/AgentSystem/I18n/AgentLocalizedError.js";
import { AgentWebSocketRequestSchema } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketProtocol.js";
import { AgentWebSocketWorkspaceRequestHandlers } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketWorkspaceRequestHandlers.js";

const workspaceSnapshot = {
  workspaceId: "d86cbfc3-9535-4c2c-b150-5343c289f285",
  workspaces: [],
  capabilities: { browseDirectories: true },
  workspaceRoot: "E:\\senera",
  configPath: "E:\\senera\\senera.config.json",
  websocketUrl: "ws://127.0.0.1:29123/ws",
};

describe("Workspace WebSocket projection", () => {
  test("returns the current workspace snapshot for workspace.get", async () => {
    const send = vi.fn(async (_event: AgentDomainEvent) => undefined);
    const handlers = new AgentWebSocketWorkspaceRequestHandlers({ workspaceInfo: () => workspaceSnapshot });

    await handlers.get({ type: "workspace.get" }, send);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "workspace.snapshot",
        context: {},
        data: workspaceSnapshot,
      }),
    );
  });

  test("rejects workspace.get when the context exposes no workspace info", async () => {
    const send = vi.fn(async (_event: AgentDomainEvent) => undefined);
    const handlers = new AgentWebSocketWorkspaceRequestHandlers({});

    await expect(handlers.get({ type: "workspace.get" }, send)).rejects.toBeInstanceOf(AgentLocalizedError);
    expect(send).not.toHaveBeenCalled();
  });

  test("reports switch progress only to its requesting client", async () => {
    const switchWorkspace = vi.fn(async () => ({
      ...workspaceSnapshot,
      workspaceRoot: "E:\\other",
      configPath: "E:\\other\\senera.config.json",
      websocketUrl: "ws://127.0.0.1:29123/ws",
    }));
    const send = vi.fn(async (_event: AgentDomainEvent) => undefined);
    const handlers = new AgentWebSocketWorkspaceRequestHandlers({ workspaceSwitchRequest: switchWorkspace });

    await handlers.switch({ type: "workspace.switch", requestId: "open-1", workspaceRoot: "E:\\other" }, send);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "workspace.switch.started",
        data: { requestId: "open-1", workspaceRoot: "E:\\other" },
      }),
    );
    expect(switchWorkspace).toHaveBeenCalledWith("E:\\other");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "workspace.switched",
        data: {
          ...workspaceSnapshot,
          requestId: "open-1",
          workspaceRoot: "E:\\other",
          configPath: "E:\\other\\senera.config.json",
          websocketUrl: "ws://127.0.0.1:29123/ws",
        },
      }),
    );
  });

  test("reports a localized failure when the workspace switch throws", async () => {
    const switchWorkspace = vi.fn(async () => {
      throw new AgentLocalizedError("websocket.workspaceSwitchFailed", { workspaceRoot: "E:\\other" });
    });
    const send = vi.fn(async (_event: AgentDomainEvent) => undefined);
    const handlers = new AgentWebSocketWorkspaceRequestHandlers({ workspaceSwitchRequest: switchWorkspace });

    await handlers.switch({ type: "workspace.switch", requestId: "open-2", workspaceRoot: "E:\\other" }, send);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: "workspace.switch.started" }));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "workspace.switch.failed",
        data: expect.objectContaining({
          workspaceRoot: "E:\\other",
          localizedMessage: expect.objectContaining({ key: "websocket.workspaceSwitchFailed" }),
          details: expect.objectContaining({
            message: expect.any(String),
            error: expect.any(Object),
          }),
        }),
      }),
    );
  });

  test("rejects workspace.switch when no switcher is available", async () => {
    const send = vi.fn(async (_event: AgentDomainEvent) => undefined);
    const handlers = new AgentWebSocketWorkspaceRequestHandlers({});

    await expect(
      handlers.switch({ type: "workspace.switch", requestId: "open-3", workspaceRoot: "E:\\other" }, send),
    ).rejects.toBeInstanceOf(AgentLocalizedError);
    expect(send).not.toHaveBeenCalled();
  });

  test("registers workspace request shapes in the protocol schema", () => {
    expect(AgentWebSocketRequestSchema.safeParse({ type: "workspace.get" }).success).toBe(true);
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "workspace.switch",
        requestId: "open-4",
        workspaceRoot: "  E:\\other  ",
      }).success,
    ).toBe(true);
    expect(AgentWebSocketRequestSchema.safeParse({ type: "workspace.switch" }).success).toBe(false);
    expect(AgentWebSocketRequestSchema.safeParse({ type: "workspace.switch", workspaceRoot: "" }).success).toBe(false);
    expect(AgentWebSocketRequestSchema.safeParse({ type: "workspace.invalid" }).success).toBe(false);
  });
});
