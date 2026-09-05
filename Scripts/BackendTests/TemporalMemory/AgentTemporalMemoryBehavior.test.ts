import { afterEach, describe, expect, test, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { SqliteAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { AgentTemporalMemorySqliteStore } from "../../../Source/AgentSystem/TemporalMemory/AgentTemporalMemorySqliteStore.js";
import { AgentTemporalMemoryRecall } from "../../../Source/AgentSystem/TemporalMemory/AgentTemporalMemoryRecall.js";
import { AgentTemporalMemoryRuntime } from "../../../Source/AgentSystem/TemporalMemory/AgentTemporalMemoryRuntime.js";
import {
  agentTemporalMemoryCalendarPeriod,
  agentTemporalMemoryRange,
} from "../../../Source/AgentSystem/TemporalMemory/AgentTemporalMemoryPeriod.js";
import type {
  AgentTemporalMemoryDigest,
  AgentTemporalMemoryScope,
} from "../../../Source/AgentSystem/TemporalMemory/AgentTemporalMemoryTypes.js";
import { projectAgentTemporalMemoryScope } from "../../../Source/AgentSystem/TemporalMemory/AgentTemporalMemoryIdentity.js";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import { recallContinuity } from "../../../Source/AgentSystem/Continuity/AgentContinuityToolRuntime.js";
import { AgentContinuityRecallRankingDefaults } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallDefaults.js";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import { AgentWorldEventLedger } from "../../../Source/AgentSystem/World/AgentWorldEventLedger.js";
import { AgentTemporalMemoryWorldBridge } from "../../../Source/AgentSystem/World/AgentTemporalMemoryWorldBridge.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const TimeZone = "Asia/Shanghai";
const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("temporal memory", () => {
  test("covers broad ranges with complete months and boundary days without duplicate descendants", () => {
    const fixture = createFixture();
    try {
      const june = createDay(fixture.store, fixture.scope, "2026-06-20");
      const july = createMonth(fixture.store, fixture.scope, "2026-07", "2026-07-10");
      const august = createMonth(fixture.store, fixture.scope, "2026-08", "2026-08-12");
      const september = createDay(fixture.store, fixture.scope, "2026-09-05");
      const result = new AgentTemporalMemoryRecall(fixture.store).read({
        scopeKey: fixture.scope.key,
        range: agentTemporalMemoryRange("2026-06-15", "2026-09-15", TimeZone),
      });

      expect(result.digests.map((digest) => [digest.granularity, digest.digestRef])).toEqual([
        ["day", june.uri],
        ["month", july.uri],
        ["month", august.uri],
        ["day", september.uri],
      ]);
      expect(result.digests.flatMap((digest) => digest.sourceRefs)).not.toContain(july.uri);
      expect(result.coveredEpisodeUris.size).toBe(4);
    } finally {
      fixture.kernel.close();
    }
  });

  test("materializes segment, day, and month summaries from completed physical turns", async () => {
    const fixture = createFixture();
    const sources = new SqliteAgentMemorySourceRepository(fixture.kernel);
    recordTurn(
      sources,
      "request-1",
      "2026-08-29T01:00:00.000Z",
      "2026-08-29T01:00:02.000Z",
      "今天开始整理画稿。",
      "先整理草图。",
    );
    recordTurn(
      sources,
      "request-2",
      "2026-08-29T01:05:00.000Z",
      "2026-08-29T01:05:02.000Z",
      "草图已经整理好了。",
      "接下来可以上色。",
    );
    const summarize = vi.fn(async (input: { readonly granularity: string }) => ({
      summary: `${input.granularity} summary`,
      topics: ["画稿"],
      openLoops: input.granularity === "segment" ? ["上色"] : [],
    }));
    const runtime = new AgentTemporalMemoryRuntime({
      store: fixture.store,
      sources,
      identity: { workspaceId: fixture.workspace, worldId: "world-1" },
      timeZone: () => TimeZone,
      policy: () => ({
        enabled: true,
        maxAttempts: 2,
        retryBaseMs: 1_000,
        retryMaxDelayMs: 10_000,
        maxJobsPerDrain: 2,
      }),
      boundaryClient: () => ({
        classify: async () => ({ relation: "continue", confidence: 1, focus: "整理画稿" }),
      }),
      summaryClient: () => ({ summarize }),
      now: () => Temporal.Instant.from("2026-09-01T01:00:00.000Z"),
    });

    try {
      runtime.start();
      await runtime.flush();
      const digests = fixture.store.list(fixture.scope.key, { statuses: ["sealed"] });
      expect(digests.map((digest) => digest.granularity)).toEqual(["month", "day", "segment"]);
      expect(summarize.mock.calls.map(([input]) => input.granularity)).toEqual(["segment", "day", "month"]);
      const month = digests.find((digest) => digest.granularity === "month")!;
      const dayRef = fixture.store.members(month.id)[0]?.memberUri;
      const day = dayRef ? fixture.store.digestByUri(dayRef) : undefined;
      expect(day?.granularity).toBe("day");
      const segmentRef = day ? fixture.store.members(day.id)[0]?.memberUri : undefined;
      const segment = segmentRef ? fixture.store.digestByUri(segmentRef) : undefined;
      expect(segment?.granularity).toBe("segment");
      expect(segment ? fixture.store.members(segment.id).map((member) => member.memberKind) : []).toEqual([
        "episode",
        "episode",
      ]);
    } finally {
      await runtime.stop();
      fixture.kernel.close();
    }
  });

  test("uses an independent semantic decision to split unrelated completed turns", async () => {
    const fixture = createFixture();
    const sources = new SqliteAgentMemorySourceRepository(fixture.kernel);
    recordTurn(
      sources,
      "request-topic-a",
      "2026-08-29T01:00:00.000Z",
      "2026-08-29T01:00:02.000Z",
      "继续整理画稿。",
      "先把草图归档。",
    );
    recordTurn(
      sources,
      "request-topic-b",
      "2026-08-29T01:01:00.000Z",
      "2026-08-29T01:01:02.000Z",
      "明天上海会下雨吗？",
      "我来查天气。",
    );
    const classify = vi.fn(async () => ({ relation: "boundary" as const, confidence: 0.98, focus: "上海天气" }));
    const runtime = new AgentTemporalMemoryRuntime({
      store: fixture.store,
      sources,
      identity: { workspaceId: fixture.workspace, worldId: "world-1" },
      timeZone: () => TimeZone,
      policy: () => ({
        enabled: true,
        maxAttempts: 2,
        retryBaseMs: 1_000,
        retryMaxDelayMs: 10_000,
        maxJobsPerDrain: 8,
      }),
      boundaryClient: () => ({ classify }),
      summaryClient: () => ({
        summarize: async (input) => ({ summary: `${input.granularity} summary`, topics: [], openLoops: [] }),
      }),
      now: () => Temporal.Instant.from("2026-09-01T01:00:00.000Z"),
    });

    try {
      runtime.start();
      await runtime.flush();
      const segments = fixture.store.list(fixture.scope.key, {
        granularities: ["segment"],
        statuses: ["sealed"],
      });
      expect(segments).toHaveLength(2);
      expect(segments.map((segment) => fixture.store.members(segment.id).map((member) => member.memberUri))).toEqual([
        [expect.stringContaining("memory-episode")],
        [expect.stringContaining("memory-episode")],
      ]);
      expect(classify).toHaveBeenCalledOnce();
    } finally {
      await runtime.stop();
      fixture.kernel.close();
    }
  });

  test("keeps semantic boundary input bounded with a persisted working focus", async () => {
    const fixture = createFixture();
    const sources = new SqliteAgentMemorySourceRepository(fixture.kernel);
    recordTurn(
      sources,
      "request-focus-1",
      "2026-08-29T01:00:00.000Z",
      "2026-08-29T01:00:02.000Z",
      "继续整理画稿。",
      "先把草图归档。",
    );
    recordTurn(
      sources,
      "request-focus-2",
      "2026-08-29T01:01:00.000Z",
      "2026-08-29T01:01:02.000Z",
      "线稿也一起整理。",
      "线稿已经归到同一批。",
    );
    recordTurn(
      sources,
      "request-focus-3",
      "2026-08-29T01:02:00.000Z",
      "2026-08-29T01:02:02.000Z",
      "接着准备上色。",
      "先确定配色。",
    );
    const classify = vi
      .fn()
      .mockResolvedValueOnce({ relation: "continue" as const, confidence: 0.97, focus: "整理画稿素材" })
      .mockResolvedValueOnce({ relation: "continue" as const, confidence: 0.96, focus: "整理画稿并准备上色" });
    const runtime = new AgentTemporalMemoryRuntime({
      store: fixture.store,
      sources,
      identity: { workspaceId: fixture.workspace, worldId: "world-1" },
      timeZone: () => TimeZone,
      policy: () => ({
        enabled: true,
        maxAttempts: 2,
        retryBaseMs: 1_000,
        retryMaxDelayMs: 10_000,
        maxJobsPerDrain: 8,
      }),
      boundaryClient: () => ({ classify }),
      summaryClient: () => ({
        summarize: async () => ({ summary: "unused", topics: [], openLoops: [] }),
      }),
      now: () => Temporal.Instant.from("2026-08-29T02:00:00.000Z"),
    });

    try {
      runtime.start();
      await runtime.flush();
      expect(classify).toHaveBeenCalledTimes(2);
      expect(classify.mock.calls[0]?.[0].openSegment).toMatchObject({
        focus: null,
        turns: [{ user: "继续整理画稿。" }],
      });
      expect(classify.mock.calls[1]?.[0].openSegment).toMatchObject({
        focus: "整理画稿素材",
        turns: [{ user: "线稿也一起整理。" }],
      });
      const openSegment = fixture.store.openSegment(fixture.scope.key, "session-1");
      expect(openSegment?.workingFocus).toBe("整理画稿并准备上色");
      expect(openSegment ? fixture.store.members(openSegment.id) : []).toHaveLength(3);
    } finally {
      await runtime.stop();
      fixture.kernel.close();
    }
  });

  test("returns a sealed day digest instead of expanding covered episode text", () => {
    const fixture = createFixture();
    const sources = new SqliteAgentMemorySourceRepository(fixture.kernel);
    try {
      const turn = recordTurn(
        sources,
        "request-covered",
        "2026-08-29T01:00:00.000Z",
        "2026-08-29T01:00:02.000Z",
        "今天整理了画稿。",
        "记下了。",
      );
      const instant = Temporal.Instant.from(turn.episode.completedAt);
      const dayPeriod = agentTemporalMemoryCalendarPeriod("day", instant, TimeZone);
      const segment = sealDigest(fixture.store, fixture.scope, {
        granularity: "segment",
        key: "covered-segment",
        start: turn.episode.startedAt,
        end: turn.episode.completedAt,
        memberUri: turn.episode.uri,
        memberKind: "episode",
      });
      const day = sealDigest(fixture.store, fixture.scope, {
        granularity: "day",
        key: "2026-08-29",
        start: dayPeriod.start.toString(),
        end: dayPeriod.end.toString(),
        memberUri: segment.uri,
        memberKind: "digest",
      });

      const result = recallContinuity(
        { from: "2026-08-29", to: "2026-08-29" },
        {
          store: new AgentContinuitySqliteStore(fixture.kernel),
          sourceRepository: sources,
          temporalMemoryStore: fixture.store,
          identity: { workspaceId: fixture.workspace, runtimeId: "runtime-1", worldId: "world-1" },
          ranking: AgentContinuityRecallRankingDefaults,
          timeZone: TimeZone,
        },
      );

      expect(result.digests.item).toEqual([expect.objectContaining({ digestRef: day.uri, granularity: "day" })]);
      expect(result.episodes.item).toEqual([]);
      expect(result.sources.item).toEqual([]);
    } finally {
      fixture.kernel.close();
    }
  });

  test("replaces revised world timeline projections and removes deleted evidence", () => {
    const fixture = createFixture();
    try {
      const agenda = new AgentAgendaService({ store: new AgentAgendaSqliteStore(fixture.kernel) });
      const ledger = new AgentWorldEventLedger(fixture.kernel, agenda);
      const bridge = new AgentTemporalMemoryWorldBridge({
        store: fixture.store,
        ledger,
        agenda,
        timeZone: () => TimeZone,
      });
      const episodeUri = "senera://memory-episode/revised";
      const original = sealDigest(fixture.store, fixture.scope, {
        granularity: "segment",
        key: "revised-segment",
        start: "2026-08-29T01:00:00.000Z",
        end: "2026-08-29T01:05:00.000Z",
        memberUri: episodeUri,
        memberKind: "episode",
      });
      bridge.observe(original);
      fixture.store.replaceMembers(
        original.id,
        [
          {
            memberUri: episodeUri,
            memberKind: "episode",
            occurredAt: original.periodStart,
            sourceRevision: "revision-2",
          },
        ],
        {
          periodStart: original.periodStart,
          periodEnd: original.periodEnd,
          status: "pending",
          now: "2026-10-02T00:00:00.000Z",
        },
      );
      const revised = fixture.store.seal(
        original.id,
        { summary: "revised summary", topics: ["修订"], openLoops: [] },
        "2026-10-02T00:00:00.000Z",
      );
      bridge.observe(revised);

      expect(
        ledger.snapshot(TimeZone).events.filter((event) => event.type === "conversation.segment.completed"),
      ).toEqual([expect.objectContaining({ summary: "revised summary", changes: [] })]);

      bridge.deleteSources({ sessionId: "session-1", episodeUris: [episodeUri], sourceUris: [] });
      expect(
        ledger.snapshot(TimeZone).events.filter((event) => event.type === "conversation.segment.completed"),
      ).toEqual([]);
    } finally {
      fixture.kernel.close();
    }
  });
});

function createFixture(): {
  readonly workspace: string;
  readonly kernel: AgentSqliteDatabaseKernel;
  readonly store: AgentTemporalMemorySqliteStore;
  readonly scope: AgentTemporalMemoryScope;
} {
  const workspace = createTemporaryDirectory("senera-temporal-memory");
  workspaces.add(workspace);
  const kernel = new AgentSqliteDatabaseKernel({
    databasePath: resolveAgentWorkspaceLayout(workspace).databases.memory,
    contract: AgentMemoryDatabaseContract,
  });
  const scope = projectAgentTemporalMemoryScope({
    workspaceId: workspace,
    worldId: "world-1",
  });
  return { workspace, kernel, store: new AgentTemporalMemorySqliteStore(kernel), scope };
}

function createDay(
  store: AgentTemporalMemorySqliteStore,
  scope: AgentTemporalMemoryScope,
  date: string,
): AgentTemporalMemoryDigest {
  const instant = Temporal.PlainDate.from(date)
    .toZonedDateTime({ timeZone: TimeZone, plainTime: Temporal.PlainTime.from("12:00") })
    .toInstant();
  const period = agentTemporalMemoryCalendarPeriod("day", instant, TimeZone);
  const segment = sealDigest(store, scope, {
    granularity: "segment",
    key: `segment:${date}`,
    start: instant.subtract({ minutes: 5 }).toString(),
    end: instant.toString(),
    memberUri: `senera://memory-episode/${date}`,
    memberKind: "episode",
  });
  return sealDigest(store, scope, {
    granularity: "day",
    key: date,
    start: period.start.toString(),
    end: period.end.toString(),
    memberUri: segment.uri,
    memberKind: "digest",
  });
}

function createMonth(
  store: AgentTemporalMemorySqliteStore,
  scope: AgentTemporalMemoryScope,
  month: string,
  memberDate: string,
): AgentTemporalMemoryDigest {
  const day = createDay(store, scope, memberDate);
  const instant = Temporal.PlainYearMonth.from(month)
    .toPlainDate({ day: 1 })
    .toZonedDateTime({ timeZone: TimeZone, plainTime: Temporal.PlainTime.from("00:00") })
    .toInstant();
  const period = agentTemporalMemoryCalendarPeriod("month", instant, TimeZone);
  return sealDigest(store, scope, {
    granularity: "month",
    key: month,
    start: period.start.toString(),
    end: period.end.toString(),
    memberUri: day.uri,
    memberKind: "digest",
  });
}

function sealDigest(
  store: AgentTemporalMemorySqliteStore,
  scope: AgentTemporalMemoryScope,
  input: {
    readonly granularity: "segment" | "day" | "month";
    readonly key: string;
    readonly start: string;
    readonly end: string;
    readonly memberUri: string;
    readonly memberKind: "episode" | "digest";
  },
): AgentTemporalMemoryDigest {
  const now = "2026-10-01T00:00:00.000Z";
  const digest = store.ensureDigest({
    scope,
    granularity: input.granularity,
    digestKey: input.key,
    periodStart: input.start,
    periodEnd: input.end,
    timeZone: TimeZone,
    status: "pending",
    now,
  });
  store.replaceMembers(
    digest.id,
    [{ memberUri: input.memberUri, memberKind: input.memberKind, occurredAt: input.start, sourceRevision: input.key }],
    { periodStart: input.start, periodEnd: input.end, status: "pending", now },
  );
  return store.seal(digest.id, { summary: `${input.key} summary`, topics: [input.key], openLoops: [] }, now);
}

function recordTurn(
  repository: SqliteAgentMemorySourceRepository,
  requestId: string,
  startedAt: string,
  completedAt: string,
  user: string,
  assistant: string,
): ReturnType<SqliteAgentMemorySourceRepository["recordCompletedTurn"]> {
  return repository.recordCompletedTurn({
    sessionId: "session-1",
    requestId,
    startedAt,
    completedAt,
    userEntry: { id: `${requestId}:user`, requestId, timestamp: startedAt, kind: "user.message", content: user },
    assistantEntry: {
      id: `${requestId}:assistant`,
      requestId,
      timestamp: completedAt,
      kind: "assistant.decision",
      xml: `<agent_result><final_answer>${assistant}</final_answer></agent_result>`,
    },
    terminal: { kind: "FinalAnswer", content: assistant },
    executedTools: [],
  });
}
