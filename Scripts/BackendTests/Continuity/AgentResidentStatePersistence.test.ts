import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { initialResidentState } from "../../../Source/AgentSystem/Continuity/AgentResidentState.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("residence state persistence", () => {
  test("round-trips a written state through the store", () => {
    const fixture = createStore();
    try {
      expect(fixture.store.readResidentState({ kind: "session", id: "s1" })).toBeUndefined();

      const state = { bearing: "direct" as const, mood: "focused" as const, footing: "in_the_middle_of" as const };
      fixture.store.writeResidentState({ kind: "session", id: "s1" }, state, "2026-09-16T01:00:00.000Z");

      expect(fixture.store.readResidentState({ kind: "session", id: "s1" })).toEqual(state);
    } finally {
      fixture.close();
    }
  });

  test("keeps the latest write and preserves the optional target", () => {
    const fixture = createStore();
    try {
      const scope = { kind: "session" as const, id: "s2" };
      fixture.store.writeResidentState(
        scope,
        { ...initialResidentState(), target: "苏州" },
        "2026-09-16T01:00:00.000Z",
      );
      const updated = { bearing: "wry" as const, mood: "tense" as const, footing: "done" as const, target: "苏州" };
      fixture.store.writeResidentState(scope, updated, "2026-09-16T02:00:00.000Z");

      expect(fixture.store.readResidentState(scope)).toEqual(updated);
    } finally {
      fixture.close();
    }
  });

  test("clear removes the row", () => {
    const fixture = createStore();
    try {
      const scope = { kind: "session" as const, id: "s3" };
      fixture.store.writeResidentState(scope, initialResidentState(), "2026-09-16T01:00:00.000Z");
      expect(fixture.store.clearResidentState(scope)).toBe(1);
      expect(fixture.store.readResidentState(scope)).toBeUndefined();
    } finally {
      fixture.close();
    }
  });

  test("session deletion removes the resident state row", () => {
    const fixture = createStore();
    try {
      const scope = { kind: "session" as const, id: "s4" };
      fixture.store.writeResidentState(scope, initialResidentState(), "2026-09-16T01:00:00.000Z");
      fixture.store.deleteSession("s4");
      expect(fixture.store.readResidentState(scope)).toBeUndefined();
    } finally {
      fixture.close();
    }
  });

  test("rejects an invalid state shape", () => {
    const fixture = createStore();
    try {
      expect(() =>
        fixture.store.writeResidentState(
          { kind: "session", id: "s5" },
          { bearing: "direct", mood: "not-a-mood", footing: "done" } as never,
          "2026-09-16T01:00:00.000Z",
        ),
      ).toThrow();
    } finally {
      fixture.close();
    }
  });
});

function createStore() {
  const workspace = createTemporaryDirectory("senera-resident-state");
  workspaces.add(workspace);
  const kernel = new AgentSqliteDatabaseKernel({
    databasePath: path.join(workspace, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  const store = new AgentContinuitySqliteStore(kernel);
  return {
    kernel,
    store,
    close: () => kernel.close(),
  };
}
