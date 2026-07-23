import { afterEach, describe, expect, test, vi } from "vitest";
import type {
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
  type AgentPiOpenSessionRequest,
  type AgentPiOpenSessionResult,
  type AgentPiSessionStorePort,
} from "../../../Source/AgentSystem/Pi/AgentPiSessionStore.js";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createModelProvider, createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import type { AgentPiDiagnosticEvent } from "../../../Source/AgentSystem/Pi/AgentPiDiagnostics.js";

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

  test("removes a cancelled queued session open without blocking its successor", async () => {
    const workspaceRoot = createWorkspace();
    const env = new SeneraLocalExecutionEnv({ workspaceRoot });
    const writeStarted = deferred<void>();
    const allowWrite = deferred<void>();
    const originalWriteFile = env.writeFile.bind(env);
    let pausedInitialWrite = false;
    const writeFile = vi.spyOn(env, "writeFile").mockImplementation(async (...args) => {
      if (!pausedInitialWrite) {
        pausedInitialWrite = true;
        writeStarted.resolve();
        await allowWrite.promise;
      }
      return originalWriteFile(...args);
    });
    const store = new AgentPiSessionStore({
      workspaceRoot,
      sessionsRoot: ".senera/pi-sessions",
      env,
    });

    const active = store.openOrCreate({ sessionId: "session-queued-open" });
    await writeStarted.promise;
    const controller = new AbortController();
    const cancelled = store.openOrCreate({ sessionId: "session-queued-open", signal: controller.signal });
    const successor = store.openOrCreate({ sessionId: "session-queued-open" });
    controller.abort("replacement superseded queued session open");

    await expect(cancelled).rejects.toMatchObject({
      name: "AgentCancellationError",
      message: "replacement superseded queued session open",
    });
    expect(writeFile).toHaveBeenCalledOnce();

    allowWrite.resolve();
    const [created, existing] = await Promise.all([active, successor]);
    expect(created.storage).toBe("created");
    expect(existing.storage).toBe("existing");
    expect(created.session).toBe(existing.session);
  });

  test("indexes metadata once and reuses opened sessions without reparsing JSONL", async () => {
    const workspaceRoot = createWorkspace();
    const seedStore = new AgentPiSessionStore({
      workspaceRoot,
      sessionsRoot: ".senera/pi-sessions",
      env: new SeneraLocalExecutionEnv({ workspaceRoot }),
    });
    const firstSeed = await seedStore.openOrCreate({ sessionId: "session-cache-a" });
    await firstSeed.session.appendCustomEntry("seed", { value: "a" });
    const secondSeed = await seedStore.openOrCreate({ sessionId: "session-cache-b" });
    await secondSeed.session.appendCustomEntry("seed", { value: "b" });

    const env = new SeneraLocalExecutionEnv({ workspaceRoot });
    const readTextFile = vi.spyOn(env, "readTextFile");
    const readTextLines = vi.spyOn(env, "readTextLines");
    const store = new AgentPiSessionStore({
      workspaceRoot,
      sessionsRoot: ".senera/pi-sessions",
      env,
    });

    const [first, repeated] = await Promise.all([
      store.openOrCreate({ sessionId: "session-cache-a" }),
      store.openOrCreate({ sessionId: "session-cache-a" }),
    ]);
    expect(first.session).toBe(repeated.session);
    expect(readTextFile).toHaveBeenCalledTimes(1);
    expect(readTextLines).toHaveBeenCalledTimes(2);

    await store.openOrCreate({ sessionId: "session-cache-b" });
    expect(readTextFile).toHaveBeenCalledTimes(2);
    expect(readTextLines).toHaveBeenCalledTimes(2);

    await store.openOrCreate({ sessionId: "session-cache-a" });
    await store.openOrCreate({ sessionId: "session-cache-new" });
    expect(readTextFile).toHaveBeenCalledTimes(2);
    expect(readTextLines).toHaveBeenCalledTimes(2);
  });

  test("bounds open session retention with the shared Pi cache policy", async () => {
    const workspaceRoot = createWorkspace();
    const seedStore = new AgentPiSessionStore({
      workspaceRoot,
      sessionsRoot: ".senera/pi-sessions",
      env: new SeneraLocalExecutionEnv({ workspaceRoot }),
    });
    await (await seedStore.openOrCreate({ sessionId: "session-lru-a" })).session.appendCustomEntry("seed", {});
    await (await seedStore.openOrCreate({ sessionId: "session-lru-b" })).session.appendCustomEntry("seed", {});

    const env = new SeneraLocalExecutionEnv({ workspaceRoot });
    const readTextFile = vi.spyOn(env, "readTextFile");
    const store = new AgentPiSessionStore({
      workspaceRoot,
      sessionsRoot: ".senera/pi-sessions",
      env,
      maxCachedSessions: 1,
    });

    await store.openOrCreate({ sessionId: "session-lru-a" });
    await store.openOrCreate({ sessionId: "session-lru-b" });
    await store.openOrCreate({ sessionId: "session-lru-a" });
    expect(readTextFile).toHaveBeenCalledTimes(3);
  });

  test("rewinds a persisted JSONL session to an explicit turn boundary", async () => {
    const workspaceRoot = createWorkspace();
    const store = new AgentPiSessionStore({
      workspaceRoot,
      sessionsRoot: ".senera/pi-sessions",
      env: new SeneraLocalExecutionEnv({ workspaceRoot }),
    });
    const opened = await store.openOrCreate({ sessionId: "session-rewind" });
    const boundaryId = await opened.session.appendCustomEntry("senera.turn_boundary", { requestId: "request-a" });
    await opened.session.appendCustomEntry("after-boundary", { value: 1 });

    await expect(store.rewind("session-rewind", boundaryId)).resolves.toBe(true);
    const reopened = await store.openOrCreate({ sessionId: "session-rewind" });
    expect(await reopened.session.getLeafId()).toBe(boundaryId);
  });

  test("creates, reuses, diagnoses, and closes substrate sessions through explicit lifecycle ports", async () => {
    const workspaceRoot = createWorkspace();
    const store = new RecordingSessionStore([sessionResult("session-1", "created", 0)]);
    const pool = new RecordingHarnessPool();
    const diagnostics: AgentPiDiagnosticEvent[] = [];
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
      diagnostics: (event) => {
        diagnostics.push(event);
      },
    });

    const first = await substrate.leaseTurn({
      sessionId: "session-1",
      requestId: "request-1",
      step: 1,
      input: "Inspect the release workflow",
      visibleToolNames: [],
    });
    const second = await substrate.leaseTurn({
      sessionId: "session-1",
      requestId: "request-2",
      step: 2,
      input: "Promote the preview",
      visibleToolNames: [],
    });
    await expect(substrate.rewindSession("session-1", "boundary-a")).resolves.toBe(true);
    await substrate.close();

    expect(first).toMatchObject({
      piSessionId: "session-1",
      historyMigrationRequired: true,
    });
    expect(second).toMatchObject({
      piSessionId: "session-1",
      historyMigrationRequired: true,
    });
    expect(store.requests).toEqual([{ operation: "open_or_create", sessionId: "session-1", fallbackId: "request-1" }]);
    expect(
      pool.leases.map((lease) => ({
        sessionId: lease.sessionId,
        requestId: lease.frame.requestId,
        step: lease.frame.step,
        activeToolNames: lease.toolSet.activeToolNames,
      })),
    ).toEqual([
      { sessionId: "session-1", requestId: "request-1", step: 1, activeToolNames: [] },
      { sessionId: "session-1", requestId: "request-2", step: 2, activeToolNames: [] },
    ]);
    expect(pool.closeCount).toBe(1);
    expect(pool.rewinds).toEqual([{ sessionId: "session-1", entryId: "boundary-a" }]);
    expect(store.rewinds).toEqual([{ sessionId: "session-1", entryId: "boundary-a" }]);
    expect(diagnosticNames(diagnostics)).toEqual([
      "core.turn.lease.started",
      "core.turn.lease.completed",
      "core.turn.lease.timing",
      "core.turn.lease.started",
      "core.turn.lease.completed",
      "core.turn.lease.timing",
    ]);
    expect(diagnosticDetails(diagnostics, "core.turn.lease.timing")).toEqual([
      expect.objectContaining({
        sessionOpenSource: "session_store",
        sessionOpenMs: expect.any(Number),
        harnessLeaseMs: expect.any(Number),
        durationMs: expect.any(Number),
      }),
      expect.objectContaining({
        sessionOpenSource: "harness_pool",
        sessionOpenMs: expect.any(Number),
        harnessLeaseMs: expect.any(Number),
        durationMs: expect.any(Number),
      }),
    ]);
  });

  test("propagates turn cancellation into persistent session acquisition", async () => {
    const workspaceRoot = createWorkspace();
    const store = new RecordingSessionStore([sessionResult("session-cancellable-open", "created", 0)]);
    const pool = new RecordingHarnessPool();
    const substrate = createRecordingSubstrate(workspaceRoot, store, pool);
    const controller = new AbortController();

    const lease = await substrate.leaseTurn({
      sessionId: "session-cancellable-open",
      requestId: "request-cancellable-open",
      input: "Inspect cancellation propagation",
      visibleToolNames: [],
      signal: controller.signal,
    });

    expect(store.openSignals).toEqual([controller.signal]);
    lease.session.dispose();
    await substrate.close();
  });
});

const piTestConfig: AgentSystemConfig = {
  Server: {
    Host: "127.0.0.1",
    Port: 8787,
  },
  ModelProviderEndpoints: [
    {
      Id: "test-endpoint",
      BaseUrl: "https://model.example/v1",
      ApiKey: "test-key",
    },
  ],
  ModelProviders: [
    {
      Id: "test-provider",
      ProviderId: "test-endpoint",
      Endpoint: "ChatCompletions",
      Model: "test-model",
    },
  ],
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
  readonly requests: Array<{ operation: "open_or_create"; sessionId?: string; fallbackId?: string }> = [];
  readonly openSignals: Array<AbortSignal | undefined> = [];
  readonly rewinds: Array<{ sessionId: string; entryId: string }> = [];
  readonly resets: string[] = [];

  constructor(
    private readonly results: AgentPiOpenSessionResult[],
    private readonly behavior: { rewindResult?: boolean; resetResult?: boolean } = {},
  ) {}

  async openOrCreate(request: AgentPiOpenSessionRequest): Promise<AgentPiOpenSessionResult> {
    const { signal, ...identity } = request;
    this.requests.push({ operation: "open_or_create", ...identity });
    this.openSignals.push(signal);
    return this.nextResult();
  }

  private nextResult(): AgentPiOpenSessionResult {
    const result = this.results.shift();
    if (!result) {
      throw new Error("Unexpected Pi session open request.");
    }
    return result;
  }

  async reset(sessionId: string): Promise<boolean> {
    this.resets.push(sessionId);
    return this.behavior.resetResult ?? false;
  }

  async rewind(sessionId: string, entryId: string): Promise<boolean> {
    this.rewinds.push({ sessionId, entryId });
    return this.behavior.rewindResult ?? true;
  }
}

class RecordingHarnessPool implements AgentPiHarnessSessionPoolPort {
  readonly leases: AgentPiHarnessLeaseInput[] = [];
  readonly rewinds: Array<{ sessionId: string; entryId: string }> = [];
  readonly resets: string[] = [];
  closeCount = 0;

  findPersistentSession(sessionId: string) {
    for (let index = this.leases.length - 1; index >= 0; index -= 1) {
      const lease = this.leases[index];
      if (lease?.sessionId === sessionId) return lease.session;
    }
    return undefined;
  }

  async lease(input: AgentPiHarnessLeaseInput) {
    this.leases.push(input);
    return {
      session: new FakePiSession(),
      storage: this.leases.length === 1 ? ("created" as const) : ("existing" as const),
    };
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }

  async reset(sessionId: string): Promise<void> {
    this.resets.push(sessionId);
  }
  async rewind(sessionId: string, entryId: string): Promise<boolean> {
    this.rewinds.push({ sessionId, entryId });
    return false;
  }
}

function createRecordingSubstrate(
  workspaceRoot: string,
  store: AgentPiSessionStorePort,
  pool: AgentPiHarnessSessionPoolPort,
): AgentPiSubstrate {
  return new AgentPiSubstrate({
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
  async markTurnBoundary(requestId: string): Promise<string> {
    return `boundary:${requestId}`;
  }
  async setResources(_resources: AgentHarnessResources<Skill, PromptTemplate>): Promise<void> {}
  subscribe(_listener: AgentPiSessionEventListener): () => void {
    return () => {};
  }
  async abort(): Promise<void> {}
  dispose(): void {}
  getLastAssistantText(): string | undefined {
    return undefined;
  }
  getActiveToolNames(): string[] {
    return [];
  }
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
      getLeafId: async () => (entryCount > 0 ? "leaf" : null),
    } as AgentPiOpenSessionResult["session"],
  };
}

function createWorkspace(): string {
  const workspace = createTemporaryDirectory("senera-pi");
  temporaryDirectories.push(workspace);
  return workspace;
}

function diagnosticNames(events: readonly AgentPiDiagnosticEvent[]): string[] {
  return events.map((event) => event.name);
}

function diagnosticDetails(events: readonly AgentPiDiagnosticEvent[], name: string): unknown[] {
  return events.filter((event) => event.name === name).map((event) => event.details);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settled) => {
    resolve = settled;
  });
  return { promise, resolve };
}
