import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type {
  AgentEvent,
  AgentHarnessResources,
  AgentMessage,
  AgentState,
  PromptTemplate,
  Skill,
} from "@earendil-works/pi-agent-core";
import { AgentPluginRegistry } from "../../../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import {
  AgentPiSubstrate,
  type AgentPiSession,
  type AgentPiSessionEventListener,
  type AgentPiToolCallExecutorPort,
  type AgentPiArtifactRecorderPort,
} from "../../../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import type {
  AgentPiHarnessLeaseInput,
  AgentPiHarnessSessionPoolPort,
} from "../../../Source/AgentSystem/Pi/AgentPiHarnessSessionPool.js";
import {
  AgentPiSessionStore,
  type AgentPiOpenSessionResult,
  type AgentPiSessionStorePort,
} from "../../../Source/AgentSystem/Pi/AgentPiSessionStore.js";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import {
  createModelProvider,
  createTemporaryDirectory,
  removeDirectory,
} from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    removeDirectory(temporaryDirectories.pop()!);
  }
});

describe("Pi session lifecycle behavior", () => {
  test("persists a named JSONL session and reopens it as existing", async () => {
    const workspaceRoot = createWorkspace();
    const store = new AgentPiSessionStore({
      workspaceRoot,
      sessionsRoot: ".senera/pi-sessions",
      env: new SeneraLocalExecutionEnv({ workspaceRoot }),
    });

    const first = await store.openOrCreate({ sessionId: "session-1" });
    const second = await store.openOrCreate({ sessionId: "session-1" });

    expect(first.storage).toBe("created");
    expect(second.storage).toBe("existing");
    expect(second.sessionId).toBe("session-1");
    expect(await second.session.getEntries()).toEqual([]);
  });

  test("creates, reuses, traces, and closes substrate sessions through explicit lifecycle ports", async () => {
    const workspaceRoot = createWorkspace();
    const store = new RecordingSessionStore([
      sessionResult("session-1", "created", 0),
      sessionResult("session-1", "existing", 2),
    ]);
    const pool = new RecordingHarnessPool();
    const events: unknown[] = [];
    const substrate = new AgentPiSubstrate({
      workspaceRoot,
      config: piTestConfig,
      modelProvider: createModelProvider(),
      registry: new AgentPluginRegistry(),
      toolCallExecutor: unusedToolExecutor,
      artifactRecorder: passthroughArtifactRecorder,
      executionEnv: new SeneraLocalExecutionEnv({ workspaceRoot }),
      sessionStore: store,
      harnessPool: pool,
    });

    const first = await substrate.createSession({
      sessionId: "session-1",
      requestId: "request-1",
      step: 1,
      input: "Inspect the release workflow",
      visibleToolNames: [],
      onEvent: (event) => {
        events.push(event);
      },
    });
    const second = await substrate.createSession({
      sessionId: "session-1",
      requestId: "request-2",
      step: 2,
      input: "Promote the preview",
      visibleToolNames: [],
      onEvent: (event) => {
        events.push(event);
      },
    });
    substrate.close();

    expect(first).toMatchObject({
      piSessionId: "session-1",
      historyMigrationRequired: true,
    });
    expect(second).toMatchObject({
      piSessionId: "session-1",
      historyMigrationRequired: false,
    });
    expect(store.requests).toEqual([
      { sessionId: "session-1", fallbackId: "request-1" },
      { sessionId: "session-1", fallbackId: "request-2" },
    ]);
    expect(pool.leases.map((lease) => ({
      sessionId: lease.sessionId,
      requestId: lease.frame.requestId,
      step: lease.frame.step,
      activeToolNames: lease.activeToolNames,
    }))).toEqual([
      { sessionId: "session-1", requestId: "request-1", step: 1, activeToolNames: [] },
      { sessionId: "session-1", requestId: "request-2", step: 2, activeToolNames: [] },
    ]);
    expect(pool.closeCount).toBe(1);
    expect(traceTypes(events)).toEqual([
      "core.agent.create.started",
      "core.agent.create.completed",
      "core.agent.create.started",
      "core.agent.create.completed",
    ]);
  });
});

const piTestConfig: AgentSystemConfig = {
  Server: {
    Host: "127.0.0.1",
    Port: 8787,
  },
  ModelProviderEndpoints: [{
    Id: "test-endpoint",
    BaseUrl: "https://model.example/v1",
    ApiKey: "test-key",
  }],
  ModelProviders: [{
    Id: "test-provider",
    ProviderId: "test-endpoint",
    Endpoint: "ChatCompletions",
    Model: "test-model",
  }],
};

const unusedToolExecutor: AgentPiToolCallExecutorPort = {
  execute: async () => ({
    kind: "ToolResults",
    value: [],
  }),
};

const passthroughArtifactRecorder: AgentPiArtifactRecorderPort = {
  record: async ({ results }) => [...results],
};

class RecordingSessionStore implements AgentPiSessionStorePort {
  readonly requests: Array<{ sessionId?: string; fallbackId?: string }> = [];

  constructor(private readonly results: AgentPiOpenSessionResult[]) {}

  async openOrCreate(request: { sessionId?: string; fallbackId?: string }): Promise<AgentPiOpenSessionResult> {
    this.requests.push({ ...request });
    const result = this.results.shift();
    if (!result) {
      throw new Error("Unexpected Pi session open request.");
    }
    return result;
  }
}

class RecordingHarnessPool implements AgentPiHarnessSessionPoolPort {
  readonly leases: AgentPiHarnessLeaseInput[] = [];
  closeCount = 0;

  async lease(input: AgentPiHarnessLeaseInput) {
    this.leases.push(input);
    return {
      session: new FakePiSession(),
      storage: this.leases.length === 1 ? "created" as const : "existing" as const,
    };
  }

  close(): void {
    this.closeCount += 1;
  }
}

class FakePiSession implements AgentPiSession {
  readonly state = {
    systemPrompt: "",
    model: createModelProvider() as unknown as AgentState["model"],
    thinkingLevel: "off",
    tools: [],
    messages: [],
    isStreaming: false,
    pendingToolCalls: new Set(),
  } as AgentState;
  readonly model = this.state.model;

  setHistory(_messages: readonly AgentMessage[]): void {}
  async prompt(_text: string): Promise<void> {}
  async steer(_text: string): Promise<void> {}
  async followUp(_text: string): Promise<void> {}
  async nextTurn(_text: string): Promise<void> {}
  async setResources(_resources: AgentHarnessResources<Skill, PromptTemplate>): Promise<void> {}
  subscribe(_listener: AgentPiSessionEventListener): () => void { return () => {}; }
  async abort(): Promise<void> {}
  dispose(): void {}
  getLastAssistantText(): string | undefined { return undefined; }
  getActiveToolNames(): string[] { return []; }
}

function sessionResult(
  sessionId: string,
  storage: "created" | "existing",
  entryCount: number,
): AgentPiOpenSessionResult {
  return {
    sessionId,
    storage,
    session: {
      getEntries: async () => Array.from({ length: entryCount }),
    } as AgentPiOpenSessionResult["session"],
  };
}

function createWorkspace(): string {
  const workspace = createTemporaryDirectory("senera-pi");
  temporaryDirectories.push(workspace);
  return workspace;
}

function traceTypes(events: readonly unknown[]): string[] {
  return events.flatMap((event) => {
    if (!event || typeof event !== "object" || !("kind" in event) || event.kind !== "pi.trace") {
      return [];
    }
    const data = "data" in event ? event.data : undefined;
    return data && typeof data === "object" && "eventType" in data && typeof data.eventType === "string"
      ? [data.eventType]
      : [];
  });
}
