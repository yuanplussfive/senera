import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentMemOSEmbeddingRuntime } from "../../../Source/AgentSystem/Continuity/AgentMemOSEmbeddingRuntime.js";
import { AgentMemOSRecallDedupe } from "../../../Source/AgentSystem/Continuity/AgentMemOSRecallDedupe.js";
import { AgentContinuityMemoryService } from "../../../Source/AgentSystem/Continuity/AgentContinuityMemoryService.js";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import {
  AgentMemOSSchemaVersion,
  AgentMemOSTags,
} from "../../../Source/AgentSystem/Continuity/AgentMemOSSemanticTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

async function fixture() {
  const root = createTemporaryDirectory("senera-native-recall-dedupe");
  const vectors = new Map<string, number[]>();
  const sdk = new AgentMemOSEmbeddingRuntime(
    {
      dbPath: path.join(root, "memos.sqlite"),
      experimental: { namespaces: true, semanticSearch: true },
      embeddingQueue: { synchronous: false },
    },
    {
      dimensions: 3,
      providerId: "test",
      embed: async (request) => ({
        model: "test",
        vectors: request.input.map((text) => {
          const vector = vectors.get(text);
          if (!vector) throw new Error(`Unexpected embedding input: ${text}`);
          return vector;
        }),
      }),
    },
    { id: "test", model: "test", dimensions: 3 },
  );
  await sdk.init();
  const config = { threshold: 0.92, maxPairs: 10000 };
  const index = new AgentMemOSRecallDedupe({ memos: sdk, namespace: "test", config: () => config });
  index.start();
  const store = new AgentContinuitySqliteStore(path.join(root, "receipts.sqlite"));
  cleanups.push(async () => {
    await index.stop();
    await sdk.close();
    store.close();
    removeDirectory(root);
  });
  const add = async (
    summary: string,
    vector: number[],
    tags: string[] = [AgentMemOSTags.knowledge],
    type: "preference" | "context" = "preference",
  ) => {
    vectors.set(`${summary}\n${summary}`, vector);
    return (
      await sdk.store(summary, {
        summary,
        type,
        namespace: "test",
        tags: [AgentMemOSTags.semantic, ...tags],
        metadata: {
          senera_schema: AgentMemOSSchemaVersion,
          senera_domain: "semantic",
          senera_scope: type === "context" ? "session" : "workspace",
          senera_operation_key: `test:${summary}`,
          senera_episode_uri: `senera://episode/${summary}`,
          senera_source_uris: [`senera://source/${summary}`],
          senera_source_session_ids: ["source-session"],
          senera_source_request_ids: ["source-request"],
        },
      })
    ).node;
  };
  let preferred = "";
  const search = async (_query?: string) => {
    await index.synchronize();
    const matches = await sdk.search({ namespace: "test", tags: [AgentMemOSTags.semantic], limit: sdk.count });
    return matches.flatMap((memory) => {
      return [{ ...index.project({ ...memory, score: memory.node.id === preferred ? 1 : 0.9 }) }];
    });
  };
  const port = {
    search,
    searchRecent: () => search(),
    recall: async ({ nodeIds }: { readonly nodeIds?: readonly string[] }) => {
      const ids = new Set(nodeIds ?? []);
      const matches = await sdk.search({ namespace: "test", tags: [AgentMemOSTags.semantic], limit: sdk.count });
      return matches.filter(({ node }) => ids.has(node.id)).map((memory) => ({ memory }));
    },
  };
  const createService = (
    memos = port,
    identityDisplayValues: (() => { readonly user: string; readonly assistant: string }) | undefined = undefined,
  ) =>
    new AgentContinuityMemoryService({
      store,
      recallConfig: () => ({ PromptBudget: { MaxTokens: 16384 } }),
      memos,
      assessRelevance: async ({ candidates }) => candidates,
      identityDisplayValues,
    });
  return {
    sdk,
    index,
    config,
    add,
    vectors,
    createService,
    port,
    prefer: (id: string) => {
      preferred = id;
    },
  };
}

const input = {
  sessionId: "session",
  historicalTokenBudget: { maxTokens: 16384, estimateTokens: (text: string) => text.length },
};

describe("native non-destructive near-duplicate recall", () => {
  test("projects active profile display names out of recalled knowledge", async () => {
    const f = await fixture();
    await f.add("Ada asked Nova to keep updates concise.", [1, 0, 0]);
    const memory = await f.createService(f.port, () => ({ user: "Ada", assistant: "Nova" })).liveContext(input);
    expect(memory.eventCandidates.map((entry) => entry.summary)).toEqual(["用户 asked 我 to keep updates concise."]);
  });

  test("drains queued embeddings before deleting a node", async () => {
    const root = createTemporaryDirectory("senera-native-delete-embedding");
    let release!: () => void;
    let signalStarted!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const sdk = new AgentMemOSEmbeddingRuntime(
      {
        dbPath: path.join(root, "memos.sqlite"),
        experimental: { namespaces: true, semanticSearch: true },
        embeddingQueue: { synchronous: false },
      },
      {
        dimensions: 3,
        providerId: "test",
        embed: async (request) => {
          if (request.role === "document") {
            signalStarted();
            await blocked;
          }
          return { model: "test", vectors: request.input.map(() => [1, 0, 0]) };
        },
      },
      { id: "test", model: "test", dimensions: 3 },
    );
    await sdk.init();
    try {
      const node = (await sdk.store("删除竞态测试", { summary: "删除竞态测试", namespace: "test" })).node;
      const deletion = sdk.forget(node.id);
      await started;
      let settled = false;
      void deletion.then(() => {
        settled = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);

      release();
      await expect(deletion).resolves.toBe(true);
      expect(sdk.embeddingStatus(node.id)?.status).toBe("ready");
    } finally {
      await sdk.close();
      removeDirectory(root);
    }
  });

  test("freezes automatic-memory content while allowing a new snapshot after invalidation", async () => {
    const f = await fixture();
    const first = await f.add("用户喜欢吃牛肉。", [1, 0, 0]);
    const second = await f.add("用户爱吃牛肉。", [0.999, 0.01, 0]);
    const coffee = await f.add("用户每天喝咖啡。", [0, 0, 1]);
    f.prefer(first.id);
    const service = f.createService();
    const before = await service.liveContext(input);
    expect(before.eventCandidates).toHaveLength(2);
    // Exactly one of the two beef near-duplicates survives. Which one is kept follows
    // the SDK's own tie order, so this assertion must not bind a specific node id.
    expect(before.eventCandidates.map((entry) => entry.id)).toContain(coffee.id);
    expect(before.eventCandidates.filter((entry) => entry.id === first.id || entry.id === second.id)).toHaveLength(1);
    f.prefer(second.id);
    expect((await f.createService().liveContext(input)).eventCandidates).toHaveLength(2);
    await f.add("用户偏好牛肉料理。", [0.999, 0.02, 0]);
    expect((await service.liveContext(input)).eventCandidates.map((entry) => entry.id)).toEqual(
      before.eventCandidates.map((entry) => entry.id),
    );
    const updated = "用户喜欢牛肉，也喜欢鸡肉。";
    f.vectors.set(`${updated}\n${updated}`, [0.999, 0.02, 0]);
    await f.sdk.update(first.id, { content: updated, summary: updated });
    const next = await service.liveContext(input);
    expect(next.eventCandidates).toEqual(before.eventCandidates);
    service.invalidateSessionContext(input.sessionId);
    expect((await service.liveContext(input)).eventCandidates).toHaveLength(2);
    expect(f.sdk.count).toBe(4);
  });

  test("reuses native scans, refreshes after writes/settings, and never calls destructive merging", async () => {
    const f = await fixture();
    const scan = vi.spyOn(f.sdk, "dedupe");
    await f.add("用户喜欢牛肉。", [1, 0, 0]);
    await f.add("用户爱吃牛肉。", [0.999, 0.01, 0]);
    await f.index.synchronize();
    const initialScans = scan.mock.calls.length;
    await f.index.synchronize();
    await f.createService().liveContext(input);
    expect(scan).toHaveBeenCalledTimes(initialScans);
    await f.add("用户喝咖啡。", [0, 0, 1]);
    await f.index.synchronize();
    expect(scan.mock.calls.length).toBeGreaterThan(initialScans);
    const nextScans = scan.mock.calls.length;
    f.config.threshold = 0.99;
    await f.index.synchronize();
    expect(scan.mock.calls.length).toBe(nextScans + 1);
    expect(scan.mock.calls.every(([options]) => options?.dryRun === true)).toBe(true);
    expect(f.sdk.count).toBe(3);
  });

  test("keeps period summaries out of automatic system context even when vectors are identical", async () => {
    const f = await fixture();
    await f.add("喜欢牛肉。", [1, 0, 0]);
    await f.add("喜欢牛肉。", [1, 0, 0], [AgentMemOSTags.dailyDigest, "day:2026-10-07"], "context");
    await f.add("喜欢牛肉。", [1, 0, 0], [AgentMemOSTags.dailyDigest, "day:2026-10-08"], "context");
    await f.add("喜欢牛肉。", [1, 0, 0], [AgentMemOSTags.monthlyDigest, "month:2026-10"], "context");
    const result = await f.createService().liveContext(input);
    expect(result.eventCandidates).toHaveLength(1);
    expect(f.sdk.count).toBe(4);
  });

  test("surfaces a native index failure instead of bypassing it", async () => {
    const f = await fixture();
    await f.index.synchronize();
    vi.spyOn(f.sdk, "dedupe").mockRejectedValueOnce(new Error("native scan failed"));
    f.config.threshold = 0.99;
    await expect(f.index.synchronize({ surfaceFailures: true })).rejects.toThrow("native scan failed");
    await expect(f.index.synchronize({ surfaceFailures: true })).rejects.toThrow("native scan failed");
    await expect(f.index.synchronize()).resolves.toBeUndefined();
    await f.add("用户喝咖啡。", [0, 0, 1]);
    await expect(f.index.synchronize()).resolves.toBeUndefined();
  });

  test("reselects after a compaction races with automatic-memory selection", async () => {
    const f = await fixture();
    await f.add("用户喜欢牛肉。", [1, 0, 0]);
    let release!: () => void;
    let reached!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let calls = 0;
    const service = f.createService({
      ...f.port,
      searchRecent: async () => {
        const result = await f.port.searchRecent();
        if (++calls === 1) {
          reached();
          await paused;
        }
        return result;
      },
    });
    const sessionId = "racing-session";
    const pending = service.liveContext({ ...input, sessionId });
    await read;
    service.invalidateSessionContext(sessionId);
    release();
    const memory = await pending;
    expect(calls).toBe(2);
    expect(memory.eventCandidates).toHaveLength(1);
    service.deleteSession(sessionId);
    expect((await service.liveContext({ ...input, sessionId })).eventCandidates).toHaveLength(1);
  });
});
