import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentTodoService } from "../../../Source/AgentSystem/Todos/AgentTodoService.js";
import { AgentTodoSqliteStore } from "../../../Source/AgentSystem/Todos/AgentTodoSqliteStore.js";
import { AgentTodoStatuses, type AgentTodoPolicy } from "../../../Source/AgentSystem/Todos/AgentTodoTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("Todo service", () => {
  test("adds tasks with host-assigned stable ids and preserves their declared order", () => {
    const fixture = createFixture("senera-todo-add");
    try {
      const created = fixture.service.add({
        sessionId: "session-1",
        now: new Date("2026-09-01T00:00:00.000Z"),
        tasks: [{ content: "待处理" }, { content: "处理中" }, { content: "已完成" }],
      });
      fixture.service.update({
        sessionId: "session-1",
        updates: [
          { id: created.created[1]!.id, status: AgentTodoStatuses.InProgress },
          { id: created.created[2]!.id, status: AgentTodoStatuses.Completed },
        ],
      });
      const snapshot = fixture.service.read("session-1");

      expect(created.created.every((item) => item.status === AgentTodoStatuses.Pending)).toBe(true);
      expect(new Set(created.created.map((item) => item.id)).size).toBe(3);
      expect(snapshot.items.map((item) => item.content)).toEqual(["待处理", "处理中", "已完成"]);
      expect(snapshot.items.map((item) => item.order)).toEqual([0, 1, 2]);
      expect(snapshot.counts).toEqual({ total: 3, pending: 1, inProgress: 1, completed: 1, cancelled: 0 });
      expect(fixture.service.promptContext("session-1").items.map((item) => item.content)).toEqual([
        "待处理",
        "处理中",
      ]);
      expect(fixture.service.read("other-session").items).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  test("updates by stable id while preserving omitted fields and creation timestamps", () => {
    const fixture = createFixture("senera-todo-update");
    try {
      const initial = fixture.service.add({
        sessionId: "session-1",
        now: new Date("2026-09-01T00:00:00.000Z"),
        tasks: [{ content: "第一项" }, { content: "第二项" }],
      });
      const firstId = initial.created[0]!.id;
      const secondId = initial.created[1]!.id;
      const initialSnapshot = fixture.service.read("session-1");
      const updated = fixture.service.update({
        sessionId: "session-1",
        now: new Date("2026-09-01T01:00:00.000Z"),
        updates: [
          { id: secondId, content: "更新后的第二项", status: AgentTodoStatuses.InProgress },
          { id: firstId, status: AgentTodoStatuses.Completed },
        ],
      });
      const snapshot = fixture.service.read("session-1");

      expect(updated.updated).toEqual([
        { id: secondId, status: AgentTodoStatuses.InProgress },
        { id: firstId, status: AgentTodoStatuses.Completed },
      ]);
      expect(snapshot.items.map((item) => item.content)).toEqual(["第一项", "更新后的第二项"]);
      expect(snapshot.items[0]).toMatchObject({ id: firstId, status: AgentTodoStatuses.Completed });
      expect(snapshot.items[1]).toMatchObject({ id: secondId, status: AgentTodoStatuses.InProgress });
      expect(snapshot.items[1]?.createdAt).toBe(initialSnapshot.items.find((item) => item.id === secondId)?.createdAt);
      expect(snapshot.items[1]?.updatedAt).toBe("2026-09-01T01:00:00.000Z");

      const appended = fixture.service.add({
        sessionId: "session-1",
        tasks: [{ content: "第三项" }],
      });
      expect(appended.created).toHaveLength(1);
      expect(fixture.service.read("session-1").items.map((item) => item.content)).toEqual([
        "第一项",
        "更新后的第二项",
        "第三项",
      ]);
    } finally {
      fixture.close();
    }
  });

  test("rejects invalid status transitions and task limits before persistence", () => {
    const fixture = createFixture("senera-todo-validation", {
      maxItems: 2,
      maxContentCharacters: 8,
    });
    try {
      const created = fixture.service.add({
        sessionId: "session-1",
        tasks: [{ content: "one" }, { content: "two" }],
      });
      expect(() =>
        fixture.service.add({
          sessionId: "session-1",
          tasks: [{ content: "third" }],
        }),
      ).toThrow("Todo list exceeds 2 items.");
      expect(() =>
        fixture.service.update({
          sessionId: "session-1",
          updates: created.created.map(({ id }) => ({ id, status: AgentTodoStatuses.InProgress })),
        }),
      ).toThrow("At most one Todo may be in_progress.");
      expect(() =>
        fixture.service.update({
          sessionId: "session-1",
          updates: [
            { id: created.created[0]!.id, status: AgentTodoStatuses.Completed },
            { id: created.created[0]!.id, status: AgentTodoStatuses.Pending },
          ],
        }),
      ).toThrow("updated more than once");
      expect(() =>
        fixture.service.update({
          sessionId: "session-1",
          updates: [{ id: "missing", status: AgentTodoStatuses.Completed }],
        }),
      ).toThrow("does not exist");
      expect(() =>
        fixture.service.update({
          sessionId: "session-1",
          updates: [{ id: created.created[0]!.id, content: "123456789" }],
        }),
      ).toThrow(`Todo ${created.created[0]!.id} exceeds 8 content characters.`);
      expect(fixture.service.read("session-1").items).toHaveLength(2);
    } finally {
      fixture.close();
    }
  });

  test("does not persist a write whose serialized result exceeds its policy", () => {
    const fixture = createFixture("senera-todo-result-limit", {
      maxContentCharacters: 1_000,
      maxResultCharacters: 180,
    });
    try {
      expect(() =>
        fixture.service.add({
          sessionId: "session-1",
          tasks: [{ content: "x".repeat(120) }],
        }),
      ).toThrow("Todo result exceeds the configured result limit.");
      expect(fixture.store.list("session-1")).toEqual([]);
    } finally {
      fixture.close();
    }
  });
});

function createFixture(name: string, policy: Partial<AgentTodoPolicy> = {}) {
  const workspace = createTemporaryDirectory(name);
  workspaces.add(workspace);
  const database = new AgentSqliteDatabaseKernel({
    databasePath: path.join(workspace, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  const store = new AgentTodoSqliteStore(database);
  return {
    store,
    service: new AgentTodoService({
      store,
      policy: {
        maxItems: 16,
        maxContentCharacters: 1_000,
        maxResultCharacters: 16_000,
        ...policy,
      },
    }),
    close: () => database.close(),
  };
}
