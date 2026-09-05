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
  test("replaces and persists ordered items while projecting only active prompt context", () => {
    const fixture = createFixture("senera-todo-replace");
    try {
      const snapshot = fixture.service.write({
        sessionId: "session-1",
        merge: false,
        now: new Date("2026-09-01T00:00:00.000Z"),
        items: [
          { id: "pending", content: "待处理" },
          { id: "active", content: "处理中", status: AgentTodoStatuses.InProgress },
          { id: "done", content: "已完成", status: AgentTodoStatuses.Completed },
        ],
      });

      expect(snapshot.items.map((item) => item.id)).toEqual(["active", "pending", "done"]);
      expect(snapshot.counts).toEqual({ total: 3, pending: 1, inProgress: 1, completed: 1, cancelled: 0 });
      expect(fixture.service.read("session-1")).toEqual(snapshot);
      expect(fixture.service.promptContext("session-1").items.map((item) => item.id)).toEqual(["active", "pending"]);
      expect(fixture.service.read("other-session").items).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  test("merges updates by stable id and preserves creation timestamps", () => {
    const fixture = createFixture("senera-todo-merge");
    try {
      const initial = fixture.service.write({
        sessionId: "session-1",
        merge: false,
        now: new Date("2026-09-01T00:00:00.000Z"),
        items: [
          { id: "first", content: "第一项" },
          { id: "second", content: "第二项" },
        ],
      });
      const merged = fixture.service.write({
        sessionId: "session-1",
        merge: true,
        now: new Date("2026-09-01T01:00:00.000Z"),
        items: [
          { id: "second", content: "更新后的第二项", status: AgentTodoStatuses.InProgress },
          { id: "third", content: "第三项" },
        ],
      });

      expect(merged.items.map((item) => item.id)).toEqual(["second", "first", "third"]);
      expect(merged.items[0]).toMatchObject({ content: "更新后的第二项", status: AgentTodoStatuses.InProgress });
      expect(merged.items.find((item) => item.id === "second")?.createdAt).toBe(initial.items[1]?.createdAt);
      expect(merged.items.find((item) => item.id === "second")?.updatedAt).toBe("2026-09-01T01:00:00.000Z");
    } finally {
      fixture.close();
    }
  });

  test("rejects duplicate ids, multiple active items, and configured item limits before persistence", () => {
    const fixture = createFixture("senera-todo-validation", {
      maxItems: 2,
      maxContentCharacters: 8,
    });
    try {
      expect(() =>
        fixture.service.write({
          sessionId: "session-1",
          merge: false,
          items: [
            { id: "duplicate", content: "one" },
            { id: "duplicate", content: "two" },
          ],
        }),
      ).toThrow("Todo id is duplicated: duplicate.");
      expect(() =>
        fixture.service.write({
          sessionId: "session-1",
          merge: false,
          items: [
            { id: "first", content: "one", status: AgentTodoStatuses.InProgress },
            { id: "second", content: "two", status: AgentTodoStatuses.InProgress },
          ],
        }),
      ).toThrow("Only one Todo may be in_progress.");
      expect(() =>
        fixture.service.write({
          sessionId: "session-1",
          merge: false,
          items: [
            { id: "first", content: "one" },
            { id: "second", content: "two" },
            { id: "third", content: "three" },
          ],
        }),
      ).toThrow("Todo list exceeds 2 items.");
      expect(() =>
        fixture.service.write({
          sessionId: "session-1",
          merge: false,
          items: [{ id: "long", content: "123456789" }],
        }),
      ).toThrow("Todo long exceeds 8 content characters.");
      expect(fixture.store.list("session-1")).toEqual([]);
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
        fixture.service.write({
          sessionId: "session-1",
          merge: false,
          items: [{ id: "large", content: "x".repeat(120) }],
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
