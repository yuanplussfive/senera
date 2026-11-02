import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { MemOS } from "@mem-os/sdk";
import { describe, expect, test } from "vitest";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import {
  agentLearningPaths,
  migrateWorkspaceLearning,
} from "../../../Source/AgentSystem/Continuity/AgentLearningStorage.js";
import { AgentContinuityRuntimePool } from "../../../Source/AgentSystem/Continuity/AgentContinuityRuntimePool.js";
import { createAgentContinuityRuntime } from "../../../Source/AgentSystem/Continuity/AgentContinuityRuntime.js";
import {
  AgentMemOSSchemaVersion,
  AgentMemOSTags,
} from "../../../Source/AgentSystem/Continuity/AgentMemOSSemanticTypes.js";
import { AgentUpgradeSession } from "../../../Source/AgentSystem/Upgrade/AgentUpgradeSession.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const config: AgentSystemConfig = {
  ModelProviderEndpoints: [{ Id: "test", BaseUrl: "https://example.invalid/v1", ApiKey: "test" }],
  ModelProviders: [{ Id: "test/model", ProviderId: "test", Endpoint: "ChatCompletions", Model: "test-model" }],
  DefaultModelProviderId: "test/model",
  ContinuityLearning: { Enabled: false },
};

async function seedMemory(file: string, namespace: string, summary: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sdk = new MemOS({ dbPath: file, experimental: { namespaces: true } });
  await sdk.init();
  try {
    return (
      await sdk.store(summary, {
        summary,
        namespace,
        type: "preference",
        tags: [AgentMemOSTags.semantic, AgentMemOSTags.knowledge],
        metadata: {
          senera_schema: AgentMemOSSchemaVersion,
          senera_domain: "semantic",
          senera_scope: "workspace",
          senera_operation_key: `seed:${summary}`,
          senera_episode_uri: `episode:${summary}`,
          senera_source_uris: [`source:${summary}`],
          senera_source_session_ids: ["same-session"],
          senera_source_request_ids: ["request"],
        },
      })
    ).node;
  } finally {
    await sdk.close();
  }
}

describe("UUID-owned learning stores", () => {
  test("isolates semantic lookup, exact references, learning ledgers, todos and frozen snapshots across restart and removal", async () => {
    const root = createTemporaryDirectory("senera-agent-learning");
    const layout = resolveAgentWorkspaceLayout(root);
    const first = randomUUID();
    const second = randomUUID();
    const agents = new Set<string>([first, second]);
    const pathsA = agentLearningPaths(layout, first);
    const pathsB = agentLearningPaths(layout, second);
    let pool: AgentContinuityRuntimePool | undefined;
    try {
      const memoryA = await seedMemory(pathsA.memosDatabasePath, first, "Prefers concise answers");
      const memoryB = await seedMemory(pathsB.memosDatabasePath, second, "Prefers detailed explanations");
      const createPool = () =>
        new AgentContinuityRuntimePool({
          layout,
          assertAgent: (id) => {
            if (!agents.has(id)) throw new Error("Unknown Agent");
          },
          sessionAgentId: (id) => {
            if (id === "a") return first;
            if (id === "b") return second;
            throw new Error("No owner");
          },
          create: (agentId, paths) =>
            createAgentContinuityRuntime({
              agentId,
              ...paths,
              workspaceId: "test-workspace",
              configSnapshot: () => config,
              upgradeSession: new AgentUpgradeSession({ workspaceRoot: root, appVersion: "test" }),
              todoPolicy: { maxItems: 10, maxContentCharacters: 200, maxResultCharacters: 500 },
              embeddingClient: {
                providerId: "test",
                dimensions: 4,
                embed: async ({ input }) => ({ model: "test", vectors: input.map(() => [1, 0, 0, 0]) }),
              },
              embeddingModel: () => "test",
            }),
        });
      pool = createPool();
      const a = pool.forAgent(first);
      const b = pool.forAgent(second);
      a.diaries.write(
        "2026-10-26",
        { title: "A 的日记", body: "只属于 A" },
        { revision: "test", episodeUris: [], sourceUris: [] },
      );
      b.diaries.write(
        "2026-10-26",
        { title: "B 的日记", body: "只属于 B" },
        { revision: "test", episodeUris: [], sourceUris: [] },
      );
      expect(a.diaries.read("2026-10-26")?.body).toBe("只属于 A");
      expect(b.diaries.read("2026-10-26")?.body).toBe("只属于 B");
      expect(pool.forSession("a")).toBe(a);
      expect(() => pool!.forSession("unowned")).toThrow("No owner");
      expect(() => agentLearningPaths(layout, "../escape")).toThrow();
      expect(
        (await a.memos.recall({ nodeIds: [memoryA.id, memoryB.id] })).map((entry) => entry.memory.node.id),
      ).toEqual([memoryA.id]);
      expect(
        (await b.memos.recall({ nodeIds: [memoryA.id, memoryB.id] })).map((entry) => entry.memory.node.id),
      ).toEqual([memoryB.id]);
      expect((await a.memos.searchRecent()).map((entry) => entry.memory.node.id)).toEqual([memoryA.id]);
      a.todos.add({ sessionId: "same-session", tasks: [{ content: "A private plan" }] });
      expect(b.todos.read("same-session").items).toEqual([]);
      a.store.createMemorySnapshot("same-session", { entries: [], diaryIndex: "" }, new Date().toISOString());
      expect(b.store.readMemorySnapshot("same-session")).toBeUndefined();
      a.learningRequests.begin({ operationKey: "same", board: "state_card", stage: "test", attempt: 1 }).complete();
      expect(b.learningRequests.list()).toEqual([]);
      expect(a.identity.agentId).toBe(first);
      expect(b.identity.agentId).toBe(second);
      await pool.close();
      pool = createPool();
      expect(pool.forAgent(first).diaries.read("2026-10-26")?.body).toBe("只属于 A");
      expect(pool.forAgent(first).todos.read("same-session").items[0].content).toBe("A private plan");
      expect(pool.forAgent(first).learningRequests.list()).toHaveLength(1);
      expect(pool.forAgent(second).todos.read("same-session").items).toEqual([]);
      await pool.remove(second);
      agents.delete(second);
      expect(fs.existsSync(pathsB.root)).toBe(false);
      expect(fs.existsSync(pathsB.diaryRoot)).toBe(false);
      expect(fs.existsSync(pathsA.root)).toBe(true);
      expect(() => pool!.forAgent(second)).toThrow("Unknown Agent");
      expect(await pool.forAgent(first).memos.recall({ nodeIds: [memoryA.id] })).toHaveLength(1);
    } finally {
      await pool?.close();
      removeDirectory(root);
    }
  });

  test("moves legacy databases once, preserves content and gives the original Agent exclusive namespace ownership", async () => {
    const root = createTemporaryDirectory("senera-learning-migration");
    const layout = resolveAgentWorkspaceLayout(root);
    const agentId = randomUUID();
    const paths = agentLearningPaths(layout, agentId);
    try {
      fs.mkdirSync(path.dirname(layout.databases.memory), { recursive: true });
      const old = new Database(layout.databases.memory);
      old.pragma("journal_mode = WAL");
      old.exec("CREATE TABLE legacy_data(value TEXT); INSERT INTO legacy_data VALUES('preserved')");
      old.close();
      const memory = await seedMemory(layout.databases.memos, "old-workspace", "Existing preference");
      await migrateWorkspaceLearning(layout, agentId);
      expect(fs.existsSync(layout.databases.memory)).toBe(false);
      const moved = new Database(paths.databasePath, { readonly: true });
      try {
        expect(moved.prepare("SELECT value FROM legacy_data").pluck().get()).toBe("preserved");
      } finally {
        moved.close();
      }
      const sdk = new MemOS({ dbPath: paths.memosDatabasePath, experimental: { namespaces: true } });
      await sdk.init();
      try {
        expect((await sdk.search({ namespace: agentId, limit: 10 })).map((entry) => entry.node.id)).toContain(
          memory.id,
        );
      } finally {
        await sdk.close();
      }
      await migrateWorkspaceLearning(layout, randomUUID());
      expect(fs.existsSync(paths.memosDatabasePath)).toBe(true);
    } finally {
      removeDirectory(root);
    }
  });
});
