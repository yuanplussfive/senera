import { afterEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeAgentSelfCommand } from "../../../Source/AgentSystem/SelfService/AgentSelfCommand.js";
import { executeAgentSelfInvocation } from "../../../Source/AgentSystem/SelfService/AgentSelfCommand.js";
import {
  readAgentSelfConfigPath,
  updateAgentSelfConfigPath,
} from "../../../Source/AgentSystem/SelfService/AgentSelfConfig.js";
import type { AgentSelfServicePort } from "../../../Source/AgentSystem/SelfService/AgentSelfServiceTypes.js";
import { AgentPresetManager } from "../../../Source/AgentSystem/Presets/AgentPresetManager.js";
import { resolvePresetsConfig } from "../../../Source/AgentSystem/Defaults/AgentToolDefaults.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createAgentSelfTestConfigPort, createAgentTestSnapshot } from "./AgentSelfTestHarness.js";
import { AgentSessionStore } from "../../../Source/AgentSystem/Session/AgentSessionStore.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // best effort on Windows
    }
  }
});

function temporaryWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-self-"));
  temporaryRoots.push(root);
  return root;
}

function baseConfig(overrides?: Partial<AgentSystemConfig>): AgentSystemConfig {
  return {
    DefaultModelProviderId: "gpt-5.6",
    ModelProviderEndpoints: [
      {
        Id: "main",
        Enabled: true,
        Kind: "OpenAICompatible" as const,
        BaseUrl: "https://models.example.test/v1",
        ApiKey: "senera:secret:v1:abcdef123456",
      },
    ],
    ModelProviders: [
      {
        Id: "gpt-5.6",
        ProviderId: "main",
        Endpoint: "ChatCompletions" as const,
        Model: "gpt-5.6-2026",
        Capabilities: { Chat: true, ToolCalling: true },
      },
    ],
    ...overrides,
  };
}

function createConfigPort(initial: AgentSystemConfig): ReturnType<typeof createAgentSelfTestConfigPort> {
  return createAgentSelfTestConfigPort(initial);
}

function workspacePort(workspaceRoot: string): AgentSelfServicePort {
  const config = baseConfig();
  const presetPort = {
    manager: () =>
      new AgentPresetManager({
        workspaceRoot,
        config: resolvePresetsConfig(config),
        activation: {
          catalog: async () => [],
          synchronize: async () => undefined,
        } as never,
      }),
  };
  return {
    workspaceRoot,
    config: {
      getSnapshot: () => createAgentTestSnapshot(config),
      replace: (input) => {
        void input;
        return createAgentTestSnapshot(config);
      },
      history: () => [],
      readRevision: () => ({ status: "unavailable" }),
    },
    presets: presetPort,
  };
}

describe("senera self-service config", () => {
  test("navigates dot paths and redacts secrets", () => {
    const { port } = createConfigPort(baseConfig());
    const redacted = { ...baseConfig(), __redacted: true };
    void redacted;
    const projected = readAgentSelfConfigPath(port().config.getSnapshot().value, "DefaultModelProviderId");
    expect(projected).toMatchObject({ found: true, value: "gpt-5.6" });
    const missing = readAgentSelfConfigPath(port().config.getSnapshot().value, "ModelProviderEndpoints.0.ApiKey");
    expect(missing.found).toBe(true);
    expect(missing.value).toContain("senera:secret:v1:");
  });

  test("config get returns redacted values at paths", async () => {
    const { port } = createConfigPort(baseConfig());
    const output = await executeAgentSelfCommand(
      { command: "config", action: "get", path: "ModelProviderEndpoints.0" },
      { ...workspacePort(temporaryWorkspace()), config: port().config } as AgentSelfServicePort,
    );
    expect(output.ok).toBe(true);
    const data = output.data as { ApiKey?: string; BaseUrl?: string };
    expect(data?.BaseUrl).toBe("https://models.example.test/v1");
    expect(data?.ApiKey).toBe("***");
  });

  test("config update commits one path through the guarded replace", async () => {
    const { port, replaceCalls } = createConfigPort(baseConfig());
    const result = updateAgentSelfConfigPath(
      { ...workspacePort(temporaryWorkspace()), config: port().config } as AgentSelfServicePort,
      "DefaultModelProviderId",
      "gpt-5.6",
    );
    expect(result.replaced).toBe(true);
    expect(replaceCalls).toHaveLength(1);
    const call = replaceCalls[0]!;
    expect(call.source).toBe("api_update");
    expect(call.commandId).toMatch(/^self_config_/);
    expect(call.baseRevision).toBe(7);
    expect((call.config as AgentSystemConfig).DefaultModelProviderId).toBe("gpt-5.6");
    expect(result.revision).toBe(8);
  });

  test("config update rejects unreachable paths", () => {
    const { port } = createConfigPort(baseConfig());
    expect(() =>
      updateAgentSelfConfigPath(
        { ...workspacePort(temporaryWorkspace()), config: port().config } as AgentSelfServicePort,
        "Unknown.Section",
        1,
      ),
    ).not.toThrow();
  });

  test("models and endpoints projections are redacted", async () => {
    const { port } = createConfigPort(baseConfig());
    const models = await executeAgentSelfCommand({ command: "config", action: "models" }, {
      ...workspacePort(temporaryWorkspace()),
      config: port().config,
    } as AgentSelfServicePort);
    expect(models.ok).toBe(true);
    const endpoints = await executeAgentSelfCommand({ command: "config", action: "endpoints" }, {
      ...workspacePort(temporaryWorkspace()),
      config: port().config,
    } as AgentSelfServicePort);
    expect(endpoints.ok).toBe(true);
    expect(JSON.stringify(endpoints.data)).not.toContain("ApiKey");
  });
});

describe("senera self-service presets", () => {
  const card = {
    schemaVersion: "senera.persona/v1",
    title: "测试人格",
    corePersona: "你是一个测试助手。",
    languageStyle: "简洁",
    examples: [{ id: "e1", situation: "你好", reply: "你好！" }],
    lore: [],
  };

  test("create, list, activate, show round-trip", async () => {
    const root = temporaryWorkspace();
    const port = workspacePort(root);

    const created = await executeAgentSelfCommand(
      { command: "preset", action: "create", name: "tester", content: card },
      port,
    );
    expect(created.ok).toBe(true);

    const listed = await executeAgentSelfCommand({ command: "preset", action: "list" }, port);
    expect(listed.ok).toBe(true);
    expect((listed.data as { presets: unknown[] }).presets).toHaveLength(1);

    const used = await executeAgentSelfCommand({ command: "preset", action: "use", name: "tester" }, port);
    expect(used.ok).toBe(true);
    expect((used.data as { active: string }).active).toBe("tester.json");

    const shown = await executeAgentSelfCommand({ command: "preset", action: "show", name: "tester" }, port);
    expect(shown.ok).toBe(true);
    expect(JSON.stringify(shown.data)).toContain("tester");

    const reset = await executeAgentSelfCommand({ command: "preset", action: "use", name: null }, port);
    expect(reset.ok).toBe(true);
    expect((reset.data as { active: string | null }).active).toBeNull();
  });

  test("shows missing presets as errors", async () => {
    const port = workspacePort(temporaryWorkspace());
    const shown = await executeAgentSelfCommand({ command: "preset", action: "show", name: "ghost" }, port);
    expect(shown.ok).toBe(false);
  });
});

describe("senera self-service workspace and doctor", () => {
  test("capabilities reports the live command contract and mutation workflow", async () => {
    const output = await executeAgentSelfCommand({ command: "capabilities" }, workspacePort(temporaryWorkspace()));
    expect(output.ok).toBe(true);
    expect(output.data).toMatchObject({
      protocolVersion: 1,
      mutationWorkflow: expect.any(Array),
      commandContract: { version: 1, revision: expect.stringMatching(/^[a-f0-9]{64}$/u) },
    });
    expect(JSON.stringify(output.data)).toContain("config.update");
  });

  test("invalid runtime invocations fail explicitly instead of falling through a cast", async () => {
    const output = await executeAgentSelfInvocation({ command: 7 } as never, workspacePort(temporaryWorkspace()));
    expect(output).toMatchObject({ ok: false, error: "invalid_command" });
  });

  test("projects repairable diagnostics when a built-in command omits its action", async () => {
    const output = await executeAgentSelfInvocation(
      { command: "session", operation: "get" } as never,
      workspacePort(temporaryWorkspace()),
    );
    expect(output).toMatchObject({ ok: false, error: "invalid_command" });
    expect(output.text).toContain("action");
    expect(output.data).toMatchObject({
      kind: "schema_validation",
      command: "session",
      issues: expect.any(Array),
    });
  });

  test("workspace info reports the layout", async () => {
    const root = temporaryWorkspace();
    const output = await executeAgentSelfCommand({ command: "workspace", action: "info" }, workspacePort(root));
    expect(output.ok).toBe(true);
    const data = output.data as { root: string; databases: Record<string, string> };
    expect(data.root).toBe(root);
    expect(data.databases.sessions).toContain("sessions.sqlite");
  });

  test("doctor status is locally evaluated", async () => {
    const root = temporaryWorkspace();
    const output = await executeAgentSelfCommand({ command: "doctor", action: "status" }, workspacePort(root));
    expect(output.ok).toBe(true);
    expect(output.data).toHaveProperty("config");
    expect(output.data).toHaveProperty("workspace");
    expect(output.data).toHaveProperty("state");
  });

  test("unknown workspace root still reports issues instead of throwing", async () => {
    const root = path.join(os.tmpdir(), "senera-self-missing-" + Date.now());
    const output = await executeAgentSelfCommand({ command: "doctor", action: "status" }, workspacePort(root));
    expect(output.ok).toBe(false);
    expect(output.text).toContain("✗");
  });
});

describe("senera self-service session model", () => {
  function sessionPort(root: string, store: AgentSessionStore): AgentSelfServicePort {
    const base = workspacePort(root);
    return {
      ...base,
      sessions: {
        list: () => [],
        getModelPreference: (sessionId) => store.getSessionModelPreference(sessionId),
        getModelRuntime: (sessionId) => store.getSessionModelRuntime(sessionId),
        setModelPreference: (sessionId, modelProviderId, source) =>
          store.setSessionModelPreference(sessionId, modelProviderId, source),
        snapshot: (sessionId) => store.getSessionSnapshot(sessionId),
      },
    };
  }

  test("sets and reads a durable next-turn preference without changing the global default", async () => {
    const root = temporaryWorkspace();
    const store = new AgentSessionStore();
    store.open("session-model");
    const port = sessionPort(root, store);

    const updated = await executeAgentSelfCommand(
      { command: "session", action: "model", operation: "set", sessionId: "session-model", modelProviderId: "gpt-5.6" },
      port,
    );
    expect(updated).toMatchObject({ ok: true, data: { effectiveAt: "next_turn" } });
    expect(store.getSessionModelPreference("session-model")).toMatchObject({
      modelProviderId: "gpt-5.6",
      revision: 1,
      source: "agent",
    });

    const repeated = await executeAgentSelfCommand(
      { command: "session", action: "model", operation: "set", sessionId: "session-model", modelProviderId: "gpt-5.6" },
      port,
    );
    expect(repeated).toMatchObject({ ok: true, data: { preference: { status: "unchanged", revision: 1 } } });

    const read = await executeAgentSelfCommand(
      { command: "session", action: "model", operation: "get", sessionId: "session-model" },
      port,
    );
    expect(read).toMatchObject({ ok: true, data: { preference: { modelProviderId: "gpt-5.6" } } });
  });

  test("rejects unknown model ids and missing sessions explicitly", async () => {
    const root = temporaryWorkspace();
    const store = new AgentSessionStore();
    const port = sessionPort(root, store);
    const unknown = await executeAgentSelfCommand(
      { command: "session", action: "model", operation: "set", sessionId: "missing", modelProviderId: "unknown" },
      port,
    );
    expect(unknown).toMatchObject({ ok: false });
    expect(unknown.text).toContain("模型配置不存在");

    store.open("known");
    const missing = await executeAgentSelfCommand(
      { command: "session", action: "model", operation: "set", sessionId: "missing", modelProviderId: "gpt-5.6" },
      port,
    );
    expect(missing).toMatchObject({ ok: false, error: "session_not_found" });
  });
});
