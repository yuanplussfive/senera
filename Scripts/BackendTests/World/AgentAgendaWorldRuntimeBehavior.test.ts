import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, describe, expect, test } from "vitest";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import {
  AgentAgendaActorRoles,
  AgentAgendaAuthorities,
  AgentAgendaEventKinds,
  AgentAgendaRecordKinds,
  AgentAgendaStatuses,
} from "../../../Source/AgentSystem/Agenda/AgentAgendaTypes.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentWorldClock } from "../../../Source/AgentSystem/World/AgentWorldClock.js";
import { AgentWorldEventLedger } from "../../../Source/AgentSystem/World/AgentWorldEventLedger.js";
import { AgentHabitScheduler } from "../../../Source/AgentSystem/World/AgentHabitScheduler.js";
import { AgentWorldMaterializer } from "../../../Source/AgentSystem/World/AgentWorldMaterializer.js";
import { AgentResidentStateMachine } from "../../../Source/AgentSystem/World/AgentResidentStateMachine.js";
import { AgentWorldRuntime } from "../../../Source/AgentSystem/World/AgentWorldRuntime.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("event-sourced world runtime", () => {
  test("materializes persistent agenda records through the world event ledger", () => {
    const workspace = createTemporaryDirectory("senera-agenda-world");
    workspaces.add(workspace);
    const now = new Date("2026-08-29T01:30:00.000Z");
    const database = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    try {
      const agenda = new AgentAgendaService({ store: new AgentAgendaSqliteStore(database), now: () => now });
      const goal = agenda.record({
        timeZone: "Asia/Shanghai",
        kind: AgentAgendaRecordKinds.Goal,
        actor: AgentAgendaActorRoles.User,
        eventKind: AgentAgendaEventKinds.Declared,
        mutation: {
          summary: "完成项目迁移",
          status: AgentAgendaStatuses.Active,
          dueAt: "2026-08-31T18:00:00+08:00",
        },
        sourceRefs: ["senera://memory-source/goal"],
        authority: AgentAgendaAuthorities.UserExplicit,
      }).record;
      const activity = agenda.record({
        timeZone: "Asia/Shanghai",
        kind: AgentAgendaRecordKinds.Activity,
        actor: AgentAgendaActorRoles.Resident,
        eventKind: AgentAgendaEventKinds.Started,
        mutation: {
          summary: "整理迁移清单",
          status: AgentAgendaStatuses.Active,
          startsAt: now.toISOString(),
          relatedRecordId: goal.id,
        },
        sourceRefs: ["senera://memory-source/activity"],
        authority: AgentAgendaAuthorities.ToolVerified,
      }).record;
      const schedule = agenda.record({
        timeZone: "Asia/Shanghai",
        kind: AgentAgendaRecordKinds.Schedule,
        actor: AgentAgendaActorRoles.Resident,
        eventKind: AgentAgendaEventKinds.Declared,
        mutation: {
          summary: "汇报迁移进度",
          status: AgentAgendaStatuses.Planned,
          dueAt: "2026-08-30T09:00:00+08:00",
        },
        sourceRefs: ["senera://memory-source/schedule"],
        authority: AgentAgendaAuthorities.UserExplicit,
      }).record;
      const config = () => ({
        Name: "Senera",
        TimeZone: "Asia/Shanghai",
        DayPhases: [
          { Id: "night", Label: "深夜", StartsAt: "00:00", EndsAt: "06:00" },
          { Id: "day", Label: "白天", StartsAt: "06:00", EndsAt: "18:00" },
          { Id: "evening", Label: "晚上", StartsAt: "18:00", EndsAt: "00:00" },
        ],
        RecordLimit: 32,
        TimelineLimit: 32,
        HabitCatchUpLimit: 32,
      });
      const ledger = new AgentWorldEventLedger(database, agenda);
      const materializer = new AgentWorldMaterializer({
        ledger,
        graphSnapshot: () => ({ scope: [], entities: [], relations: [] }),
        config,
      });
      const residentStates = new AgentResidentStateMachine(database, ledger);
      const habits = new AgentHabitScheduler(
        database,
        ledger,
        { read: (subjectId, attribute, at) => materializer.readAttribute(subjectId, attribute, at) },
        residentStates,
      );
      const runtime = new AgentWorldRuntime({
        agenda,
        ledger,
        clock: new AgentWorldClock(database, ledger),
        habits,
        residentStates,
        materializer,
        config,
        errorSink: (error) => {
          throw error;
        },
      });

      const snapshot = runtime.snapshot(Temporal.Instant.from(now.toISOString()));

      expect(snapshot.world).toMatchObject({ name: "Senera", timeZone: "Asia/Shanghai" });
      expect(snapshot.time).toMatchObject({ localDate: "2026-08-29", phaseId: "day" });
      expect(snapshot.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: goal.id, kind: "goal", label: "完成项目迁移" }),
          expect.objectContaining({
            id: activity.id,
            kind: "task",
            label: "整理迁移清单",
            attributes: expect.objectContaining({ agendaKind: "activity" }),
          }),
        ]),
      );
      expect(snapshot.edges).toContainEqual(
        expect.objectContaining({ subjectId: activity.id, relation: "contributes_to", objectId: goal.id }),
      );
      expect(snapshot.nextSchedules).toContainEqual(
        expect.objectContaining({
          scheduleId: schedule.id,
          label: "汇报迁移进度",
          at: "2026-08-30T01:00:00Z",
          actorId: schedule.actor.id,
          actorRole: "resident",
          kind: "schedule",
          source: "agenda",
        }),
      );
      expect(snapshot.commitments).toContainEqual(
        expect.objectContaining({ id: goal.id, label: "完成项目迁移", actorRole: "user", status: "active" }),
      );
      expect(snapshot.timeline).toHaveLength(3);
      expect(snapshot.resident).toMatchObject({ residentId: activity.actor.id, activity: "整理迁移清单" });
    } finally {
      database.close();
    }
  });
});
