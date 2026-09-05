import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import {
  AgentAgendaActorRoles,
  AgentAgendaAuthorities,
  AgentAgendaEventKinds,
  AgentAgendaIntentModes,
  AgentAgendaRecordKinds,
  AgentAgendaStatuses,
} from "../../../Source/AgentSystem/Agenda/AgentAgendaTypes.js";
import {
  AgentGoalMicroLoopDecisionKinds,
  AgentGoalMicroLoopRuntime,
  selectAgentGoalMicroLoopCandidates,
} from "../../../Source/AgentSystem/Agenda/AgentGoalMicroLoopRuntime.js";
import type { AgentGoalMicroLoopDecisionPort } from "../../../Source/AgentSystem/Agenda/AgentGoalMicroLoopRuntime.js";
import type { AgentWorldTreeProjection } from "../../../Source/AgentSystem/World/AgentWorldTypes.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const TimeZone = "Asia/Shanghai";
const WakeAt = "2026-08-29T01:30:00.000Z";
const FutureReview = "2026-08-29T02:30:00.000Z";
const SourceRef = "senera://memory-source/goal-loop";
const worldDirectories = new Set<string>();

afterEach(() => {
  for (const directory of worldDirectories) removeDirectory(directory);
  worldDirectories.clear();
});

describe("goal micro-loop runtime", () => {
  test("does not invoke a decision port when no goal is due", async () => {
    const { database, agenda } = openAgenda("goal-loop-no-candidate");
    try {
      agenda.record({
        timeZone: TimeZone,
        kind: AgentAgendaRecordKinds.Goal,
        actor: AgentAgendaActorRoles.User,
        eventKind: AgentAgendaEventKinds.Declared,
        mutation: {
          summary: "完成资料整理",
          status: AgentAgendaStatuses.Active,
          nextReviewAt: FutureReview,
        },
        sourceRefs: [SourceRef],
        authority: AgentAgendaAuthorities.UserExplicit,
        occurredAt: WakeAt,
      });
      const decisionPort = { decide: vi.fn() };
      const runtime = new AgentGoalMicroLoopRuntime({
        agenda,
        timeZone: () => TimeZone,
        decisionPort,
        actionPort: { act: vi.fn() },
      });

      const result = await runtime.onWake({
        worldId: agenda.snapshot(TimeZone).world.id,
        from: Temporal.Instant.from(WakeAt),
        to: Temporal.Instant.from(WakeAt),
        snapshot: worldSnapshot(),
      });

      expect(result).toEqual({ changed: false });
      expect(decisionPort.decide).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  test("persists a wait decision and suppresses replay until the scheduled review", async () => {
    const { database, agenda } = openAgenda("goal-loop-wait");
    try {
      const goal = agenda.record({
        timeZone: TimeZone,
        kind: AgentAgendaRecordKinds.Goal,
        actor: AgentAgendaActorRoles.User,
        eventKind: AgentAgendaEventKinds.Declared,
        mutation: {
          summary: "完成资料整理",
          status: AgentAgendaStatuses.Active,
          nextReviewAt: WakeAt,
          progress: 0.25,
        },
        sourceRefs: [SourceRef],
        authority: AgentAgendaAuthorities.UserExplicit,
        occurredAt: WakeAt,
      });
      const decisionPort = {
        decide: vi.fn(async (input: Parameters<AgentGoalMicroLoopDecisionPort["decide"]>[0]) =>
          input.candidates.map((candidate) => ({
            goalId: candidate.goalId,
            triggerKey: candidate.triggerKey,
            kind: AgentGoalMicroLoopDecisionKinds.Wait,
            reason: "等待下一次可验证的进展",
            nextReviewAt: FutureReview,
          })),
        ),
      };
      const runtime = new AgentGoalMicroLoopRuntime({
        agenda,
        timeZone: () => TimeZone,
        decisionPort,
        actionPort: { act: vi.fn() },
      });
      const input = {
        worldId: goal.snapshot.world.id,
        from: Temporal.Instant.from(WakeAt).subtract({ hours: 1 }),
        to: Temporal.Instant.from(WakeAt),
        snapshot: worldSnapshot(),
      } as const;

      const first = await runtime.onWake(input);
      const persisted = agenda.snapshot(TimeZone).records.find((record) => record.id === goal.record.id);
      const replay = await runtime.onWake({ ...input, from: Temporal.Instant.from(WakeAt) });

      expect(first).toEqual({ changed: true });
      expect(persisted).toMatchObject({
        nextReviewAt: FutureReview.replace(".000", ""),
        progress: 0.25,
        lastDecisionKey: expect.stringContaining(`${goal.record.id}:`),
      });
      expect(replay).toEqual({ changed: false });
      expect(decisionPort.decide).toHaveBeenCalledTimes(1);
    } finally {
      database.close();
    }
  });

  test("requires verified evidence before completing a goal", async () => {
    const { database, agenda } = openAgenda("goal-loop-complete");
    try {
      const goal = agenda.record({
        timeZone: TimeZone,
        kind: AgentAgendaRecordKinds.Goal,
        actor: AgentAgendaActorRoles.User,
        eventKind: AgentAgendaEventKinds.Declared,
        mutation: { summary: "完成验证", status: AgentAgendaStatuses.Active, nextReviewAt: WakeAt },
        sourceRefs: [SourceRef],
        authority: AgentAgendaAuthorities.UserExplicit,
        occurredAt: WakeAt,
      });
      const decisionPort = {
        decide: vi.fn(async (input: Parameters<AgentGoalMicroLoopDecisionPort["decide"]>[0]) =>
          input.candidates.map((candidate) => ({
            goalId: candidate.goalId,
            triggerKey: candidate.triggerKey,
            kind: AgentGoalMicroLoopDecisionKinds.Complete,
            reason: "验证条件已满足",
          })),
        ),
      };
      const actionPort = {
        act: vi.fn().mockResolvedValue({ outcome: "verified", evidenceRefs: ["senera://tool-result/verified"] }),
      };
      const runtime = new AgentGoalMicroLoopRuntime({
        agenda,
        timeZone: () => TimeZone,
        decisionPort,
        actionPort,
      });

      await runtime.onWake({
        worldId: goal.snapshot.world.id,
        from: Temporal.Instant.from(WakeAt).subtract({ minutes: 1 }),
        to: Temporal.Instant.from(WakeAt),
        snapshot: worldSnapshot(),
      });

      expect(actionPort.act).toHaveBeenCalledTimes(1);
      expect(agenda.snapshot(TimeZone).records.find((record) => record.id === goal.record.id)).toMatchObject({
        status: AgentAgendaStatuses.Completed,
        progress: 1,
        nextReviewAt: null,
      });
    } finally {
      database.close();
    }
  });

  test("blocks autonomous actions for tentative goals", async () => {
    const { database, agenda } = openAgenda("goal-loop-intent-gate");
    try {
      const goal = agenda.record({
        timeZone: TimeZone,
        kind: AgentAgendaRecordKinds.Goal,
        actor: AgentAgendaActorRoles.User,
        eventKind: AgentAgendaEventKinds.Declared,
        mutation: {
          summary: "需要确认的目标",
          status: AgentAgendaStatuses.Active,
          intentMode: AgentAgendaIntentModes.Tentative,
          nextReviewAt: WakeAt,
        },
        sourceRefs: [SourceRef],
        authority: AgentAgendaAuthorities.UserExplicit,
        occurredAt: WakeAt,
      });
      const actionPort = { act: vi.fn() };
      const runtime = new AgentGoalMicroLoopRuntime({
        agenda,
        timeZone: () => TimeZone,
        decisionPort: {
          decide: vi.fn(async (input: Parameters<AgentGoalMicroLoopDecisionPort["decide"]>[0]) =>
            input.candidates.map((candidate) => ({
              goalId: candidate.goalId,
              triggerKey: candidate.triggerKey,
              kind: AgentGoalMicroLoopDecisionKinds.Execute,
              reason: "直接推进",
            })),
          ),
        },
        actionPort,
      });

      await runtime.onWake({
        worldId: goal.snapshot.world.id,
        from: Temporal.Instant.from(WakeAt).subtract({ minutes: 1 }),
        to: Temporal.Instant.from(WakeAt),
        snapshot: worldSnapshot(),
      });

      expect(actionPort.act).not.toHaveBeenCalled();
      expect(agenda.snapshot(TimeZone).records.find((record) => record.id === goal.record.id)).toMatchObject({
        status: AgentAgendaStatuses.Paused,
        blockedReason: expect.stringContaining("not authorized"),
      });
    } finally {
      database.close();
    }
  });

  test("isolates one action failure and continues other goals", async () => {
    const { database, agenda } = openAgenda("goal-loop-failure-isolation");
    try {
      const high = agenda.record({
        timeZone: TimeZone,
        kind: AgentAgendaRecordKinds.Goal,
        actor: AgentAgendaActorRoles.User,
        eventKind: AgentAgendaEventKinds.Declared,
        mutation: { summary: "失败目标", status: AgentAgendaStatuses.Active, nextReviewAt: WakeAt, priority: 90 },
        sourceRefs: [SourceRef],
        authority: AgentAgendaAuthorities.UserExplicit,
        occurredAt: WakeAt,
      });
      const low = agenda.record({
        timeZone: TimeZone,
        kind: AgentAgendaRecordKinds.Goal,
        actor: AgentAgendaActorRoles.User,
        eventKind: AgentAgendaEventKinds.Declared,
        mutation: { summary: "继续目标", status: AgentAgendaStatuses.Active, nextReviewAt: WakeAt, priority: 10 },
        sourceRefs: [SourceRef],
        authority: AgentAgendaAuthorities.UserExplicit,
        occurredAt: WakeAt,
      });
      const runtime = new AgentGoalMicroLoopRuntime({
        agenda,
        timeZone: () => TimeZone,
        decisionPort: {
          decide: vi.fn(async (input: Parameters<AgentGoalMicroLoopDecisionPort["decide"]>[0]) =>
            input.candidates.map((candidate) => ({
              goalId: candidate.goalId,
              triggerKey: candidate.triggerKey,
              kind: AgentGoalMicroLoopDecisionKinds.Execute,
              reason: "执行一步",
            })),
          ),
        },
        actionPort: {
          act: vi.fn(async (input) => {
            if (input.candidate.goalId === high.record.id) throw new Error("simulated goal action failure");
            return { outcome: "waiting" as const, evidenceRefs: [SourceRef], nextReviewAt: FutureReview };
          }),
        },
      });

      await expect(
        runtime.onWake({
          worldId: high.snapshot.world.id,
          from: Temporal.Instant.from(WakeAt).subtract({ minutes: 1 }),
          to: Temporal.Instant.from(WakeAt),
          snapshot: worldSnapshot(),
        }),
      ).resolves.toEqual({ changed: true });

      expect(agenda.snapshot(TimeZone).records.find((record) => record.id === high.record.id)).toMatchObject({
        status: AgentAgendaStatuses.Paused,
      });
      expect(agenda.snapshot(TimeZone).records.find((record) => record.id === low.record.id)).toMatchObject({
        status: AgentAgendaStatuses.Active,
        nextReviewAt: FutureReview.replace(".000", ""),
      });
    } finally {
      database.close();
    }
  });

  test("rejects incomplete or unknown decisions instead of using a fallback", async () => {
    const { database, agenda } = openAgenda("goal-loop-strict-decision");
    try {
      agenda.record({
        timeZone: TimeZone,
        kind: AgentAgendaRecordKinds.Goal,
        actor: AgentAgendaActorRoles.User,
        eventKind: AgentAgendaEventKinds.Declared,
        mutation: { summary: "严格决策", status: AgentAgendaStatuses.Active, nextReviewAt: WakeAt },
        sourceRefs: [SourceRef],
        authority: AgentAgendaAuthorities.UserExplicit,
        occurredAt: WakeAt,
      });
      const runtime = new AgentGoalMicroLoopRuntime({
        agenda,
        timeZone: () => TimeZone,
        decisionPort: { decide: vi.fn().mockResolvedValue([]) },
        actionPort: { act: vi.fn() },
      });

      await expect(
        runtime.onWake({
          worldId: agenda.snapshot(TimeZone).world.id,
          from: Temporal.Instant.from(WakeAt).subtract({ minutes: 1 }),
          to: Temporal.Instant.from(WakeAt),
          snapshot: worldSnapshot(),
        }),
      ).resolves.toEqual({ changed: true });
      expect(agenda.snapshot(TimeZone).activeGoals).toEqual([]);
    } finally {
      database.close();
    }
  });

  test("orders candidates by priority and caps the batch", () => {
    const now = Temporal.Instant.from(WakeAt);
    const snapshot = {
      world: { id: "world-1" },
      activeGoals: [
        {
          id: "low",
          summary: "低优先级",
          status: "active",
          priority: 10,
          nextReviewAt: WakeAt,
          updatedAt: WakeAt,
          lastEventId: "event-low",
          sourceRefs: [SourceRef],
        },
        {
          id: "high",
          summary: "高优先级",
          status: "active",
          priority: 90,
          nextReviewAt: WakeAt,
          updatedAt: WakeAt,
          lastEventId: "event-high",
          sourceRefs: [SourceRef],
        },
      ],
    } as unknown as AgentAgendaSnapshotLike;

    expect(selectAgentGoalMicroLoopCandidates(snapshot, now.subtract({ minutes: 1 }), now, 1)).toMatchObject([
      { goalId: "high", priority: 90 },
    ]);
  });

  test("wakes changed goals even when their next review is still in the future", () => {
    const now = Temporal.Instant.from(WakeAt);
    const snapshot = {
      world: { id: "world-1" },
      activeGoals: [
        {
          id: "changed",
          summary: "状态刚刚变化",
          status: "active",
          priority: 50,
          nextReviewAt: FutureReview,
          updatedAt: WakeAt,
          lastEventId: "event-changed",
          sourceRefs: [SourceRef],
        },
      ],
    } as unknown as AgentAgendaSnapshotLike;

    expect(selectAgentGoalMicroLoopCandidates(snapshot, now.subtract({ minutes: 1 }), now, 8)).toMatchObject([
      { goalId: "changed", trigger: "changed" },
    ]);
  });

  test("does not treat an old due time as due when a future review supersedes it", () => {
    const now = Temporal.Instant.from(WakeAt);
    const snapshot = {
      world: { id: "world-1" },
      activeGoals: [
        {
          id: "reviewed",
          summary: "等待复查",
          status: "active",
          priority: 50,
          dueAt: "2026-08-28T23:00:00.000Z",
          nextReviewAt: FutureReview,
          updatedAt: "2026-08-28T22:00:00.000Z",
          lastEventId: "event-reviewed",
          sourceRefs: [SourceRef],
        },
      ],
    } as unknown as AgentAgendaSnapshotLike;

    expect(selectAgentGoalMicroLoopCandidates(snapshot, now.subtract({ minutes: 1 }), now, 8)).toEqual([]);
  });

  test("pauses child Goal scheduling while an ancestor is paused or cancelled", () => {
    const now = Temporal.Instant.from(WakeAt);
    const parent = {
      id: "parent",
      kind: AgentAgendaRecordKinds.Goal,
      worldId: "world-1",
      status: AgentAgendaStatuses.Paused,
      updatedAt: WakeAt,
      lastEventId: "event-parent",
      sourceRefs: [SourceRef],
    };
    const child = {
      id: "child",
      kind: AgentAgendaRecordKinds.Goal,
      worldId: "world-1",
      status: AgentAgendaStatuses.Active,
      parentGoalId: "parent",
      priority: 50,
      nextReviewAt: WakeAt,
      updatedAt: WakeAt,
      lastEventId: "event-child",
      sourceRefs: [SourceRef],
    };
    const snapshot = {
      world: { id: "world-1" },
      records: [parent, child],
      activeGoals: [child],
    } as unknown as AgentAgendaSnapshotLike;

    expect(selectAgentGoalMicroLoopCandidates(snapshot, now.subtract({ minutes: 1 }), now, 8)).toEqual([]);
  });
});

type AgentAgendaSnapshotLike = Parameters<typeof selectAgentGoalMicroLoopCandidates>[0];

function openAgenda(name: string): { database: AgentSqliteDatabaseKernel; agenda: AgentAgendaService } {
  const directory = createTemporaryDirectory(name);
  worldDirectories.add(directory);
  const database = new AgentSqliteDatabaseKernel({
    databasePath: path.join(directory, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  const agenda = new AgentAgendaService({ store: new AgentAgendaSqliteStore(database), now: () => new Date(WakeAt) });
  return { database, agenda };
}

function worldSnapshot(): AgentWorldTreeProjection {
  return {
    world: { id: "world-test", name: "测试世界", timeZone: TimeZone },
    time: {
      instant: Temporal.Instant.from(WakeAt),
      timeZone: TimeZone,
      localDate: "2026-08-29",
      localTime: "09:30:00",
      weekday: 6,
      weekdayLabel: "星期六",
      phaseId: "day",
      phaseLabel: "白天",
      dayElapsedSeconds: 0,
      dayElapsed: "0s",
      dayRemainingSeconds: 0,
      dayRemaining: "0s",
    },
    calendar: {
      date: "2026-08-29",
      isHoliday: false,
      isWorkday: true,
      isPublicHoliday: false,
      isPublicWorkday: true,
      holidayName: null,
      lunarSummary: "",
    },
    nodes: [],
    edges: [],
    timeline: [],
    changedNodeIds: [],
    nextSchedules: [],
    commitments: [],
    resident: {
      residentId: null,
      userId: null,
      location: null,
      activity: null,
      bodyState: null,
      emotionState: null,
      interruptedBy: null,
      relationship: null,
      nextPlan: null,
    },
  };
}
