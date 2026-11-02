import fs from "node:fs";
import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentMemoryDiaryRuntime } from "../../../Source/AgentSystem/Continuity/AgentMemoryDiaryRuntime.js";
import { AgentMemoryDiaryModel } from "../../../Source/AgentSystem/Continuity/AgentMemoryDiaryModel.js";
import { AgentMemoryDiaryStore } from "../../../Source/AgentSystem/Continuity/AgentMemoryDiaryStore.js";
import {
  AgentMemoryDiaryDefaults,
  AgentMemoryDiaryLimits,
  AgentMemoryDiaryKeySchema,
  AgentMemoryDiaryConfigSchema,
  type AgentMemoryDiarySource,
} from "../../../Source/AgentSystem/Continuity/AgentMemoryDiaryContract.js";
import { AgentBackgroundLearningRequestLedger } from "../../../Source/AgentSystem/Memory/AgentBackgroundLearningRequestLedger.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentModelTokenEstimator } from "../../../Source/AgentSystem/Text/AgentTextBudget.js";
import { createAgentSelfDiaryPort } from "../../../Source/AgentSystem/SelfService/AgentSelfDiary.js";
import { executeAgentSelfCommand } from "../../../Source/AgentSystem/SelfService/AgentSelfCommand.js";
import { parseAgentSelfCliCommand } from "../../../Source/AgentSystem/SelfService/AgentSelfCliParser.js";
import { createAgentSelfTestConfigPort } from "../SelfService/AgentSelfTestHarness.js";
import { createModelProvider, createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const cleanup: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) close();
});
function fixture() {
  const root = createTemporaryDirectory("senera-diaries");
  const store = new AgentMemoryDiaryStore(path.join(root, "diary"));
  const kernel = new AgentSqliteDatabaseKernel({
    databasePath: path.join(root, "jobs.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  cleanup.push(() => {
    kernel.close();
    removeDirectory(root);
  });
  const ledger = new AgentBackgroundLearningRequestLedger(kernel);
  const state = {
    now: "2026-10-27T00:00:00Z",
    config: { ...AgentMemoryDiaryDefaults },
    sources: [] as AgentMemoryDiarySource[],
  };
  const generate = vi.spyOn(AgentMemoryDiaryModel.prototype, "generate").mockImplementation(async (prompt) => ({
    title: `${prompt.key} 工作进展`,
    body:
      prompt.period === "day"
        ? prompt.entries.flatMap((entry) => entry.memories.map((memory) => memory.summary)).join("\n\n")
        : prompt.entries.map((entry) => entry.text).join("\n\n"),
  }));
  const runtime = new AgentMemoryDiaryRuntime({
    store,
    config: () => state.config,
    sources: async () => state.sources,
    model: () => createModelProvider(),
    scopeKey: "agent-a",
    learningRequests: ledger,
    withModelSlot: (operation) => operation(),
    policy: () => ({ enabled: true, maxAttempts: 1, retryBaseMs: 1, retryMaxDelayMs: 1, maxJobsPerDrain: 1 }),
    signal: new AbortController().signal,
    now: () => state.now,
  });
  return { root, store, ledger, state, generate, runtime };
}
function source(id: string, occurredAt = "2026-10-26T01:00:00Z", priority = 50, text = id): AgentMemoryDiarySource {
  return {
    id,
    occurredAt,
    userText: id,
    assistantText: text,
    learning: "completed",
    memories: [{ type: "context", summary: text, weight: priority }],
    episodeUris: [`episode:${id}`],
    sourceUris: [`source:${id}`],
  };
}
const metadata = { revision: "seed", episodeUris: ["episode:seed"], sourceUris: ["source:seed"] };

describe("filesystem memory diaries", () => {
  test("stores title and Markdown body under calendar directories; metadata contains no duplicate body", () => {
    const f = fixture();
    f.store.write("2026-10-26", { title: "附件上传修复", body: "## 结果\n\n确认手机端可发送 YAML。" }, metadata);
    expect(f.store.pathFor("2026-10-26")).toBe(path.join(f.store.root, "2026", "10", "26", "diary.md"));
    expect(f.store.read("2026-10-26")).toMatchObject({
      title: "附件上传修复",
      body: "## 结果\n\n确认手机端可发送 YAML。",
      metadata,
    });
    const sidecar = fs.readFileSync(path.join(f.store.root, "2026", "10", "26", ".diary.json"), "utf8");
    expect(sidecar).not.toContain("YAML");
    expect(f.store.pathFor("2026-10")).toBe(path.join(f.store.root, "2026", "10", "diary.md"));
  });

  test("rejects traversal, invalid calendar dates and budgets above product limits", () => {
    const f = fixture();
    for (const key of ["../2026-10", "2026-02-30", "2026-13", "2026-1-2"]) {
      expect(AgentMemoryDiaryKeySchema.safeParse(key).success).toBe(false);
      expect(() => f.store.read(key)).toThrow();
    }
    expect(
      AgentMemoryDiaryConfigSchema.safeParse({
        ...AgentMemoryDiaryDefaults,
        InputTokenBudget: AgentMemoryDiaryLimits.inputTokens + 1,
      }).success,
    ).toBe(false);
    expect(
      AgentMemoryDiaryConfigSchema.safeParse({ ...AgentMemoryDiaryDefaults, MonthlyPreviewTokens: 513 }).success,
    ).toBe(false);
    expect(AgentMemoryDiaryKeySchema.parse("2024-02-29")).toBe("2024-02-29");
  });

  test("rejects a directory junction without reading or overwriting its target", () => {
    const f = fixture();
    const outside = path.join(f.root, "outside");
    fs.mkdirSync(outside);
    fs.mkdirSync(f.store.root);
    fs.symlinkSync(outside, path.join(f.store.root, "2026"), "junction");
    expect(() => f.store.read("2026-10-26")).toThrow("symbolic links");
    expect(() => f.store.list()).toThrow("symbolic links");
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  test("waits for the end of a day, prioritizes important memories, and reuses committed revisions", async () => {
    const f = fixture();
    f.state.sources = [
      source("low", undefined, 10),
      source("high", undefined, 90),
      source("today", "2026-10-27T01:00:00Z"),
    ];
    await f.runtime.reconcile();
    expect(f.generate).toHaveBeenCalledOnce();
    const daily = f.generate.mock.calls[0]![0];
    expect(daily.period === "day" && daily.entries.map((entry) => entry.memories[0]!.summary)).toEqual(["high", "low"]);
    expect(f.store.read("2026-10-27")).toBeUndefined();
    expect(f.store.read("2026-10")).toBeUndefined();
    f.state.sources.reverse();
    f.state.config.RecentDays = 14;
    await f.runtime.reconcile();
    expect(f.generate).toHaveBeenCalledOnce();
    f.state.now = "2026-10-28T00:00:00Z";
    await f.runtime.reconcile();
    expect(f.store.read("2026-10-27")).toBeDefined();
    expect(f.generate).toHaveBeenCalledTimes(2);
  });

  test("does not generate empty days or an in-progress month, and catches up after month-end restart", async () => {
    const f = fixture();
    f.state.sources = [source("one", "2026-10-01T00:00:00Z"), source("last", "2026-10-31T00:00:00Z")];
    await f.runtime.reconcile();
    expect(f.store.list().map((entry) => entry.key)).toEqual(["2026-10-01"]);
    f.state.now = "2026-11-01T00:00:00Z";
    await f.runtime.reconcile();
    expect(f.store.list().map((entry) => entry.key)).toEqual(["2026-10", "2026-10-01", "2026-10-31"]);
    const monthCalls = () => f.generate.mock.calls.filter(([prompt]) => prompt.period === "month");
    expect(monthCalls()).toHaveLength(1);
    f.state.now = "2026-11-15T00:00:00Z";
    await f.runtime.reconcile();
    expect(monthCalls()).toHaveLength(1);
  });

  test("uses every daily title with only a prefix of each body and bounds the complete 31-day input", () => {
    const client = new AgentMemoryDiaryModel(createModelProvider(), "agent-a");
    const days = Array.from({ length: 31 }, (_, day) => ({
      key: `2026-10-${String(day + 1).padStart(2, "0")}`,
      title: `第 ${day + 1} 天结果与后续安排`,
      body: `开头 ${day + 1} ${"细节 evidence 中文\n".repeat(2000)} END_SENTINEL`,
    }));
    const prompt = client.monthly("2026-10", days, AgentMemoryDiaryDefaults);
    expect(prompt.entries.map((entry) => entry.title)).toEqual(days.map((day) => day.title));
    expect(client.inputTokens(prompt)).toBeLessThanOrEqual(AgentMemoryDiaryDefaults.InputTokenBudget);
    const estimator = new AgentModelTokenEstimator({ model: "test-model" });
    for (const entry of prompt.entries) {
      expect(entry.text).toMatch(/\.\.\.$/u);
      expect(entry.text).not.toContain("END_SENTINEL");
      expect(estimator.estimate(entry.text).tokenCount).toBeLessThanOrEqual(512);
    }
    const short = client.monthly(
      "2026-10",
      [{ key: "2026-10-01", title: "完成", body: "完整短正文。" }],
      AgentMemoryDiaryDefaults,
    );
    expect(short.entries[0]!.text).toBe("完整短正文。");
  });

  test("fits oversized high-priority daily records without serializing unbounded provenance", () => {
    const client = new AgentMemoryDiaryModel(createModelProvider(), "agent-a");
    const high = source("high", undefined, 100, "重要的实际结果 ".repeat(10000));
    const input = [
      { ...high, sourceUris: Array.from({ length: 10000 }, (_, id) => `source:${id}`) },
      source("low", undefined, 1, "LOW_SENTINEL"),
    ];
    const prompt = client.daily("2026-10-26", input, { ...AgentMemoryDiaryDefaults, InputTokenBudget: 1500 });
    expect(client.inputTokens(prompt)).toBeLessThanOrEqual(1500);
    expect(JSON.stringify(prompt)).not.toContain("sourceUris");
    expect(JSON.stringify(prompt)).not.toContain("LOW_SENTINEL");
    expect(prompt.omittedEntries).toBe(1);
    expect(prompt.entries[0]!.memories[0]!.summary).toMatch(/\.\.\.$/u);
  });

  test("exposes the previous seven completed calendar days as titles only", () => {
    const f = fixture();
    for (let day = 18; day <= 27; day++)
      f.store.write(`2026-10-${day}`, { title: `主题 ${day}`, body: "PRIVATE_BODY" }, metadata);
    const index = f.store.recentIndex("2026-10-27", 7);
    expect(index).toContain("# Memory index");
    expect(index).toContain("[主题 20](2026/10/20/diary.md)");
    expect(index).toContain("主题 26");
    expect(index).not.toContain("主题 19");
    expect(index).not.toContain("主题 27");
    expect(index).not.toContain("PRIVATE_BODY");
  });

  test("source deletion removes derived diaries, month summaries and in-flight results", async () => {
    const f = fixture();
    f.state.sources = [source("old", "2026-09-01T00:00:00Z")];
    await f.runtime.reconcile();
    expect(f.store.read("2026-09")).toBeDefined();
    let resolve!: (value: { title: string; body: string }) => void;
    f.generate.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    f.state.sources = [source("old", "2026-09-01T00:00:00Z", 99)];
    const pending = f.runtime.reconcile();
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    f.state.sources = [];
    f.runtime.invalidateSources(["episode:old"], ["source:old"]);
    resolve({ title: "过期结果", body: "不得重新写入" });
    await pending;
    expect(f.store.list()).toEqual([]);
    expect(fs.readFileSync(path.join(f.store.root, "index.md"), "utf8")).not.toContain("过期结果");
  });

  test("failed generation remains an explicit job failure and never creates a substitute diary", async () => {
    const f = fixture();
    f.state.sources = [source("failed")];
    f.generate.mockRejectedValue(new Error("provider unavailable"));
    await expect(f.runtime.reconcile()).rejects.toThrow("provider unavailable");
    expect(f.store.read("2026-10-26")).toBeUndefined();
    expect(f.ledger.list({ stage: "daily_diary", status: "exhausted" })).toHaveLength(1);
  });

  test("erases imported documents without source provenance and their original archives", () => {
    const f = fixture();
    f.store.write(
      "2026-09",
      { title: "旧月记", body: "来源已经不可追溯。" },
      {
        revision: "legacy:old",
        importedFrom: "old",
        episodeUris: [],
        sourceUris: [],
      },
    );
    f.store.archiveLegacy("2026-09", "old", "来源已经不可追溯。");
    f.runtime.invalidateSources(["episode:erased"], ["source:erased"]);
    expect(f.store.read("2026-09")).toBeUndefined();
    expect(fs.readdirSync(path.join(f.store.root, "legacy"))).toEqual([]);
  });

  test("a failed day blocks that month's summary while independent dates continue", async () => {
    const f = fixture();
    f.state.sources = [
      source("failed", "2026-09-01T00:00:00Z"),
      source("good", "2026-09-02T00:00:00Z"),
      source("independent"),
    ];
    f.generate.mockRejectedValueOnce(new Error("one day failed"));
    await expect(f.runtime.reconcile()).rejects.toThrow("one day failed");
    expect(f.store.read("2026-09-01")).toBeUndefined();
    expect(f.store.read("2026-09-02")).toBeDefined();
    expect(f.store.read("2026-10-26")).toBeDefined();
    expect(f.store.read("2026-09")).toBeUndefined();
    expect(f.generate.mock.calls.some(([prompt]) => prompt.period === "month")).toBe(false);
  });

  test("small model windows share Pi's input reserve", () => {
    const client = new AgentMemoryDiaryModel(createModelProvider({ ContextWindowTokens: 4096 }), "agent-a");
    const prompt = client.daily(
      "2026-10-26",
      [source("large", undefined, 90, "可验证的信息 ".repeat(10000))],
      AgentMemoryDiaryDefaults,
    );
    expect(client.inputTokens(prompt)).toBeLessThanOrEqual(2048);
  });

  test("calendar boundaries follow the declared time zone, including daylight-saving transitions", () => {
    const f = fixture();
    f.state.config.TimeZone = "America/New_York";
    expect(f.runtime.nextBoundaryDelay(Temporal.Instant.from("2026-03-08T05:00:00Z"))).toBe(23 * 60 * 60 * 1000);
    f.state.config.TimeZone = "Asia/Shanghai";
    expect(f.runtime.nextBoundaryDelay(Temporal.Instant.from("2026-10-31T15:59:00Z"))).toBe(60 * 1000);
  });

  test("CLI and model commands use the same validated calendar keys and isolated Agent store", async () => {
    const f = fixture();
    f.store.write("2026-10-26", { title: "恢复上传", body: "只属于 Agent A 的正文。" }, metadata);
    const other = new AgentMemoryDiaryStore(path.join(f.root, "other"));
    const diaries = createAgentSelfDiaryPort({
      store: (id) => (id === "b" ? other : f.store),
      config: () => AgentMemoryDiaryDefaults,
    });
    const port = { workspaceRoot: f.root, ...createAgentSelfTestConfigPort({ ModelProviders: [] }).port(), diaries };
    expect(parseAgentSelfCliCommand(["diary", "read", "2026-10-26"])).toEqual({
      command: "diary",
      action: "read",
      period: "2026-10-26",
    });
    expect(() => parseAgentSelfCliCommand(["diary", "read", "2026-02-30"])).toThrow();
    const list = await executeAgentSelfCommand({ command: "diary", action: "list", period: "2026-10" }, port);
    expect(list.text).toContain("[恢复上传](2026/10/26/diary.md)");
    expect(list.text).not.toContain("正文");
    const read = await executeAgentSelfCommand({ command: "diary", action: "read", period: "2026-10-26" }, port);
    expect(read.text).toContain("只属于 Agent A 的正文");
    expect(diaries.read("2026-10-26", "b")).toBeUndefined();
  });
});
