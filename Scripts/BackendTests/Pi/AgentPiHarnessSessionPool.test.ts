import { describe, expect, test } from "vitest";
import type { AgentHarness } from "@earendil-works/pi-agent-core";
import {
  AgentPiHarnessSessionPool,
  type AgentPiHarnessLeaseInput,
} from "../../../Source/AgentSystem/Pi/AgentPiHarnessSessionPool.js";
import type { SeneraExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import type { AgentPiModelProjection, AgentPiProviderProjection } from "../../../Source/AgentSystem/Pi/AgentPiTypes.js";
import type { ResolvedAgentModelProviderConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("AgentPiHarnessSessionPool", () => {
  test("skips unchanged tool and resource configuration while advancing the mutable turn frame", async () => {
    const fixture = createPool(2);
    let readContext: Parameters<AgentPiHarnessLeaseInput["toolSet"]["materialize"]>[0] | undefined;
    const firstInput = createLeaseInput("cached-session", "request-1");
    firstInput.toolSet = {
      ...firstInput.toolSet,
      materialize: (context) => {
        readContext = context;
        return [];
      },
    };

    const first = await fixture.pool.lease(firstInput);
    first.session.dispose();
    const second = await fixture.pool.lease(createLeaseInput("cached-session", "request-2"));

    expect(fixture.harnesses[0]).toMatchObject({ setToolsCount: 0, setResourcesCount: 0 });
    expect(readContext?.().requestId).toBe("request-2");
    second.session.dispose();

    const changed = createLeaseInput("cached-session", "request-3");
    changed.toolSet = { ...changed.toolSet, fingerprint: "changed-tools" };
    changed.resourceFingerprint = "changed-resources";
    const third = await fixture.pool.lease(changed);

    expect(fixture.harnesses[0]).toMatchObject({ setToolsCount: 1, setResourcesCount: 1 });
    third.session.dispose();
    await fixture.pool.close();
  });

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

    await fixture.pool.close();
    expect(fixture.harnesses[0]?.abortCount).toBe(1);
  });

  test("waits for an active lease before resetting and recreates the harness", async () => {
    const fixture = createPool(1);
    const lease = await fixture.pool.lease(createLeaseInput("reset-session"));
    const shutdown = fixture.harnesses[0]!.pauseNextAbort();
    let resetCompleted = false;
    const reset = fixture.pool.reset("reset-session").then(() => {
      resetCompleted = true;
    });
    await Promise.resolve();

    expect(resetCompleted).toBe(false);
    expect(fixture.harnesses[0]?.abortCount).toBe(0);

    lease.session.dispose();
    await shutdown.entered;
    expect(resetCompleted).toBe(false);
    shutdown.release();
    await reset;
    expect(fixture.harnesses[0]?.abortCount).toBe(1);

    const recreated = await fixture.pool.lease(createLeaseInput("reset-session"));
    expect(fixture.harnesses).toHaveLength(2);
    recreated.session.dispose();
    await fixture.pool.close();
  });

  test("coalesces concurrent abort requests for the same leased turn", async () => {
    const fixture = createPool(1);
    const lease = await fixture.pool.lease(createLeaseInput("abort-session"));

    await Promise.all([lease.session.abort(), lease.session.abort()]);

    expect(fixture.harnesses[0]?.abortCount).toBe(1);
    lease.session.dispose();
    await fixture.pool.close();
  });

  test("removes a cancelled queued lease without blocking its successor", async () => {
    const fixture = createPool(1);
    const active = await fixture.pool.lease(createLeaseInput("queued-session", "active-request"));
    const controller = new AbortController();
    const cancelledInput = createLeaseInput("queued-session", "cancelled-request");
    cancelledInput.signal = controller.signal;
    const cancelled = fixture.pool.lease(cancelledInput);

    controller.abort("replacement superseded this lease");
    await expect(cancelled).rejects.toMatchObject({ name: "AgentCancellationError" });

    const successor = fixture.pool.lease(createLeaseInput("queued-session", "successor-request"));
    active.session.dispose();
    const successorLease = await successor;

    expect(fixture.harnesses).toHaveLength(1);
    successorLease.session.dispose();
    await fixture.pool.close();
  });

  test("settles harness cancellation before releasing a configuring lease", async () => {
    const fixture = createPool(1);
    const initial = await fixture.pool.lease(createLeaseInput("configuring-session", "initial-request"));
    initial.session.dispose();

    const idle = fixture.harnesses[0]!.pauseNextIdle();
    const abort = fixture.harnesses[0]!.pauseNextAbort();
    const controller = new AbortController();
    const cancelledInput = createLeaseInput("configuring-session", "cancelled-request");
    cancelledInput.signal = controller.signal;
    const cancelled = fixture.pool.lease(cancelledInput);
    let settled = false;
    void cancelled.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await idle.entered;
    controller.abort("replacement superseded harness configuration");
    await abort.entered;
    idle.release();
    await Promise.resolve();
    expect(settled).toBe(false);

    abort.release();
    await expect(cancelled).rejects.toMatchObject({ name: "AgentCancellationError" });
    const successor = await fixture.pool.lease(createLeaseInput("configuring-session", "successor-request"));

    expect(fixture.harnesses).toHaveLength(1);
    expect(fixture.harnesses[0]?.abortCount).toBe(1);
    successor.session.dispose();
    await fixture.pool.close();
  });

  test("rewinds an idle pooled session directly to its persisted turn boundary", async () => {
    const fixture = createPool(1);
    const persistentSession = new FakePersistentSession("turn-boundary");
    const lease = await fixture.pool.lease(
      createLeaseInput(
        "rewind-session",
        undefined,
        persistentSession as unknown as AgentPiHarnessLeaseInput["session"],
      ),
    );
    lease.session.dispose();
    const idle = fixture.harnesses[0]!.pauseNextIdle();
    const rewind = fixture.pool.rewind("rewind-session", "turn-boundary");
    await idle.entered;

    expect(persistentSession.movedTo).toEqual([]);
    idle.release();
    await expect(rewind).resolves.toBe(true);

    expect(persistentSession.movedTo).toEqual(["turn-boundary"]);
    expect(fixture.harnesses[0]?.abortCount).toBe(0);
    await fixture.pool.close();
  });
});

class FakeHarness {
  abortCount = 0;
  setToolsCount = 0;
  setResourcesCount = 0;
  private abortPause: TestPause | undefined;
  private idlePause: TestPause | undefined;

  subscribe(): () => void {
    return () => undefined;
  }

  on(): () => void {
    return () => undefined;
  }

  async waitForIdle(): Promise<void> {
    const pause = this.idlePause;
    this.idlePause = undefined;
    if (!pause) return;
    pause.entered.resolve();
    await pause.released.promise;
  }

  async setTools(): Promise<void> {
    this.setToolsCount += 1;
  }

  async setResources(): Promise<void> {
    this.setResourcesCount += 1;
  }

  async setStreamOptions(): Promise<void> {}

  async abort(): Promise<void> {
    this.abortCount += 1;
    const pause = this.abortPause;
    this.abortPause = undefined;
    if (!pause) return;
    pause.entered.resolve();
    await pause.released.promise;
  }

  pauseNextAbort(): TestPauseHandle {
    const pause = createPause();
    this.abortPause = pause;
    return pauseHandle(pause);
  }

  pauseNextIdle(): TestPauseHandle {
    const pause = createPause();
    this.idlePause = pause;
    return pauseHandle(pause);
  }
}

class FakePersistentSession {
  readonly movedTo: string[] = [];

  constructor(private readonly boundaryId: string) {}

  async getEntry(entryId: string): Promise<{ id: string } | undefined> {
    return entryId === this.boundaryId ? { id: entryId } : undefined;
  }

  async moveTo(entryId: string): Promise<void> {
    this.movedTo.push(entryId);
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

interface TestPause {
  entered: ReturnType<typeof createDeferred<void>>;
  released: ReturnType<typeof createDeferred<void>>;
}

interface TestPauseHandle {
  entered: Promise<void>;
  release(): void;
}

function createPause(): TestPause {
  return {
    entered: createDeferred<void>(),
    released: createDeferred<void>(),
  };
}

function pauseHandle(pause: TestPause): TestPauseHandle {
  return {
    entered: pause.entered.promise,
    release: () => pause.released.resolve(),
  };
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settled) => {
    resolve = settled;
  });
  return { promise, resolve };
}

function createLeaseInput(
  sessionId: string,
  requestId?: string,
  session: AgentPiHarnessLeaseInput["session"] = {} as AgentPiHarnessLeaseInput["session"],
): AgentPiHarnessLeaseInput {
  return {
    sessionId,
    session,
    toolSet: emptyToolSet(),
    resources: {},
    resourceFingerprint: "empty-resources",
    frame: {
      sessionId,
      requestId,
      selectedPromptTemplates: [],
    },
    preflight: async () => undefined,
  };
}

function emptyToolSet(): AgentPiHarnessLeaseInput["toolSet"] {
  return {
    fingerprint: "empty-tools",
    activeToolNames: [],
    materialize: () => [],
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
