import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  AgentAgendaActorRoles,
  AgentAgendaAuthorities,
  AgentAgendaEventKinds,
  AgentAgendaRecordKinds,
  AgentAgendaStatuses,
} from "../../../Source/AgentSystem/Agenda/AgentAgendaTypes.js";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();
const Shanghai = "Asia/Shanghai";
const Clock = new Date("2026-08-29T01:30:00.000Z");
const UserSource = "senera://memory-source/user-turn";
const ToolSource = "senera://memory-source/tool-evidence";

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("world agenda ledger", () => {
  test("replays durable goals, current activity, today's timeline, and future schedule after reopen", () => {
    const { databasePath, database } = openDatabase("senera-world-agenda-replay");
    const service = createService(database);
    let closed = false;
    try {
      const goal = service.record({
        timeZone: Shanghai,
        kind: AgentAgendaRecordKinds.Goal,
        actor: AgentAgendaActorRoles.User,
        eventKind: AgentAgendaEventKinds.Declared,
        mutation: {
          summary: "本月完成项目迁移",
          status: AgentAgendaStatuses.Active,
          dueAt: "2026-09-01T01:00:00.000Z",
        },
        sourceRefs: [UserSource],
        authority: AgentAgendaAuthorities.UserExplicit,
      });
      const activity = service.record({
        timeZone: Shanghai,
        kind: AgentAgendaRecordKinds.Activity,
        actor: AgentAgendaActorRoles.User,
        eventKind: AgentAgendaEventKinds.Started,
        mutation: {
          summary: "整理迁移清单",
          status: AgentAgendaStatuses.Active,
          startsAt: "2026-08-29T01:20:00.000Z",
          relatedRecordId: goal.record.id,
        },
        occurredAt: "2026-08-29T01:20:00.000Z",
        sourceRefs: [UserSource],
        authority: AgentAgendaAuthorities.UserExplicit,
      });
      service.evolve(Shanghai, {
        recordId: activity.record.id,
        kind: AgentAgendaEventKinds.Finished,
        mutation: {
          status: AgentAgendaStatuses.Completed,
          endsAt: "2026-08-29T01:25:00.000Z",
        },
        sourceRefs: [ToolSource],
        authority: AgentAgendaAuthorities.ToolVerified,
        occurredAt: "2026-08-29T01:25:00.000Z",
      });
      const schedule = service.record({
        timeZone: Shanghai,
        kind: "schedule",
        actor: AgentAgendaActorRoles.User,
        eventKind: AgentAgendaEventKinds.Declared,
        mutation: {
          summary: "周六去打球",
          status: AgentAgendaStatuses.Planned,
          dueAt: "2026-08-30T01:00:00.000Z",
          relatedRecordId: goal.record.id,
        },
        sourceRefs: [UserSource],
        authority: AgentAgendaAuthorities.UserExplicit,
      });

      const snapshot = service.snapshot(Shanghai);
      expect(snapshot.clock).toMatchObject({ localDate: "2026-08-29", localTime: "09:30:00", timeZone: Shanghai });
      expect(snapshot.activeGoals).toMatchObject([{ id: goal.record.id, summary: "本月完成项目迁移" }]);
      expect(snapshot.currentActivities).toEqual([]);
      expect(snapshot.timeline.map((entry) => entry.summary)).toEqual(
        expect.arrayContaining(["本月完成项目迁移", "整理迁移清单", "周六去打球"]),
      );
      expect(snapshot.upcoming).toMatchObject([
        { id: schedule.record.id, summary: "周六去打球", status: AgentAgendaStatuses.Planned },
        { id: goal.record.id, summary: "本月完成项目迁移", status: AgentAgendaStatuses.Active },
      ]);

      database.close();
      closed = true;
      const reopened = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentMemoryDatabaseContract });
      try {
        const replayed = createService(reopened).snapshot(Shanghai);
        expect(replayed.records).toHaveLength(3);
        expect(replayed.records.find((record) => record.id === activity.record.id)).toMatchObject({
          status: AgentAgendaStatuses.Completed,
          startsAt: "2026-08-29T01:20:00Z",
          endsAt: "2026-08-29T01:25:00Z",
          sourceRefs: expect.arrayContaining([ToolSource, UserSource]),
        });
      } finally {
        reopened.close();
      }
    } finally {
      if (!closed) database.close();
    }
  });

  test("uses the world time zone for the daily timeline boundary", () => {
    const { database } = openDatabase("senera-world-agenda-day-boundary");
    const service = createService(database);
    try {
      service.record({
        timeZone: Shanghai,
        kind: AgentAgendaRecordKinds.Event,
        actor: AgentAgendaActorRoles.User,
        eventKind: AgentAgendaEventKinds.Occurred,
        mutation: { summary: "上海当天零点事件", status: AgentAgendaStatuses.Recorded },
        occurredAt: "2026-08-28T16:00:00.000Z",
        sourceRefs: [UserSource],
        authority: AgentAgendaAuthorities.UserExplicit,
      });
      service.record({
        timeZone: Shanghai,
        kind: AgentAgendaRecordKinds.Event,
        actor: AgentAgendaActorRoles.User,
        eventKind: AgentAgendaEventKinds.Occurred,
        mutation: { summary: "上海前一天事件", status: AgentAgendaStatuses.Recorded },
        occurredAt: "2026-08-28T15:59:59.000Z",
        sourceRefs: [UserSource],
        authority: AgentAgendaAuthorities.UserExplicit,
      });

      expect(service.snapshot(Shanghai).timeline.map((entry) => entry.summary)).toEqual(["上海当天零点事件"]);
    } finally {
      database.close();
    }
  });

  test("requires source-backed state and never infers a goal transition from related activity", () => {
    const { database } = openDatabase("senera-world-agenda-evidence");
    const service = createService(database);
    try {
      const goal = service.record({
        timeZone: Shanghai,
        kind: AgentAgendaRecordKinds.Goal,
        actor: AgentAgendaActorRoles.User,
        eventKind: AgentAgendaEventKinds.Declared,
        mutation: { summary: "完成资料整理", status: AgentAgendaStatuses.Active },
        sourceRefs: [UserSource],
        authority: AgentAgendaAuthorities.UserExplicit,
      });
      const activity = service.record({
        timeZone: Shanghai,
        kind: AgentAgendaRecordKinds.Activity,
        actor: AgentAgendaActorRoles.User,
        eventKind: AgentAgendaEventKinds.Started,
        mutation: {
          summary: "开始整理资料",
          status: AgentAgendaStatuses.Active,
          startsAt: Clock.toISOString(),
          relatedRecordId: goal.record.id,
        },
        sourceRefs: [UserSource],
        authority: AgentAgendaAuthorities.UserExplicit,
      });
      service.evolve(Shanghai, {
        recordId: activity.record.id,
        kind: AgentAgendaEventKinds.Finished,
        mutation: { status: AgentAgendaStatuses.Completed },
        sourceRefs: [ToolSource],
        authority: AgentAgendaAuthorities.ToolVerified,
      });

      expect(service.snapshot(Shanghai).activeGoals).toMatchObject([{ id: goal.record.id }]);
      expect(() =>
        service.record({
          timeZone: Shanghai,
          kind: AgentAgendaRecordKinds.Event,
          actor: AgentAgendaActorRoles.User,
          eventKind: AgentAgendaEventKinds.Occurred,
          mutation: { summary: "没有证据的事件", status: AgentAgendaStatuses.Recorded },
          sourceRefs: [],
          authority: AgentAgendaAuthorities.UserExplicit,
        }),
      ).toThrow("Agenda event requires at least one source reference.");
      expect(() => service.snapshot("America/New_York")).toThrow("Agenda world time zone is immutable after creation");
    } finally {
      database.close();
    }
  });
});

function openDatabase(name: string): { databasePath: string; database: AgentSqliteDatabaseKernel } {
  const workspace = createTemporaryDirectory(name);
  workspaces.add(workspace);
  const databasePath = path.join(workspace, "memory.sqlite");
  return {
    databasePath,
    database: new AgentSqliteDatabaseKernel({ databasePath, contract: AgentMemoryDatabaseContract }),
  };
}

function createService(database: AgentSqliteDatabaseKernel): AgentAgendaService {
  return new AgentAgendaService({ store: new AgentAgendaSqliteStore(database), now: () => new Date(Clock) });
}
