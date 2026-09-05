import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import { AgentGoalCommandService } from "../../../Source/AgentSystem/Agenda/AgentGoalCommandService.js";
import { AgentGoalCompletionBlockedError } from "../../../Source/AgentSystem/Agenda/AgentGoalHierarchy.js";
import { AgentGoalCommandTransitionError } from "../../../Source/AgentSystem/Agenda/AgentGoalCommandService.js";
import {
  AgentAgendaActorRoles,
  AgentAgendaAuthorities,
  AgentAgendaEventKinds,
  AgentAgendaRecordKinds,
  AgentAgendaStatuses,
} from "../../../Source/AgentSystem/Agenda/AgentAgendaTypes.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();
const now = new Date("2026-09-02T00:00:00.000Z");

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("Goal dependency propagation", () => {
  test("pauses and resumes descendants while preserving explicit child pauses", () => {
    const fixture = createFixture();
    try {
      const parent = createGoal(fixture.agenda, "parent");
      const child = createGoal(fixture.agenda, "child", parent.record.id);
      const commands = new AgentGoalCommandService({
        agenda: fixture.agenda,
        timeZone: () => "Asia/Shanghai",
        reviewDelayMs: () => 60_000,
        now: () => now,
      });

      commands.execute({
        commandId: "pause-parent",
        goalId: parent.record.id,
        expectedRevision: parent.record.revision,
        operation: "pause",
      });
      let snapshot = fixture.agenda.snapshot("Asia/Shanghai", now);
      expect(snapshot.records.find((record) => record.id === child.record.id)).toMatchObject({
        status: AgentAgendaStatuses.Paused,
        blockedReason: `dependency:paused:${parent.record.id}`,
      });

      const pausedChild = snapshot.records.find((record) => record.id === child.record.id)!;
      fixture.agenda.evolve("Asia/Shanghai", {
        recordId: child.record.id,
        kind: AgentAgendaEventKinds.Paused,
        mutation: { status: AgentAgendaStatuses.Paused, nextReviewAt: null, blockedReason: "manual" },
        sourceRefs: ["test:manual-pause"],
        authority: AgentAgendaAuthorities.UserExplicit,
        occurredAt: now.toISOString(),
        idempotencyKey: "manual-child-pause",
      });
      commands.execute({
        commandId: "resume-parent",
        goalId: parent.record.id,
        expectedRevision: snapshot.records.find((record) => record.id === parent.record.id)!.revision,
        operation: "resume",
      });
      snapshot = fixture.agenda.snapshot("Asia/Shanghai", now);
      expect(snapshot.records.find((record) => record.id === child.record.id)).toMatchObject({
        status: AgentAgendaStatuses.Paused,
        blockedReason: "manual",
      });
      expect(pausedChild.status).toBe(AgentAgendaStatuses.Paused);
    } finally {
      fixture.database.close();
    }
  });

  test("cancels descendants and blocks premature parent completion", () => {
    const fixture = createFixture();
    try {
      const parent = createGoal(fixture.agenda, "parent");
      const child = createGoal(fixture.agenda, "child", parent.record.id);
      expect(() =>
        fixture.agenda.evolve("Asia/Shanghai", {
          recordId: parent.record.id,
          kind: AgentAgendaEventKinds.Finished,
          mutation: { status: AgentAgendaStatuses.Completed },
          sourceRefs: ["test:complete"],
          authority: AgentAgendaAuthorities.Host,
          occurredAt: now.toISOString(),
          idempotencyKey: "complete-parent",
        }),
      ).toThrow(AgentGoalCompletionBlockedError);

      const commands = new AgentGoalCommandService({
        agenda: fixture.agenda,
        timeZone: () => "Asia/Shanghai",
        reviewDelayMs: () => 60_000,
        now: () => now,
      });
      commands.execute({
        commandId: "cancel-parent",
        goalId: parent.record.id,
        expectedRevision: parent.record.revision,
        operation: "cancel",
      });
      const snapshot = fixture.agenda.snapshot("Asia/Shanghai", now);
      expect(snapshot.records.find((record) => record.id === child.record.id)).toMatchObject({
        status: AgentAgendaStatuses.Cancelled,
        statusReason: `dependency:cancelled:${parent.record.id}`,
      });
    } finally {
      fixture.database.close();
    }
  });

  test("propagates completion through a fully completed Goal subtree", () => {
    const fixture = createFixture();
    try {
      const root = createGoal(fixture.agenda, "root");
      const parent = createGoal(fixture.agenda, "parent", root.record.id);
      const child = createGoal(fixture.agenda, "child", parent.record.id);

      fixture.agenda.evolve("Asia/Shanghai", {
        recordId: child.record.id,
        kind: AgentAgendaEventKinds.Finished,
        mutation: { status: AgentAgendaStatuses.Completed },
        sourceRefs: ["test:complete-child"],
        authority: AgentAgendaAuthorities.Host,
        occurredAt: now.toISOString(),
        idempotencyKey: "complete-child",
      });

      const snapshot = fixture.agenda.snapshot("Asia/Shanghai", now);
      expect(snapshot.records.find((record) => record.id === child.record.id)?.status).toBe(
        AgentAgendaStatuses.Completed,
      );
      expect(snapshot.records.find((record) => record.id === parent.record.id)).toMatchObject({
        status: AgentAgendaStatuses.Completed,
        progress: 1,
        statusReason: `dependency:completed:${child.record.id}`,
      });
      expect(snapshot.records.find((record) => record.id === root.record.id)).toMatchObject({
        status: AgentAgendaStatuses.Completed,
        statusReason: `dependency:completed:${parent.record.id}`,
      });
    } finally {
      fixture.database.close();
    }
  });

  test("inherits dependency state for new and reparented Goals", () => {
    const fixture = createFixture();
    try {
      const pausedParent = createGoal(fixture.agenda, "paused-parent");
      const commands = new AgentGoalCommandService({
        agenda: fixture.agenda,
        timeZone: () => "Asia/Shanghai",
        reviewDelayMs: () => 60_000,
        now: () => now,
      });
      commands.execute({
        commandId: "pause-parent-for-create",
        goalId: pausedParent.record.id,
        expectedRevision: pausedParent.record.revision,
        operation: "pause",
      });
      const inherited = createGoal(fixture.agenda, "inherited", pausedParent.record.id);
      expect(inherited.record).toMatchObject({
        status: AgentAgendaStatuses.Paused,
        blockedReason: `dependency:paused:${pausedParent.record.id}`,
      });

      const activeParent = createGoal(fixture.agenda, "active-parent");
      commands.execute({
        commandId: "reparent-inherited",
        goalId: inherited.record.id,
        expectedRevision: inherited.record.revision,
        operation: "reparent",
        parentGoalId: activeParent.record.id,
      });
      expect(
        fixture.agenda.snapshot("Asia/Shanghai", now).records.find((record) => record.id === inherited.record.id),
      ).toMatchObject({
        status: AgentAgendaStatuses.Active,
        parentGoalId: activeParent.record.id,
        blockedReason: null,
      });

      const pausedAgain = createGoal(fixture.agenda, "paused-again", pausedParent.record.id);
      expect(() =>
        commands.execute({
          commandId: "resume-child-while-parent-paused",
          goalId: pausedAgain.record.id,
          expectedRevision: pausedAgain.record.revision,
          operation: "resume",
        }),
      ).toThrow(AgentGoalCommandTransitionError);
    } finally {
      fixture.database.close();
    }
  });
});

function createFixture() {
  const workspace = createTemporaryDirectory("senera-goal-dependency");
  workspaces.add(workspace);
  const database = new AgentSqliteDatabaseKernel({
    databasePath: path.join(workspace, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  return {
    database,
    agenda: new AgentAgendaService({
      store: new AgentAgendaSqliteStore(database),
      now: () => now,
    }),
  };
}

function createGoal(agenda: AgentAgendaService, summary: string, parentGoalId?: string) {
  return agenda.record({
    timeZone: "Asia/Shanghai",
    kind: AgentAgendaRecordKinds.Goal,
    actor: AgentAgendaActorRoles.User,
    eventKind: AgentAgendaEventKinds.Declared,
    mutation: {
      summary,
      status: AgentAgendaStatuses.Active,
      ...(parentGoalId ? { parentGoalId } : {}),
    },
    sourceRefs: [`test:${summary}`],
    authority: AgentAgendaAuthorities.UserExplicit,
    occurredAt: now.toISOString(),
  });
}
