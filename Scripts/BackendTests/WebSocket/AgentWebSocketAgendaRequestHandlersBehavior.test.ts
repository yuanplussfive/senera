import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import { AgentGoalCommandService } from "../../../Source/AgentSystem/Agenda/AgentGoalCommandService.js";
import {
  AgentAgendaActorRoles,
  AgentAgendaAuthorities,
  AgentAgendaEventKinds,
  AgentAgendaRecordKinds,
  AgentAgendaStatuses,
} from "../../../Source/AgentSystem/Agenda/AgentAgendaTypes.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import type { AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentWebSocketAgendaRequestHandlers } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketAgendaRequestHandlers.js";
import { AgentWebSocketRequestSchema } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketProtocol.js";
import type { AgentWebSocketRequestContext } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("Agenda WebSocket projection", () => {
  test("projects the persistent world without requiring a session", async () => {
    const fixture = createFixture();
    const send = vi.fn(async (_event: AgentDomainEvent) => undefined);
    const handlers = new AgentWebSocketAgendaRequestHandlers(fixture.context, send);
    try {
      fixture.agenda.record({
        timeZone: "Asia/Shanghai",
        kind: AgentAgendaRecordKinds.Goal,
        actor: AgentAgendaActorRoles.User,
        eventKind: AgentAgendaEventKinds.Declared,
        mutation: { summary: "本月完成项目迁移", status: AgentAgendaStatuses.Active },
        sourceRefs: ["senera://memory-source/user-statement"],
        authority: AgentAgendaAuthorities.UserExplicit,
      });
      await handlers.get({ type: "agenda.get" }, send);
      expect(send).toHaveBeenCalledTimes(1);
      expect(vi.mocked(send).mock.calls[0]![0]).toMatchObject({
        kind: "agenda.snapshot",
        context: {},
        data: {
          snapshot: {
            world: { timeZone: "Asia/Shanghai" },
            activeGoals: [{ summary: "本月完成项目迁移", status: "active" }],
          },
        },
      });
    } finally {
      fixture.database.close();
    }
  });

  test("broadcasts the revised Agenda after an explicit Goal command", async () => {
    const fixture = createFixture();
    const broadcast = vi.fn(async (_event: AgentDomainEvent) => undefined);
    const handlers = new AgentWebSocketAgendaRequestHandlers(fixture.context, broadcast);
    try {
      const goal = fixture.agenda.record({
        timeZone: "Asia/Shanghai",
        kind: AgentAgendaRecordKinds.Goal,
        actor: AgentAgendaActorRoles.User,
        eventKind: AgentAgendaEventKinds.Declared,
        mutation: { summary: "等待依赖的目标", status: AgentAgendaStatuses.Active },
        sourceRefs: ["senera://memory-source/user-statement"],
        authority: AgentAgendaAuthorities.UserExplicit,
      });
      await handlers.command({
        type: "agenda.goal.command",
        commandId: "command-pause",
        goalId: goal.record.id,
        expectedRevision: goal.record.revision,
        command: { operation: "pause", reason: "等待依赖" },
      });

      expect(broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "agenda.snapshot",
          data: expect.objectContaining({
            snapshot: expect.objectContaining({
              records: expect.arrayContaining([
                expect.objectContaining({
                  id: goal.record.id,
                  revision: 2,
                  status: AgentAgendaStatuses.Paused,
                  statusReason: "等待依赖",
                }),
              ]),
            }),
          }),
        }),
      );
    } finally {
      fixture.database.close();
    }
  });

  test("accepts the structured Goal command and rejects unbounded Agenda writes", () => {
    expect(AgentWebSocketRequestSchema.safeParse({ type: "agenda.get" }).success).toBe(true);
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "agenda.goal.command",
        commandId: "command-pause",
        goalId: "goal-a",
        expectedRevision: 1,
        command: { operation: "pause", reason: "等待依赖" },
      }).success,
    ).toBe(true);
    for (const request of [
      { type: "goal.list", sessionId: "session-a" },
      { type: "goal.create", objective: "手动目标" },
      { type: "agenda.create", summary: "伪造世界事件" },
    ]) {
      expect(AgentWebSocketRequestSchema.safeParse(request).success).toBe(false);
    }
  });
});

function createFixture() {
  const workspace = createTemporaryDirectory("senera-agenda-websocket");
  workspaces.add(workspace);
  const database = new AgentSqliteDatabaseKernel({
    databasePath: path.join(workspace, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  const agenda = new AgentAgendaService({
    store: new AgentAgendaSqliteStore(database),
    now: () => new Date("2026-08-29T01:30:00.000Z"),
  });
  const goalCommands = new AgentGoalCommandService({
    agenda,
    timeZone: () => "Asia/Shanghai",
    reviewDelayMs: () => 60_000,
    now: () => new Date("2026-08-29T01:30:00.000Z"),
  });
  return {
    database,
    agenda,
    context: {
      agenda,
      goalCommands,
      configSnapshot: () => ({ ModelProviders: [] }),
    } as unknown as AgentWebSocketRequestContext,
  };
}
