import { describe, expect, test } from "vitest";
import {
  AgentSystemRuntimeCache,
  type AgentSystemRuntimeCacheRuntime,
} from "../../../Source/AgentSystem/Runtime/AgentSystemRuntimeCache.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("AgentSystemRuntimeCache", () => {
  test("reuses a matching provider and closes an idle runtime after constructing its replacement", () => {
    const fixture = createCache();

    const first = fixture.cache.acquire("deepseek-flash");
    first.release();
    const reused = fixture.cache.acquire("deepseek-flash");
    expect(reused.runtime).toBe(first.runtime);
    reused.release();

    const next = fixture.cache.acquire("deepseek-pro");
    expect(fixture.order).toEqual(["create:deepseek-flash", "create:deepseek-pro", "close:deepseek-flash"]);
    next.release();
  });

  test("keeps the last valid runtime when replacement construction fails", () => {
    let revision = 1;
    const runtime = new FakeRuntime("stable", []);
    const cache = new AgentSystemRuntimeCache<FakeRuntime>({
      workspaceRoot: "runtime-cache-test",
      configPath: "runtime-cache-test.json",
      snapshot: () => ({ version: revision, revision, config: {} as AgentSystemConfig }),
      runtimeFactory: () => {
        if (revision > 1) throw new Error("invalid extension generation");
        return runtime;
      },
    });

    cache.acquire().release();
    revision += 1;

    expect(() => cache.acquire()).toThrow("invalid extension generation");
    expect(runtime.closeCount).toBe(0);

    revision -= 1;
    const recovered = cache.acquire();
    expect(recovered.runtime).toBe(runtime);
    recovered.release();
  });

  test("closes a candidate whose initialization throws before a lease can be returned", () => {
    const candidate = new ThrowingInitializableRuntime();
    const cache = new AgentSystemRuntimeCache<ThrowingInitializableRuntime>({
      workspaceRoot: "runtime-cache-test",
      configPath: "runtime-cache-test.json",
      snapshot: () => ({ version: 1, config: {} as AgentSystemConfig }),
      runtimeFactory: () => candidate,
    });

    expect(() => cache.acquire()).toThrow("synchronous initialization failure");
    expect(candidate.closeCount).toBe(1);
  });

  test("publishes a replacement only after asynchronous initialization succeeds", async () => {
    let revision = 1;
    const initialization = createDeferred();
    const stable = new InitializableFakeRuntime("stable", Promise.resolve());
    const candidate = new InitializableFakeRuntime("candidate", initialization.promise);
    const cache = new AgentSystemRuntimeCache<InitializableFakeRuntime>({
      workspaceRoot: "runtime-cache-test",
      configPath: "runtime-cache-test.json",
      snapshot: () => ({ version: revision, revision, config: {} as AgentSystemConfig }),
      runtimeFactory: () => (revision === 1 ? stable : candidate),
    });

    const first = cache.acquire();
    await stable.initialize();
    first.release();

    revision += 1;
    const replacement = cache.acquire();
    await Promise.resolve();
    expect(stable.closeCount).toBe(0);

    initialization.resolve();
    await candidate.initialize();
    await Promise.resolve();
    expect(stable.closeCount).toBe(1);
    replacement.release();
  });

  test("removes a failed asynchronous candidate and preserves the last valid runtime", async () => {
    let revision = 1;
    const initialization = createDeferred();
    const stable = new InitializableFakeRuntime("stable", Promise.resolve());
    const candidate = new InitializableFakeRuntime("candidate", initialization.promise);
    const cache = new AgentSystemRuntimeCache<InitializableFakeRuntime>({
      workspaceRoot: "runtime-cache-test",
      configPath: "runtime-cache-test.json",
      snapshot: () => ({ version: revision, revision, config: {} as AgentSystemConfig }),
      runtimeFactory: () => (revision === 1 ? stable : candidate),
    });

    const first = cache.acquire();
    await stable.initialize();
    first.release();

    revision += 1;
    const replacement = cache.acquire();
    initialization.reject(new Error("invalid MCP package"));
    await expect(candidate.initialize()).rejects.toThrow("invalid MCP package");
    replacement.release();
    await Promise.resolve();

    expect(candidate.closeCount).toBe(1);
    expect(stable.closeCount).toBe(0);

    revision -= 1;
    const recovered = cache.acquire();
    expect(recovered.runtime).toBe(stable);
    recovered.release();
  });

  test("does not close active runtimes and trims them only after release", () => {
    const fixture = createCache();
    const flash = fixture.cache.acquire("deepseek-flash");
    const pro = fixture.cache.acquire("deepseek-pro");

    expect(fixture.runtimes.get("deepseek-flash")?.closeCount).toBe(0);
    flash.release();
    expect(fixture.runtimes.get("deepseek-flash")?.closeCount).toBe(0);

    pro.release();
    expect(fixture.runtimes.get("deepseek-flash")?.closeCount).toBe(1);
    expect(fixture.runtimes.get("deepseek-pro")?.closeCount).toBe(0);
  });

  test("keeps an active stale configuration generation until its lease is released", () => {
    const fixture = createCache();
    const active = fixture.cache.acquire("deepseek-flash");
    fixture.bumpRevision();
    const replacement = fixture.cache.acquire("deepseek-flash");

    expect(replacement.runtime).not.toBe(active.runtime);
    expect(active.runtime.closeCount).toBe(0);

    replacement.release();
    active.release();
    expect(active.runtime.closeCount).toBe(1);
    expect(replacement.runtime.closeCount).toBe(0);
  });

  test("invalidates runtime and preparation state when a non-JSON source revision changes", () => {
    let extensionRevision = 0;
    const runtimes: FakeRuntime[] = [];
    const cache = new AgentSystemRuntimeCache<FakeRuntime>({
      workspaceRoot: "runtime-cache-test",
      configPath: "runtime-cache-test.json",
      snapshot: () => ({
        version: 1,
        revision: 1,
        sourceRevisions: { extensions: extensionRevision },
        config: {} as AgentSystemConfig,
      }),
      runtimeFactory: ({ modelProviderId }) => {
        const runtime = new FakeRuntime(modelProviderId ?? "default", []);
        runtimes.push(runtime);
        return runtime;
      },
    });

    const first = cache.acquire("deepseek-flash");
    first.release();
    extensionRevision += 1;
    const replacement = cache.acquire("deepseek-flash");

    expect(replacement.runtime).not.toBe(first.runtime);
    expect(replacement.fingerprint).not.toBe(first.fingerprint);
    expect(replacement.preparationFingerprint).not.toBe(first.preparationFingerprint);
    expect(runtimes).toHaveLength(2);
    replacement.release();
  });

  test("separates runtime generations from semantic preparation compatibility", () => {
    let revision = 1;
    let config = { second: 2, first: 1 } as unknown as AgentSystemConfig;
    const cache = new AgentSystemRuntimeCache<FakeRuntime>({
      workspaceRoot: "runtime-cache-test",
      configPath: "runtime-cache-test.json",
      snapshot: () => ({
        version: revision,
        revision,
        config,
      }),
      runtimeFactory: ({ modelProviderId }) => new FakeRuntime(modelProviderId ?? "default", []),
    });

    const first = cache.acquire("deepseek-flash");
    first.release();
    revision += 1;
    config = { first: 1, second: 2 } as unknown as AgentSystemConfig;
    const newGeneration = cache.acquire("deepseek-flash");

    expect(newGeneration.runtime).not.toBe(first.runtime);
    expect(newGeneration.fingerprint).not.toBe(first.fingerprint);
    expect(newGeneration.preparationFingerprint).toBe(first.preparationFingerprint);
    newGeneration.release();

    config = { first: 1, second: 3 } as unknown as AgentSystemConfig;
    revision += 1;
    const incompatible = cache.acquire("deepseek-flash");
    expect(incompatible.preparationFingerprint).not.toBe(first.preparationFingerprint);
    incompatible.release();
  });

  test("makes release idempotent and supports zero retained idle runtimes", () => {
    const fixture = createCache(0);
    const lease = fixture.cache.acquire("deepseek-flash");

    lease.release();
    lease.release();

    expect(lease.runtime.closeCount).toBe(1);
  });

  test("waits for asynchronous runtime shutdown when clearing the cache", async () => {
    const closeGate = createDeferred();
    let shutdownCompleted = false;
    const cache = new AgentSystemRuntimeCache<AgentSystemRuntimeCacheRuntime>({
      workspaceRoot: "runtime-cache-test",
      configPath: "runtime-cache-test.json",
      snapshot: () => ({ version: 1, config: {} as AgentSystemConfig }),
      runtimeFactory: () => ({
        close: async () => {
          await closeGate.promise;
          shutdownCompleted = true;
        },
      }),
    });
    cache.acquire().release();

    const clearing = cache.clear();
    await Promise.resolve();
    expect(shutdownCompleted).toBe(false);

    closeGate.resolve();
    await clearing;
    expect(shutdownCompleted).toBe(true);
  });
});

class FakeRuntime implements AgentSystemRuntimeCacheRuntime {
  closeCount = 0;

  constructor(
    readonly providerId: string,
    private readonly order: string[],
  ) {}

  close(): void {
    this.closeCount += 1;
    this.order.push(`close:${this.providerId}`);
  }
}

class InitializableFakeRuntime implements AgentSystemRuntimeCacheRuntime {
  closeCount = 0;

  constructor(
    readonly providerId: string,
    private readonly initialization: Promise<void>,
  ) {}

  initialize(): Promise<void> {
    return this.initialization;
  }

  close(): void {
    this.closeCount += 1;
  }
}

class ThrowingInitializableRuntime implements AgentSystemRuntimeCacheRuntime {
  closeCount = 0;

  initialize(): never {
    throw new Error("synchronous initialization failure");
  }

  close(): void {
    this.closeCount += 1;
  }
}

function createCache(maxIdleEntries = 1): {
  cache: AgentSystemRuntimeCache<FakeRuntime>;
  runtimes: Map<string, FakeRuntime>;
  order: string[];
  bumpRevision(): void;
} {
  let revision = 1;
  const order: string[] = [];
  const runtimes = new Map<string, FakeRuntime>();
  const cache = new AgentSystemRuntimeCache<FakeRuntime>({
    workspaceRoot: "runtime-cache-test",
    configPath: "runtime-cache-test.json",
    maxIdleEntries,
    snapshot: () => ({
      version: revision,
      revision,
      config: {} as AgentSystemConfig,
    }),
    runtimeFactory: ({ modelProviderId }) => {
      const providerId = modelProviderId ?? "default";
      const runtime = new FakeRuntime(providerId, order);
      runtimes.set(`${revision}:${providerId}`, runtime);
      runtimes.set(providerId, runtime);
      order.push(`create:${providerId}`);
      return runtime;
    },
  });

  return {
    cache,
    runtimes,
    order,
    bumpRevision: () => {
      revision += 1;
    },
  };
}

function createDeferred(): { promise: Promise<void>; resolve(): void; reject(error: unknown): void } {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((settled, rejected) => {
    resolve = settled;
    reject = rejected;
  });
  return { promise, resolve, reject };
}
