import { describe, expect, test } from "vitest";
import type { AgentHarness } from "@earendil-works/pi-agent-core";
import {
  AgentPiHarnessSessionPool,
  type AgentPiHarnessLeaseInput,
} from "../../../Source/AgentSystem/Pi/AgentPiHarnessSessionPool.js";
import type { SeneraExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import type {
  AgentPiModelProjection,
  AgentPiProviderProjection,
} from "../../../Source/AgentSystem/Pi/AgentPiTypes.js";
import type { ResolvedAgentModelProviderConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("AgentPiHarnessSessionPool", () => {
  test("bounds idle harnesses without evicting an active session", async () => {
    const fixture = createPool(1);

    const first = await fixture.pool.lease(createLeaseInput("first-session"));
    const second = await fixture.pool.lease(createLeaseInput("second-session"));

    second.session.dispose();
    await Promise.resolve();
    expect(fixture.harnesses[0]?.abortCount).toBe(0);

    first.session.dispose();
    await Promise.resolve();
    expect(fixture.harnesses[1]?.abortCount).toBe(1);
    expect(fixture.harnesses[0]?.abortCount).toBe(0);

    const reused = await fixture.pool.lease(createLeaseInput("first-session"));
    expect(fixture.harnesses).toHaveLength(2);
    reused.session.dispose();
    await Promise.resolve();

    fixture.pool.close();
    expect(fixture.harnesses[0]?.abortCount).toBe(1);
  });
});

class FakeHarness {
  abortCount = 0;

  subscribe(): () => void {
    return () => undefined;
  }

  on(): () => void {
    return () => undefined;
  }

  async waitForIdle(): Promise<void> {}

  async setTools(): Promise<void> {}

  async setResources(): Promise<void> {}

  async setStreamOptions(): Promise<void> {}

  async abort(): Promise<void> {
    this.abortCount += 1;
  }
}

function createPool(maxIdleSessions: number): {
  pool: AgentPiHarnessSessionPool;
  harnesses: FakeHarness[];
} {
  const harnesses: FakeHarness[] = [];
  const pool = new AgentPiHarnessSessionPool({
    env: {} as SeneraExecutionEnv,
    provider: createProvider(),
    modelProvider: {
      TimeoutMs: 1_000,
      MaxNetworkRetries: 0,
    } as ResolvedAgentModelProviderConfig,
    maxIdleSessions,
    harnessFactory: () => {
      const harness = new FakeHarness();
      harnesses.push(harness);
      return harness as unknown as AgentHarness;
    },
  });
  return { pool, harnesses };
}

function createLeaseInput(sessionId: string): AgentPiHarnessLeaseInput {
  return {
    sessionId,
    session: {} as AgentPiHarnessLeaseInput["session"],
    tools: [],
    activeToolNames: [],
    resources: {},
    frame: {
      selectedPromptTemplates: [],
    },
    preflight: async () => undefined,
  };
}

function createProvider(): AgentPiProviderProjection {
  return {
    providerId: "test-provider",
    apiKey: "test-key",
    headers: {},
    upstream: {
      providerId: "test-provider",
      endpoint: "ChatCompletions",
      baseUrl: "https://example.invalid/v1",
      model: "test-model",
    },
    model: createModel(),
  };
}

function createModel(): AgentPiModelProjection {
  return {
    id: "test-model",
    name: "test-model",
    api: "openai-completions",
    provider: "senera-pi-proxy",
    baseUrl: "http://127.0.0.1:8787/v1",
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}
