import { describe, expect, test, vi } from "vitest";
import { createAgentSelfModelExecutor } from "../../../Source/AgentSystem/SelfService/AgentSelfModelExecutor.js";
import { AgentSelfCommandSchema } from "../../../Source/AgentSystem/SelfService/AgentSelfCommandSchema.js";
import type { AgentSelfServicePort } from "../../../Source/AgentSystem/SelfService/AgentSelfServiceTypes.js";
import type { AgentHostToolContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createAgentTestSnapshot } from "./AgentSelfTestHarness.js";

function createBoundSelfServicePort(): AgentSelfServicePort {
  const config = {
    Server: { Host: "127.0.0.1", Port: 8787, HotReload: true },
    DefaultModelProviderId: "gpt-5.6",
    ModelProviderEndpoints: [
      { Id: "main", Enabled: true, Kind: "OpenAICompatible" as const, BaseUrl: "https://models.example.test/v1" },
    ],
    ModelProviders: [
      { Id: "gpt-5.6", ProviderId: "main", Endpoint: "ChatCompletions" as const, Model: "gpt-5.6-2026" },
    ],
  } as unknown as AgentSystemConfig;
  let revision = 7;
  let value = structuredClone(config);
  return {
    workspaceRoot: "C:\\senera-test",
    config: {
      getSnapshot: () => createAgentTestSnapshot(value, revision),
      replace: (input) => {
        value = structuredClone(input.config);
        revision += 1;
        return createAgentTestSnapshot(value, revision);
      },
      history: () => [],
      readRevision: () => ({ status: "unavailable" }) as const,
    },
    sessions: {
      list: () => [],
      getModelPreference: () => undefined,
      getModelRuntime: () => undefined,
      setModelPreference: async (sessionId, modelProviderId, source = "agent") => ({
        status: "updated" as const,
        sessionId,
        modelProviderId,
        revision: 1,
        updatedAt: new Date().toISOString(),
        source,
        effectiveAt: "next_turn" as const,
      }),
      resolveAgentId: () => undefined,
      snapshot: (sessionId) => ({
        sessionId,
        status: "idle" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        entryCount: 0,
        messageCount: 0,
        turnCount: 0,
        modelProviderId: "gpt-5.6",
      }),
    },
  };
}

const toolContext: AgentHostToolContext = {
  sessionId: "test-session",
  requestId: "test-request",
  step: 0,
  approvalMode: undefined,
  signal: new AbortController().signal,
  onEvent: () => undefined,
} as unknown as AgentHostToolContext;

describe("Session-scoped self-service command binding", () => {
  test("binds diary reads to the current session Agent and rejects another Agent", async () => {
    const active = "e3ea515f-2264-44c9-a8fb-868f612c57d3";
    const other = "ab43daaa-2f42-4522-8fa8-9f71f1abf35c";
    const base = createBoundSelfServicePort();
    const seen: Array<string | undefined> = [];
    const execute = createAgentSelfModelExecutor({
      ...base,
      sessions: { ...base.sessions!, resolveAgentId: () => active },
      diaries: {
        list: (_period, id) => {
          seen.push(id);
          return { index: "# Memory index", entries: [] };
        },
        read: () => undefined,
      },
    });
    await execute(AgentSelfCommandSchema.parse({ command: "diary", action: "list" }), toolContext);
    expect(seen).toEqual([active]);
    await expect(
      execute(AgentSelfCommandSchema.parse({ command: "diary", action: "list", agentId: other }), toolContext),
    ).rejects.toThrow("active session Agent");
  });
  test("executes config reads when the self-service port is bound", async () => {
    const execute = createAgentSelfModelExecutor(createBoundSelfServicePort());
    const parsed = AgentSelfCommandSchema.parse({ command: "config", action: "get", path: "Server.Port" });
    const output = await execute(parsed, toolContext);
    expect(output).toMatchObject({ ok: true, text: "8787", data: 8787 });
  });

  test("executes sensitive updates that pass a guard rule without a channel", async () => {
    const execute = createAgentSelfModelExecutor(createBoundSelfServicePort());
    const parsed = AgentSelfCommandSchema.parse({
      command: "config",
      action: "update",
      path: "ModelProviders.0.Temperature",
      value: 0.7,
    });
    const output = await execute(parsed, toolContext);
    const result = output as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  test("preserves structured command failures for Pi instead of throwing them away", async () => {
    const execute = createAgentSelfModelExecutor(createBoundSelfServicePort());
    const parsed = AgentSelfCommandSchema.parse({ command: "plugins", action: "list" });
    const output = await execute(parsed, toolContext);
    expect(output).toMatchObject({ ok: false, error: "plugins_unavailable" });
  });

  test("binds session model mutations to the active tool session and publishes a snapshot", async () => {
    const events: unknown[] = [];
    const execute = createAgentSelfModelExecutor(createBoundSelfServicePort());
    const parsed = AgentSelfCommandSchema.parse({
      command: "session",
      action: "model",
      operation: "set",
      modelProviderId: "gpt-5.6",
    });
    const output = await execute(parsed, {
      ...toolContext,
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(output).toMatchObject({ ok: true, data: { effectiveAt: "next_turn" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "session.snapshot",
      context: { sessionId: "test-session" },
      data: { modelProviderId: "gpt-5.6" },
    });
  });

  test("does not allow a model to target another session", async () => {
    const execute = createAgentSelfModelExecutor(createBoundSelfServicePort());
    const parsed = AgentSelfCommandSchema.parse({
      command: "session",
      action: "model",
      operation: "get",
      sessionId: "other-session",
    });
    await expect(execute(parsed, toolContext)).rejects.toThrow(/active model session/);
  });

  test("binds preset selection to the session Agent and rejects cross-Agent writes", async () => {
    const agentId = "f9b4aa48-bebb-4c2a-9a55-a48b34775cc2";
    const port = createBoundSelfServicePort();
    const enable = vi.fn(async (path: string, owner?: string) => ({
      status: "enabled" as const,
      enabled: true,
      agentId: owner!,
      activePath: path,
    }));
    const execute = createAgentSelfModelExecutor({
      ...port,
      sessions: { ...port.sessions!, resolveAgentId: () => agentId },
      promptPresets: { enable, status: vi.fn(), read: vi.fn(), disable: vi.fn() },
    });
    const input = { command: "preset", action: "enable", path: "prompts/review.md" } as const;
    expect(await execute(input, toolContext)).toMatchObject({ ok: true, data: { agentId } });
    expect(enable).toHaveBeenCalledWith("prompts/review.md", agentId);
    await expect(execute({ ...input, agentId: "498987f4-224a-497e-b733-7358b404c527" }, toolContext)).rejects.toThrow(
      /active session Agent/,
    );
    expect(enable).toHaveBeenCalledTimes(1);
  });

  test("preset operations without a verified Agent fail instead of changing the default Agent", async () => {
    const execute = createAgentSelfModelExecutor(createBoundSelfServicePort());
    await expect(execute({ command: "preset", action: "disable" }, toolContext)).rejects.toThrow(
      /active session Agent/,
    );
  });
});
