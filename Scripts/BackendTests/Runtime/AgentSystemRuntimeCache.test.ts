import { describe, expect, test } from "vitest";
import {
  AgentSystemRuntimeCache,
  type AgentSystemRuntimeCacheRuntime,
} from "../../../Source/AgentSystem/Runtime/AgentSystemRuntimeCache.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("AgentSystemRuntimeCache", () => {
  test("reuses a matching provider and closes an idle runtime before constructing another provider", () => {
    const fixture = createCache();

    const first = fixture.cache.acquire("deepseek-flash");
    first.release();
    const reused = fixture.cache.acquire("deepseek-flash");
    expect(reused.runtime).toBe(first.runtime);
    reused.release();

    const next = fixture.cache.acquire("deepseek-pro");
    expect(fixture.order).toEqual(["create:deepseek-flash", "close:deepseek-flash", "create:deepseek-pro"]);
    next.release();
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
    let pluginRevision = 0;
    const runtimes: FakeRuntime[] = [];
    const cache = new AgentSystemRuntimeCache<FakeRuntime>({
      workspaceRoot: "runtime-cache-test",
      configPath: "runtime-cache-test.json",
      snapshot: () => ({
        version: 1,
        revision: 1,
        sourceRevisions: { plugins: pluginRevision },
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
    pluginRevision += 1;
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

function createDeferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settled) => {
    resolve = settled;
  });
  return { promise, resolve };
}
