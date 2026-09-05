import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentContinuityMemoryService } from "../../../Source/AgentSystem/Continuity/AgentContinuityMemoryService.js";
import { AgentContinuityRecordRanker } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecordRanker.js";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import {
  AgentContinuityPromptBudgetDefaults,
  AgentContinuityRecallRankingDefaults,
  AgentContinuitySemanticRecallDefaults,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallDefaults.js";
import { AgentContinuityStableSnapshotStore } from "../../../Source/AgentSystem/Continuity/AgentContinuityStableSnapshotStore.js";
import type { AgentContinuityObservation } from "../../../Source/AgentSystem/Continuity/AgentContinuityDomain.js";
import { AgentEventKinds } from "../../../Source/AgentSystem/Events/AgentEventCatalog.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { testContinuityIdentity } from "./AgentContinuityTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("continuity memory service", () => {
  test("projects only query-related fact heads without creating a markdown context path", async () => {
    const workspaceRoot = createWorkspace();
    const store = createStore(workspaceRoot);
    try {
      store.recordObservation(observation(workspaceRoot, "preference", "用户偏好先给结论，再给必要依据。"));
      store.recordObservation(observation(workspaceRoot, "preference-repeat", "用户偏好先给结论，再给必要依据。"));
      store.recordObservation(observation(workspaceRoot, "palette", "用户喜欢低饱和绿色界面。"));
      const context = await new AgentContinuityMemoryService({
        identity: testContinuityIdentity(workspaceRoot),
        store,
      }).promptContext({
        userInput: "用户偏好先给结论，再给必要依据。",
        sessionId: "session-1",
      });

      expect(context.factCatalog.map((entry) => entry.claim)).toEqual(["用户偏好先给结论，再给必要依据。"]);
      expect(context.selection.facts).toEqual({ selected: 1, matched: 1, available: 2 });
      expect(context).not.toHaveProperty("recalled");
      expect(context).not.toHaveProperty("worldbook");
      expect(context).not.toHaveProperty("indexFile");
    } finally {
      store.close();
    }
  });

  test("records the raw user query and URI-free local recall plan in the audit stream", async () => {
    const workspaceRoot = createWorkspace();
    const store = createStore(workspaceRoot);
    try {
      store.recordObservation(observation(workspaceRoot, "residence", "用户住在上海。"));
      const events: unknown[] = [];
      await new AgentContinuityMemoryService({
        identity: testContinuityIdentity(workspaceRoot),
        store,
        eventSink: (event) => {
          events.push(event);
        },
      }).promptContext({ userInput: "上海", sessionId: "session-1", requestId: "request-1" });

      expect(events).toContainEqual(
        expect.objectContaining({
          kind: AgentEventKinds.ContinuityRecallQuery,
          data: expect.objectContaining({
            original: "上海",
            local: expect.objectContaining({
              expanded: true,
              anchorLabels: [],
            }),
          }),
        }),
      );
      expect(JSON.stringify(events)).not.toContain("senera://continuity-concept/");
    } finally {
      store.close();
    }
  });

  test("keeps a user fact available across sessions through the user scope", async () => {
    const workspaceRoot = createWorkspace();
    const store = createStore(workspaceRoot);
    try {
      store.recordObservation({
        ...observation(workspaceRoot, "residence", "用户住在上海。"),
        scope: { kind: "user", id: workspaceRoot },
      });

      const context = await new AgentContinuityMemoryService({
        identity: testContinuityIdentity(workspaceRoot),
        store,
      }).promptContext({
        userInput: "用户住在上海。",
        sessionId: "new-session",
      });

      expect(context.evidenceCandidates).toEqual([]);
      expect(context.factCatalog).toEqual([
        expect.objectContaining({
          claim: "用户住在上海。",
          sourceRefs: ["senera://memory-source/residence"],
        }),
      ]);
    } finally {
      store.close();
    }
  });

  test("projects only the most specific active fact head for a shared identity", async () => {
    const workspaceRoot = createWorkspace();
    const store = createStore(workspaceRoot);
    try {
      store.recordObservation({
        ...observation(workspaceRoot, "workspace-location", "用户住在杭州。"),
        scope: { kind: "workspace", id: workspaceRoot },
        payload: { kind: "fact", fact: "用户住在杭州。", factKey: "user.location", until: "permanent" },
      });
      store.recordObservation({
        ...observation(workspaceRoot, "user-location", "用户住在上海。"),
        scope: { kind: "user", id: workspaceRoot },
        payload: { kind: "fact", fact: "用户住在上海。", factKey: "user.location", until: "permanent" },
      });

      const context = await new AgentContinuityMemoryService({
        identity: testContinuityIdentity(workspaceRoot),
        store,
      }).promptContext({
        userInput: "用户住在上海。",
        sessionId: "new-session",
      });

      expect(context.factCatalog).toEqual([
        expect.objectContaining({ factKey: "user.location", claim: "用户住在上海。" }),
      ]);
    } finally {
      store.close();
    }
  });

  test("does not inject a valid cross-session fact without a matching query", async () => {
    const workspaceRoot = createWorkspace();
    const store = createStore(workspaceRoot);
    try {
      store.recordObservation({
        ...observation(workspaceRoot, "residence-direct", "用户住在上海。"),
        scope: { kind: "user", id: workspaceRoot },
      });

      const context = await new AgentContinuityMemoryService({
        identity: testContinuityIdentity(workspaceRoot),
        store,
      }).promptContext({
        userInput: "今天先聊点别的。",
        sessionId: "new-session",
      });

      expect(context.factCatalog).toEqual([]);
      expect(context.evidenceCandidates).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("keeps fact changes out of the stable profile snapshot", async () => {
    const workspaceRoot = createWorkspace();
    const databasePath = path.join(workspaceRoot, ".senera", "data", "memory.sqlite");
    const store = new AgentContinuitySqliteStore(databasePath);
    const stableSnapshotStore = new AgentContinuityStableSnapshotStore(databasePath);
    try {
      const service = new AgentContinuityMemoryService({
        identity: testContinuityIdentity(workspaceRoot),
        store,
        stableSnapshotStore,
      });

      const initial = await service.promptContext({ userInput: "你好", sessionId: "same-session" });
      expect(initial.factCatalog).toEqual([]);
      const initialSnapshot = stableSnapshotStore.read("same-session");

      store.recordObservation(observation(workspaceRoot, "same-session-location", "用户住在上海。"));

      const refreshed = await service.promptContext({ userInput: "用户住在上海。", sessionId: "same-session" });
      expect(refreshed.factCatalog).toEqual([expect.objectContaining({ claim: "用户住在上海。" })]);
      expect(stableSnapshotStore.read("same-session")).toEqual(
        expect.objectContaining({
          revision: initialSnapshot?.revision,
          residentProfile: [],
        }),
      );
    } finally {
      stableSnapshotStore.close();
      store.close();
    }
  });

  test("never surfaces raw conversation observations as related event candidates", async () => {
    const workspaceRoot = createWorkspace();
    const store = createStore(workspaceRoot);
    try {
      store.recordObservation({
        ...observation(workspaceRoot, "event-1", "用户昨天在上海参加了羽毛球活动。"),
        kind: "conversation.user_message",
        scope: { kind: "workspace", id: workspaceRoot },
        payload: { sourceRef: "senera://memory-source/event-1" },
        sourceRefs: ["senera://memory-source/event-1"],
      });

      const context = await new AgentContinuityMemoryService({
        identity: testContinuityIdentity(workspaceRoot),
        store,
      }).promptContext({
        userInput: "上海的羽毛球活动",
        sessionId: "session-1",
      });

      // Raw dialog observations are process records, not durable memory: the
      // original text already lives in the chat stream and tool results live
      // in Artifact/evidence. Candidates stay empty until learned,
      // time-pointed event summaries exist.
      expect(context.eventCandidates).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("does not re-inject current-session physical events into automatic context", async () => {
    const workspaceRoot = createWorkspace();
    const store = createStore(workspaceRoot);
    try {
      store.recordObservation({
        ...observation(workspaceRoot, "current-event", "当前会话已经讨论过上海的羽毛球活动。"),
        kind: "conversation.user_message",
        scope: { kind: "session", id: "session-1" },
        payload: { sourceRef: "senera://memory-source/current-event" },
        sourceRefs: ["senera://memory-source/current-event"],
      });

      const context = await new AgentContinuityMemoryService({
        identity: testContinuityIdentity(workspaceRoot),
        store,
      }).promptContext({
        userInput: "上海的羽毛球活动",
        sessionId: "session-1",
      });

      expect(context.eventCandidates).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("does not re-inject current-session learning facts into automatic context", async () => {
    const workspaceRoot = createWorkspace();
    const store = createStore(workspaceRoot);
    try {
      store.recordObservation({
        ...observation(workspaceRoot, "current-fact", "当前会话暂时使用深色主题。"),
        scope: { kind: "session", id: "session-1" },
        payload: { kind: "fact", fact: "当前会话暂时使用深色主题。", factKey: "ui.theme", until: "session" },
      });

      const context = await new AgentContinuityMemoryService({
        identity: testContinuityIdentity(workspaceRoot),
        store,
      }).promptContext({
        userInput: "当前会话暂时使用深色主题。",
        sessionId: "session-1",
      });

      expect(context.factCatalog).toEqual([]);
      expect(context.evidenceCandidates).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("invalidates automatic recall after physical source deletion", async () => {
    const workspaceRoot = createWorkspace();
    const store = createStore(workspaceRoot);
    try {
      store.recordObservation({
        ...observation(workspaceRoot, "deletable", "用户住在上海。"),
        sourceRefs: ["senera://memory-source/deletable"],
      });
      const service = new AgentContinuityMemoryService({ identity: testContinuityIdentity(workspaceRoot), store });

      expect(
        (await service.promptContext({ userInput: "用户住在上海。", sessionId: "session-1" })).factCatalog,
      ).toHaveLength(1);

      const impact = {
        sessionId: "session-1",
        episodeUris: [],
        sourceUris: ["senera://memory-source/deletable"],
      } as const;
      store.deleteSources(impact);
      service.deleteSources(impact);

      const context = await service.promptContext({ userInput: "用户住在上海。", sessionId: "session-1" });
      expect(context.factCatalog).toEqual([]);
      expect(context.evidenceCandidates).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("keeps all relevant candidates for diagnostics instead of applying a hidden count cap", () => {
    const observations = Array.from({ length: 28 }, (_, index) =>
      observation("workspace", `record-${index}`, "用户偏好先给结论"),
    );
    const ranked = new AgentContinuityRecordRanker().rank({
      query: "用户偏好先给结论",
      observations,
      now: new Date("2026-08-23T02:00:00.000Z"),
    });

    expect(ranked.records).toHaveLength(28);
  });

  test("projects permanent states through a stable prompt-template contract", async () => {
    const workspaceRoot = createWorkspace();
    const store = createStore(workspaceRoot);
    try {
      store.upsertSignal({
        scope: { kind: "workspace", id: workspaceRoot },
        namespace: "semantic",
        key: "用户已完成运动",
        value: true,
        valueType: "boolean",
        authority: "user_explicit",
        confidence: 1,
        observedAt: "2026-08-23T01:00:00.000Z",
        sourceRefs: ["senera://memory-source/exercise"],
      });

      const context = await new AgentContinuityMemoryService({
        identity: testContinuityIdentity(workspaceRoot),
        store,
      }).promptContext({
        userInput: "继续",
        sessionId: "session-1",
      });

      expect(context.signals).toEqual([
        expect.objectContaining({
          summary: "用户已完成运动",
          valueJson: "true",
          expiresAt: "",
        }),
      ]);
    } finally {
      store.close();
    }
  });

  test("skips text recall for classified unproductive prompts while preserving evaluated state", async () => {
    const workspaceRoot = createWorkspace();
    const store = createStore(workspaceRoot);
    try {
      store.recordObservation(observation(workspaceRoot, "fact", "用户喜欢无糖咖啡。"));
      store.upsertSignal({
        scope: { kind: "workspace", id: workspaceRoot },
        namespace: "semantic",
        key: "用户已完成运动",
        value: true,
        valueType: "boolean",
        authority: "user_explicit",
        confidence: 1,
        observedAt: "2026-08-23T01:00:00.000Z",
        sourceRefs: ["senera://memory-source/exercise"],
      });

      const context = await new AgentContinuityMemoryService({
        identity: testContinuityIdentity(workspaceRoot),
        store,
        recallConfig: () => ({
          TurnValueClassifier: {
            Enabled: true,
            ConfidenceThreshold: 0.82,
            MinimumExamplesPerLabel: 3,
            MaxTrainingEntries: 4096,
          },
          Prefetch: { Enabled: true, CacheTtlSeconds: 300 },
          PromptBudget: AgentContinuityPromptBudgetDefaults,
          Ranking: AgentContinuityRecallRankingDefaults,
          Semantic: AgentContinuitySemanticRecallDefaults,
        }),
        turnValueClassification: () => ({
          label: "unproductive",
          confidence: 0.95,
          trainedExamples: { valuable: 3, unproductive: 3 },
        }),
      }).promptContext({ userInput: "继续", sessionId: "session-1" });

      expect(context.evidenceCandidates).toEqual([]);
      expect(context.signals).toEqual([expect.objectContaining({ summary: "用户已完成运动" })]);
    } finally {
      store.close();
    }
  });

  test("keeps semantic recall optional when the policy is enabled without a provider", async () => {
    const workspaceRoot = createWorkspace();
    const store = createStore(workspaceRoot);
    try {
      store.recordObservation(observation(workspaceRoot, "fact", "用户喜欢无糖咖啡。"));
      const context = await new AgentContinuityMemoryService({
        identity: testContinuityIdentity(workspaceRoot),
        store,
        recallConfig: () => ({
          TurnValueClassifier: {
            Enabled: false,
            ConfidenceThreshold: 0.82,
            MinimumExamplesPerLabel: 3,
            MaxTrainingEntries: 4096,
          },
          Prefetch: { Enabled: false, CacheTtlSeconds: 300 },
          PromptBudget: AgentContinuityPromptBudgetDefaults,
          Ranking: AgentContinuityRecallRankingDefaults,
          Semantic: { ...AgentContinuitySemanticRecallDefaults, Enabled: true },
        }),
      }).promptContext({ userInput: "那个事情怎么样", sessionId: "session-1" });

      expect(context).toBeDefined();
      expect(context.evidenceCandidates).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("projects an ordinary match as physical references without injecting its summary", async () => {
    const workspaceRoot = createWorkspace();
    const store = createStore(workspaceRoot);
    try {
      store.recordObservation(observation(workspaceRoot, "coffee", "用户喜欢无糖咖啡。"));
      const context = await new AgentContinuityMemoryService({
        identity: testContinuityIdentity(workspaceRoot),
        store,
      }).promptContext({
        userInput: "我想确认无糖咖啡以及其他饮食习惯和作息安排",
        sessionId: "session-1",
      });

      expect(context.evidenceCandidates).toEqual([
        expect.objectContaining({
          sourceRefs: ["senera://memory-source/coffee"],
          matchedBy: expect.arrayContaining(["lexical"]),
        }),
      ]);
      expect(JSON.stringify(context.evidenceCandidates)).not.toContain("用户喜欢无糖咖啡");
    } finally {
      store.close();
    }
  });

  test("filters unrelated high-confidence records before authority and recency can affect ranking", () => {
    const ranked = new AgentContinuityRecordRanker().rank({
      query: "如何安排今天的运动",
      observations: [
        observation("workspace", "exercise", "用户计划今天下午运动。"),
        observation("workspace", "colors", "用户喜欢低饱和绿色界面。"),
      ],
      now: new Date("2026-08-23T02:00:00.000Z"),
    });

    expect(ranked.records.map((entry) => entry.observation.uri)).toEqual(["senera://continuity-learning/exercise"]);
  });

  test("does not retrieve a learned fact after its physical lifetime expires", () => {
    const live = observation("workspace", "live", "用户本周暂时不喝咖啡。", "2026-08-30T01:00:00.000Z");
    const expired = observation("workspace", "expired", "用户上周暂时不喝咖啡。", "2026-08-22T01:00:00.000Z");
    const ranked = new AgentContinuityRecordRanker().rank({
      query: "用户暂时不喝咖啡",
      observations: [live, expired],
      now: new Date("2026-08-23T02:00:00.000Z"),
    });

    expect(ranked.records.map((entry) => entry.observation.uri)).toEqual([live.uri]);
  });

  test("keeps one-shot rules pending until their projected turn is acknowledged", async () => {
    const workspaceRoot = createWorkspace();
    const store = createStore(workspaceRoot);
    try {
      const rule = store.recordRule({
        title: "余额提醒",
        condition: { kind: "always" },
        action: { kind: "notify", summary: "提醒用户充值。", activation: "once" },
        scope: { kind: "workspace", id: workspaceRoot },
        authority: "user_explicit",
        confidence: 1,
        temporal: { kind: "persistent", timeZone: "Asia/Shanghai" },
        sourceRefs: ["senera://memory-source/balance"],
      });
      const service = new AgentContinuityMemoryService({ identity: testContinuityIdentity(workspaceRoot), store });

      const first = await service.promptContext({ userInput: "继续", sessionId: "session-1" });
      const retry = await service.promptContext({ userInput: "重试", sessionId: "session-1" });

      expect(first.pendingRuleDeliveryUris).toEqual([rule.uri]);
      expect(retry.pendingRuleDeliveryUris).toEqual([rule.uri]);
      expect(store.listRules([rule.scope])[0]).toMatchObject({ status: "triggered" });
      expect(store.listRules([rule.scope])[0]?.lastTriggeredAt).toBeUndefined();

      expect(service.acknowledgeRuleDeliveries(first.pendingRuleDeliveryUris, "2026-08-23T03:00:00.000Z")).toBe(1);
      expect(service.acknowledgeRuleDeliveries(first.pendingRuleDeliveryUris, "2026-08-23T04:00:00.000Z")).toBe(0);
      const delivered = await service.promptContext({ userInput: "再次继续", sessionId: "session-1" });
      expect(delivered.pendingRuleDeliveryUris).toEqual([]);
      expect(delivered.activeRules).toEqual([]);
      expect(store.listRules([rule.scope])[0]).toMatchObject({
        status: "resolved",
        lastTriggeredAt: "2026-08-23T03:00:00.000Z",
      });
    } finally {
      store.close();
    }
  });
});

function observation(
  workspaceRoot: string,
  id: string,
  summary: string,
  until = "permanent",
): AgentContinuityObservation {
  return {
    id,
    uri: `senera://continuity-learning/${id}`,
    kind: "learning.record",
    summary,
    payload: { kind: "fact", summary, until },
    sourceRefs: [`senera://memory-source/${id}`],
    watermark: `wm-${id}`,
    scope: { kind: "workspace", id: workspaceRoot },
    authority: "user_explicit",
    confidence: 1,
    occurredAt: "2026-08-23T01:00:00.000Z",
    observedAt: "2026-08-23T01:00:01.000Z",
    createdAtMs: Date.parse("2026-08-23T01:00:01.000Z"),
  };
}

function createWorkspace(): string {
  const workspace = createTemporaryDirectory("senera-continuity-memory");
  workspaces.add(workspace);
  return workspace;
}

function createStore(workspaceRoot: string): AgentContinuitySqliteStore {
  return new AgentContinuitySqliteStore(path.join(workspaceRoot, ".senera", "data", "memory.sqlite"));
}
