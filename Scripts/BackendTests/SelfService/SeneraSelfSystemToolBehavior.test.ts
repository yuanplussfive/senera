import { describe, expect, test } from "vitest";
import { createSeneraSelfSystemTools } from "../../../Source/AgentSystem/SystemTools/SeneraSelfSystemTool.js";
import {
  registerAgentSystemToolHandlers,
  systemToolCapability,
} from "../../../Source/AgentSystem/SystemTools/AgentSystemToolCatalog.js";
import { AgentSelfCommandSchema } from "../../../Source/AgentSystem/SelfService/AgentSelfCommandSchema.js";
import type { AgentSelfServicePort } from "../../../Source/AgentSystem/SelfService/AgentSelfServiceTypes.js";
import type { AgentHostToolContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { AgentToolHostCapabilityRegistry } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
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
    presets: {
      manager: () => {
        throw new Error("preset manager is not exercised by this test");
      },
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

describe("SeneraCommand host tool binding", () => {
  test("executes config reads when the self-service port is bound", async () => {
    const [tool] = createSeneraSelfSystemTools(createBoundSelfServicePort());
    const parsed = AgentSelfCommandSchema.parse({ command: "config", action: "get", path: "Server.Port" });
    const output = await tool.execute(parsed, toolContext);
    expect(output).toMatchObject({ ok: true, text: "8787", data: 8787 });
  });

  test("executes sensitive updates that pass a guard rule without a channel", async () => {
    const [tool] = createSeneraSelfSystemTools(createBoundSelfServicePort());
    const parsed = AgentSelfCommandSchema.parse({
      command: "config",
      action: "update",
      path: "ModelProviders.0.Temperature",
      value: 0.7,
    });
    const output = await tool.execute(parsed, toolContext);
    const result = output as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  test("fails deterministically when the self-service port is not bound", async () => {
    const [tool] = createSeneraSelfSystemTools();
    const parsed = AgentSelfCommandSchema.parse({ command: "config", action: "get", path: "Server.Port" });
    await expect(tool.execute(parsed, toolContext)).resolves.toMatchObject({
      ok: false,
      error: "self_service_unavailable",
      data: { availability: "unbound" },
    });
  });

  test("preserves structured command failures for Pi instead of throwing them away", async () => {
    const [tool] = createSeneraSelfSystemTools(createBoundSelfServicePort());
    const parsed = AgentSelfCommandSchema.parse({ command: "plugins", action: "list" });
    const output = await tool.execute(parsed, toolContext);
    expect(output).toMatchObject({ ok: false, error: "plugins_unavailable" });

    const executed = await tool.executeWithArtifacts?.(parsed, toolContext);
    expect(executed).toMatchObject({
      result: { ok: false, error: "plugins_unavailable" },
      failure: { code: "ToolExecutionError", details: { selfServiceError: "plugins_unavailable" } },
    });
  });

  test("projects command failures through the standard host tool result envelope", async () => {
    const [tool] = createSeneraSelfSystemTools(createBoundSelfServicePort());
    const handlers = new AgentToolHostCapabilityRegistry();
    registerAgentSystemToolHandlers(handlers, [tool]);
    const handler = handlers.get(systemToolCapability(tool));
    expect(handler).toBeTypeOf("function");

    const result = await handler!({ command: "session", operation: "get" }, toolContext);
    expect(result.response).toMatchObject({
      ok: false,
      error: {
        code: "InvalidToolArguments",
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ message: expect.any(String), path: expect.arrayContaining(["action"]) }),
        ]),
      },
    });
  });

  test("binds session model mutations to the active tool session and publishes a snapshot", async () => {
    const events: unknown[] = [];
    const [tool] = createSeneraSelfSystemTools(createBoundSelfServicePort());
    const parsed = AgentSelfCommandSchema.parse({
      command: "session",
      action: "model",
      operation: "set",
      modelProviderId: "gpt-5.6",
    });
    const output = await tool.execute(parsed, {
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
    const [tool] = createSeneraSelfSystemTools(createBoundSelfServicePort());
    const parsed = AgentSelfCommandSchema.parse({
      command: "session",
      action: "model",
      operation: "get",
      sessionId: "other-session",
    });
    await expect(tool.execute(parsed, toolContext)).rejects.toThrow(/active model session/);
  });
});
