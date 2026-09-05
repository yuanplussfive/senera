import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  AgentAgendaActorRoles,
  AgentAgendaAuthorities,
  AgentAgendaEventKinds,
  AgentAgendaIntentModes,
  AgentAgendaRecordKinds,
  AgentAgendaStatuses,
  type AgentAgendaAuthority,
} from "../../../Source/AgentSystem/Agenda/AgentAgendaTypes.js";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import {
  AgentAgendaCommandIdConflictError,
  AgentAgendaRevisionConflictError,
  AgentAgendaSqliteStore,
} from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import {
  AgentGoalCommandService,
  AgentGoalParentError,
} from "../../../Source/AgentSystem/Agenda/AgentGoalCommandService.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();
const TimeZone = "Asia/Shanghai";
const Now = "2026-09-02T02:00:00.000Z";
const SourceRef = "senera://memory-source/goal-command-test";

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("Goal command control plane", () => {
  test("persists command receipts, replays across restart, and rejects command identity conflicts", () => {
    const fixture = openFixture("senera-goal-command-replay");
    let closed = false;
    try {
      const goal = recordGoal(fixture.agenda, "确认迁移目标", AgentAgendaAuthorities.Host);
      const committed = fixture.commands.execute({
        commandId: "command-commit",
        goalId: goal.record.id,
        expectedRevision: goal.record.revision,
        operation: "commit",
      });
      expect(committed).toMatchObject({
        disposition: "created",
        record: { revision: 2, intentMode: AgentAgendaIntentModes.Committed },
      });

      fixture.database.close();
      closed = true;
      const reopened = openDatabase(fixture.databasePath);
      try {
        const runtime = createRuntime(reopened);
        expect(
          runtime.commands.execute({
            commandId: "command-commit",
            goalId: goal.record.id,
            expectedRevision: goal.record.revision,
            operation: "commit",
          }),
        ).toMatchObject({ disposition: "idempotent", record: { revision: 2 } });

        expect(() =>
          runtime.commands.execute({
            commandId: "command-commit",
            goalId: goal.record.id,
            expectedRevision: 2,
            operation: "pause",
          }),
        ).toThrowError(AgentAgendaCommandIdConflictError);
      } finally {
        reopened.close();
      }
    } finally {
      if (!closed) fixture.database.close();
    }
  });

  test("rejects stale revisions and reanchors resumed Goals from resolved policy", () => {
    const fixture = openFixture("senera-goal-command-revision");
    try {
      const goal = recordGoal(fixture.agenda, "分阶段上线");
      const paused = fixture.commands.execute({
        commandId: "command-pause",
        goalId: goal.record.id,
        expectedRevision: 1,
        operation: "pause",
        reason: "等待发布窗口",
      });
      expect(paused.record).toMatchObject({
        revision: 2,
        status: AgentAgendaStatuses.Paused,
        nextReviewAt: null,
        statusReason: "等待发布窗口",
      });

      expect(() =>
        fixture.commands.execute({
          commandId: "command-stale",
          goalId: goal.record.id,
          expectedRevision: 1,
          operation: "resume",
        }),
      ).toThrowError(AgentAgendaRevisionConflictError);

      const resumed = fixture.commands.execute({
        commandId: "command-resume",
        goalId: goal.record.id,
        expectedRevision: 2,
        operation: "resume",
      });
      expect(resumed.record).toMatchObject({
        revision: 3,
        status: AgentAgendaStatuses.Active,
        nextReviewAt: "2026-09-02T02:01:00Z",
        statusReason: null,
      });
    } finally {
      fixture.database.close();
    }
  });

  test("enforces Goal-only acyclic parent relationships", () => {
    const fixture = openFixture("senera-goal-command-parent");
    try {
      const parent = recordGoal(fixture.agenda, "主目标");
      const child = recordGoal(fixture.agenda, "子目标");
      const linked = fixture.commands.execute({
        commandId: "command-parent-child",
        goalId: child.record.id,
        expectedRevision: 1,
        operation: "reparent",
        parentGoalId: parent.record.id,
      });
      expect(linked.record).toMatchObject({ revision: 2, parentGoalId: parent.record.id });

      expect(() =>
        fixture.commands.execute({
          commandId: "command-parent-cycle",
          goalId: parent.record.id,
          expectedRevision: 1,
          operation: "reparent",
          parentGoalId: child.record.id,
        }),
      ).toThrowError(AgentGoalParentError);
      expect(() =>
        fixture.agenda.evolve(TimeZone, {
          recordId: parent.record.id,
          kind: AgentAgendaEventKinds.Progressed,
          mutation: { parentGoalId: child.record.id },
          sourceRefs: [SourceRef],
          authority: AgentAgendaAuthorities.UserExplicit,
        }),
      ).toThrowError(AgentGoalParentError);
      expect(() =>
        fixture.commands.execute({
          commandId: "command-parent-missing",
          goalId: parent.record.id,
          expectedRevision: 1,
          operation: "reparent",
          parentGoalId: "missing-goal",
        }),
      ).toThrowError(AgentGoalParentError);
      expect(() =>
        fixture.agenda.record({
          timeZone: TimeZone,
          kind: AgentAgendaRecordKinds.Schedule,
          actor: AgentAgendaActorRoles.User,
          eventKind: AgentAgendaEventKinds.Declared,
          mutation: {
            summary: "不合法的计划层级",
            status: AgentAgendaStatuses.Planned,
            parentGoalId: parent.record.id,
          },
          sourceRefs: [SourceRef],
          authority: AgentAgendaAuthorities.UserExplicit,
        }),
      ).toThrow("Agenda mutation field parentGoalId is only valid for Goal records.");
    } finally {
      fixture.database.close();
    }
  });
});

function openFixture(name: string) {
  const workspace = createTemporaryDirectory(name);
  workspaces.add(workspace);
  const databasePath = path.join(workspace, "memory.sqlite");
  const database = openDatabase(databasePath);
  return { databasePath, database, ...createRuntime(database) };
}

function openDatabase(databasePath: string): AgentSqliteDatabaseKernel {
  return new AgentSqliteDatabaseKernel({ databasePath, contract: AgentMemoryDatabaseContract });
}

function createRuntime(database: AgentSqliteDatabaseKernel) {
  const agenda = new AgentAgendaService({
    store: new AgentAgendaSqliteStore(database),
    now: () => new Date(Now),
  });
  const commands = new AgentGoalCommandService({
    agenda,
    timeZone: () => TimeZone,
    reviewDelayMs: () => 60_000,
    now: () => new Date(Now),
  });
  return { agenda, commands };
}

function recordGoal(
  agenda: AgentAgendaService,
  summary: string,
  authority: AgentAgendaAuthority = AgentAgendaAuthorities.UserExplicit,
) {
  return agenda.record({
    timeZone: TimeZone,
    kind: AgentAgendaRecordKinds.Goal,
    actor: AgentAgendaActorRoles.User,
    eventKind: AgentAgendaEventKinds.Declared,
    mutation: { summary, status: AgentAgendaStatuses.Active },
    sourceRefs: [SourceRef],
    authority,
  });
}
