import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import {
  AgentWorldResidentIdleAgendaActionPort,
  type AgentWorldResidentIdleDeliveryPort,
} from "../../../Source/AgentSystem/World/AgentWorldResidentIdleActionPort.js";
import { AgentWorldResidentIdleDecisionKinds } from "../../../Source/AgentSystem/World/AgentWorldResidentIdleRuntime.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();
const now = Temporal.Instant.from("2026-09-02T00:00:00Z");
const baseInput = {
  worldId: "world",
  workItemId: "work-1",
  now,
  snapshot: {} as never,
};

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

function createPort(
  resolveTargetSession: () => string | undefined | Promise<string | undefined>,
  delivery?: AgentWorldResidentIdleDeliveryPort,
) {
  const workspace = createTemporaryDirectory("senera-resident-idle-action");
  workspaces.add(workspace);
  const database = new AgentSqliteDatabaseKernel({
    databasePath: path.join(workspace, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  const agenda = new AgentAgendaService({
    store: new AgentAgendaSqliteStore(database),
    now: () => new Date(now.epochMilliseconds),
  });
  const worldId = agenda.snapshot("Asia/Shanghai", new Date(now.epochMilliseconds)).world.id;
  const port = new AgentWorldResidentIdleAgendaActionPort({
    agenda,
    timeZone: () => "Asia/Shanghai",
    resolveTargetSession,
    ...(delivery ? { delivery } : {}),
  });
  return { database, agenda, port, worldId };
}

describe("resident idle action port", () => {
  test("creates a host-committed goal with durable evidence", async () => {
    const { database, agenda, port, worldId } = createPort(() => "session-1");
    try {
      const result = await port.execute({
        ...baseInput,
        worldId,
        decision: {
          kind: AgentWorldResidentIdleDecisionKinds.CreateGoal,
          reason: "用户近期持续关注天气",
          goal: { summary: "整理本周天气趋势", successCriteria: ["形成一份摘要"] },
        },
      });
      expect(result.changed).toBe(true);
      expect(result.evidenceRefs).toHaveLength(1);
      expect(agenda.snapshot("Asia/Shanghai", new Date(now.epochMilliseconds)).activeGoals[0]).toMatchObject({
        summary: "整理本周天气趋势",
        ownerSessionId: "session-1",
        intentMode: "committed",
      });
    } finally {
      database.close();
    }
  });

  test("does not fabricate delivery when no eligible session exists", async () => {
    const delivery = { deliver: vi.fn() } as unknown as AgentWorldResidentIdleDeliveryPort & {
      deliver: ReturnType<typeof vi.fn>;
    };
    const { database, port } = createPort(() => undefined, delivery);
    try {
      await expect(
        port.execute({
          ...baseInput,
          decision: {
            kind: AgentWorldResidentIdleDecisionKinds.Notify,
            reason: "需要通知",
            message: "世界发生了有意义的变化。",
          },
        }),
      ).resolves.toMatchObject({ changed: false, result: { status: "blocked" } });
      expect(delivery.deliver).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  test("keeps a busy target retryable instead of acknowledging the notification", async () => {
    const delivery = {
      deliver: vi.fn(async () => "busy" as const),
    };
    const { database, port } = createPort(() => "busy-session", delivery);
    try {
      await expect(
        port.execute({
          ...baseInput,
          decision: {
            kind: AgentWorldResidentIdleDecisionKinds.Notify,
            reason: "稍后通知",
            message: "请稍后查看。",
          },
        }),
      ).rejects.toThrow(/target is busy/);
    } finally {
      database.close();
    }
  });
});
