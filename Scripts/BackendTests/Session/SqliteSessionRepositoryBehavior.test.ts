import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
} from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { SqliteSessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { AgentSessionDatabaseContract } from "../../../Source/AgentSystem/SessionPersistence/AgentSessionSqlSchema.js";

describe("SQLite session repository behavior", () => {
  test("round-trips session metadata, entries, run events, snapshots, traces, and profile settings", () => {
    const fixture = createRepository();
    const { repository } = fixture;
    try {
      const session = {
        id: "session-sqlite",
        title: "Original title",
        status: "idle" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        conversation: [],
        metadata: { title: "Original title" },
      };

      repository.upsertSession(session);
      repository.appendEntries(session.id, [
        { sequence: 0, entry: userEntry("request-a", "Read workspace") },
        { sequence: 1, entry: assistantEntry("request-a", "Done") },
      ]);
      repository.persistTurnArtifacts(
        session.id,
        [{ sequence: 2, entry: userEntry("request-b", "Run tests") }],
        [
          {
            requestId: "request-b",
            turnSequence: 2,
            trace: { step: 1, seq: 0, kind: "tool", status: "done" },
          },
        ],
      );
      repository.appendRunEvent(session.id, {
        channel: AgentEventChannels.AgentEvent,
        kind: AgentEventKinds.RunStarted,
        layer: AgentEventLayers.Progress,
        phase: AgentEventPhases.Run,
        requestId: "request-b",
        sessionId: session.id,
        timestamp: "2026-01-01T00:00:02.000Z",
        sequence: 1,
        data: { input: "Run tests" },
      });
      repository.upsertRunSnapshot({
        sessionId: session.id,
        requestId: "request-b",
        input: "Run tests",
        status: "completed",
        startedAt: "2026-01-01T00:00:02.000Z",
        updatedAt: "2026-01-01T00:00:03.000Z",
        endedAt: "2026-01-01T00:00:03.000Z",
      });
      const profile = repository.saveUserProfile({ name: "Ada" });
      repository.renameSession(session.id, "Renamed session");

      expect(repository.listSessions()).toEqual([
        expect.objectContaining({
          id: session.id,
          entryCount: 3,
          messageCount: 3,
          metadata: expect.objectContaining({
            title: "Renamed session",
          }),
        }),
      ]);
      expect(repository.loadSession(session.id)).toEqual(
        expect.objectContaining({
          id: session.id,
          metadata: expect.objectContaining({
            title: "Renamed session",
          }),
          conversation: [
            expect.objectContaining({ requestId: "request-a", kind: "user.message" }),
            expect.objectContaining({ requestId: "request-a", kind: "assistant.decision" }),
            expect.objectContaining({ requestId: "request-b", kind: "user.message" }),
          ],
        }),
      );
      expect(repository.loadStepTraces(session.id)).toEqual([
        expect.objectContaining({ requestId: "request-b", traces: [expect.objectContaining({ kind: "tool" })] }),
      ]);
      expect(repository.loadRunEvents(session.id)).toEqual([
        expect.objectContaining({ kind: AgentEventKinds.RunStarted, requestId: "request-b" }),
      ]);
      expect(repository.loadRunEventsForRequest(session.id, "request-a")).toEqual([]);
      expect(repository.loadRunEventsForRequest(session.id, "request-b")).toEqual([
        expect.objectContaining({ kind: AgentEventKinds.RunStarted, requestId: "request-b" }),
      ]);
      expect(repository.hasRequest(session.id, "request-a")).toBe(true);
      expect(repository.hasRequest(session.id, "missing-request")).toBe(false);
      expect(repository.loadRequestIdsFrom(session.id, "request-a")).toEqual(["request-a", "request-b"]);
      expect(repository.loadRunSnapshots(session.id)).toEqual([
        expect.objectContaining({ requestId: "request-b", status: "completed" }),
      ]);
      expect(repository.loadUserProfile()).toEqual(
        expect.objectContaining({
          name: profile.name,
          avatarDataUrl: null,
        }),
      );
    } finally {
      fixture.cleanup();
    }
  });

  test("deletes entries, run events, traces, and snapshots from a request boundary", () => {
    const fixture = createRepository();
    const { repository } = fixture;
    try {
      repository.upsertSession({
        id: "session-delete",
        status: "idle",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        conversation: [],
      });
      repository.appendEntries("session-delete", [
        { sequence: 0, entry: userEntry("request-a", "A") },
        { sequence: 1, entry: userEntry("request-b", "B") },
        { sequence: 2, entry: userEntry("request-c", "C") },
      ]);
      repository.persistTurnArtifacts(
        "session-delete",
        [],
        [
          { requestId: "request-a", turnSequence: 0, trace: { step: 1, seq: 0, kind: "answer", status: "done" } },
          { requestId: "request-b", turnSequence: 1, trace: { step: 1, seq: 0, kind: "answer", status: "done" } },
        ],
      );
      for (const requestId of ["request-a", "request-b", "request-c"]) {
        repository.appendRunEvent("session-delete", {
          channel: AgentEventChannels.AgentEvent,
          kind: AgentEventKinds.RunStarted,
          layer: AgentEventLayers.Progress,
          phase: AgentEventPhases.Run,
          requestId,
          sessionId: "session-delete",
          timestamp: "2026-01-01T00:00:00.000Z",
          sequence: Number(requestId.at(-1)?.charCodeAt(0) ?? 0),
          data: {},
        });
        repository.upsertRunSnapshot({
          sessionId: "session-delete",
          requestId,
          input: requestId,
          status: "completed",
          startedAt: `2026-01-01T00:00:0${requestId.at(-1) === "a" ? 1 : requestId.at(-1) === "b" ? 2 : 3}.000Z`,
          updatedAt: "2026-01-01T00:00:04.000Z",
        });
      }

      const removed = repository.truncateFromRequest("session-delete", "request-b");

      expect(repository.loadEntries("session-delete").map((entry) => entry.requestId)).toEqual(["request-a"]);
      expect(removed).toBe(2);
      expect(repository.loadRunEvents("session-delete")).toHaveLength(1);
      expect(repository.loadStepTraces("session-delete").map((run) => run.requestId)).toEqual(["request-a"]);
      expect(repository.loadRunSnapshots("session-delete").map((snapshot) => snapshot.requestId)).toEqual([
        "request-a",
      ]);
      expect(repository.deleteSession("session-delete")).toBe(true);
      expect(repository.loadSession("session-delete")).toBeUndefined();
    } finally {
      fixture.cleanup();
    }
  });

  test("scopes conversation entry identity to each session", () => {
    const fixture = createRepository();
    const { repository } = fixture;
    try {
      for (const sessionId of ["session-entry-a", "session-entry-b"]) {
        repository.upsertSession({
          id: sessionId,
          status: "idle",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          conversation: [],
        });
        repository.appendEntry(sessionId, userEntry("shared-request", sessionId), 0);
      }

      expect(repository.loadEntries("session-entry-a")).toEqual([
        expect.objectContaining({ id: "shared-request:user", content: "session-entry-a" }),
      ]);
      expect(repository.loadEntries("session-entry-b")).toEqual([
        expect.objectContaining({ id: "shared-request:user", content: "session-entry-b" }),
      ]);
    } finally {
      fixture.cleanup();
    }
  });

  test("migrates legacy duplicate sequences into a contiguous per-session order", () => {
    const dir = createTemporaryDirectory("senera-session-migration");
    const databasePath = path.join(dir, "session.db");
    const database = new Database(databasePath);
    try {
      installSessionContractThrough(database, 6);
      database
        .prepare(
          `INSERT INTO sessions (id, title, status, created_at, updated_at, metadata)
           VALUES (?, ?, 'idle', ?, ?, '{}')`,
        )
        .run("session-legacy-sequence", "Legacy", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
      const insertEntry = database.prepare(
        `INSERT INTO conversation_entries
          (id, session_id, request_id, kind, timestamp, sequence, data)
         VALUES (?, ?, ?, 'user.message', ?, ?, ?)`,
      );
      insertEntry.run(
        "legacy-a",
        "session-legacy-sequence",
        "request-a",
        "2026-01-01T00:00:00.000Z",
        7,
        JSON.stringify(userEntry("request-a", "A")),
      );
      insertEntry.run(
        "legacy-b",
        "session-legacy-sequence",
        "request-b",
        "2026-01-01T00:00:01.000Z",
        7,
        JSON.stringify(userEntry("request-b", "B")),
      );
    } finally {
      database.close();
    }

    const repository = new SqliteSessionRepository(databasePath);
    try {
      expect(repository.loadEntries("session-legacy-sequence").map((entry) => entry.requestId)).toEqual([
        "request-a",
        "request-b",
      ]);
    } finally {
      repository.close();
    }

    const migrated = new Database(databasePath, { readonly: true });
    try {
      expect(
        migrated
          .prepare("SELECT sequence FROM conversation_entries WHERE session_id = ? ORDER BY sequence")
          .all("session-legacy-sequence"),
      ).toEqual([{ sequence: 0 }, { sequence: 1 }]);
    } finally {
      migrated.close();
      removeDirectory(dir);
    }
  });

  test("adds the request-scoped run event index when upgrading a v7 session database", () => {
    const dir = createTemporaryDirectory("senera-session-request-index");
    const databasePath = path.join(dir, "session.db");
    const database = new Database(databasePath);
    try {
      installSessionContractThrough(database, 7);
    } finally {
      database.close();
    }

    const repository = new SqliteSessionRepository(databasePath);
    repository.close();
    const migrated = new Database(databasePath, { readonly: true });
    try {
      expect(migrated.pragma("index_list('run_events')")).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "idx_run_events_session_request_id" })]),
      );
    } finally {
      migrated.close();
      removeDirectory(dir);
    }
  });

  test("backfills stable run-snapshot sequences when upgrading a v8 session database", () => {
    const dir = createTemporaryDirectory("senera-run-snapshot-sequence");
    const databasePath = path.join(dir, "session.db");
    const database = new Database(databasePath);
    try {
      installSessionContractThrough(database, 8);
      database
        .prepare(
          `INSERT INTO sessions (id, title, status, created_at, updated_at, metadata)
           VALUES (?, ?, 'idle', ?, ?, '{}')`,
        )
        .run("session-snapshot-migration", "Snapshots", timestamp(0), timestamp(0));
      const insert = database.prepare(
        `INSERT INTO run_snapshots
          (session_id, request_id, input, status, started_at, updated_at)
         VALUES (?, ?, ?, 'completed', ?, ?)`,
      );
      insert.run("session-snapshot-migration", "request-later", "later", timestamp(2), timestamp(3));
      insert.run("session-snapshot-migration", "request-earlier", "earlier", timestamp(1), timestamp(2));
    } finally {
      database.close();
    }

    const repository = new SqliteSessionRepository(databasePath);
    try {
      const historyWatermark =
        repository.captureHistorySnapshot("session-snapshot-migration")?.runSnapshotHighWaterMark;
      expect(historyWatermark).toBe(2);
      expect(repository.loadRunSnapshots("session-snapshot-migration").map((snapshot) => snapshot.requestId)).toEqual([
        "request-earlier",
        "request-later",
      ]);
      repository.upsertRunSnapshot({
        ...storedRunSnapshot("session-snapshot-migration", "request-earlier", 9),
        status: "failed",
      });
      expect(repository.loadRunSnapshots("session-snapshot-migration")[0]).toEqual(
        expect.objectContaining({
          requestId: "request-earlier",
          startedAt: timestamp(1),
          status: "failed",
        }),
      );
      expect(
        repository.loadRunSnapshotsForRequests("session-snapshot-migration", ["request-earlier"], historyWatermark!),
      ).toEqual([expect.objectContaining({ requestId: "request-earlier", status: "completed" })]);
      const beforeDeleteWatermark =
        repository.captureHistorySnapshot("session-snapshot-migration")?.runSnapshotHighWaterMark;
      expect(repository.deleteRunSnapshotsFrom("session-snapshot-migration", "request-earlier")).toBe(2);
      expect(readRunSnapshotPages(repository, "session-snapshot-migration", beforeDeleteWatermark!, 10)).toEqual([
        ["request-earlier", "request-later"],
      ]);
      expect(repository.captureHistorySnapshot("session-snapshot-migration")?.runSnapshotHighWaterMark).toBeUndefined();
    } finally {
      repository.close();
    }

    const migrated = new Database(databasePath, { readonly: true });
    try {
      expect(migrated.pragma("index_list('run_snapshots')")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "idx_run_snapshots_session" }),
          expect.objectContaining({ name: "idx_run_snapshots_status" }),
        ]),
      );
      expect(migrated.pragma("index_list('run_snapshot_revisions')")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "idx_run_snapshot_revisions_session_revision" }),
          expect.objectContaining({ name: "idx_run_snapshot_revisions_session_history" }),
          expect.objectContaining({ name: "idx_run_snapshot_revisions_request" }),
        ]),
      );
    } finally {
      migrated.close();
      removeDirectory(dir);
    }
  });

  test("rolls back the entire turn commit when a terminal event cannot be serialized", () => {
    const fixture = createRepository();
    const { repository } = fixture;
    try {
      repository.upsertSession({
        id: "session-atomic-turn",
        status: "idle",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        conversation: [],
      });

      expect(() =>
        repository.persistTurnCommit({
          sessionId: "session-atomic-turn",
          requestId: "request-atomic-turn",
          session: {
            id: "session-atomic-turn",
            status: "running",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
            activeRequest: {
              requestId: "request-atomic-turn",
              input: "Commit atomically",
              startedAt: "2026-01-01T00:00:00.000Z",
            },
            conversation: [],
          },
          entries: [{ sequence: 0, entry: userEntry("request-atomic-turn", "Commit atomically") }],
          traces: [
            {
              requestId: "request-atomic-turn",
              turnSequence: 0,
              trace: { step: 1, seq: 0, kind: "answer", status: "done" },
            },
          ],
          snapshot: {
            sessionId: "session-atomic-turn",
            requestId: "request-atomic-turn",
            input: "Commit atomically",
            status: "completed",
            startedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
            endedAt: "2026-01-01T00:00:01.000Z",
          },
          runEvents: [
            {
              eventId: "event-atomic-turn",
              channel: AgentEventChannels.AgentEvent,
              kind: AgentEventKinds.RunCompleted,
              layer: AgentEventLayers.Terminal,
              phase: AgentEventPhases.Run,
              requestId: "request-atomic-turn",
              sessionId: "session-atomic-turn",
              timestamp: "2026-01-01T00:00:01.000Z",
              sequence: 1,
              data: { unserializable: 1n },
            },
          ],
        }),
      ).toThrow();

      expect(repository.loadEntries("session-atomic-turn")).toEqual([]);
      expect(repository.loadSession("session-atomic-turn")).toEqual(expect.objectContaining({ status: "idle" }));
      expect(repository.loadStepTraces("session-atomic-turn")).toEqual([]);
      expect(repository.loadRunSnapshots("session-atomic-turn")).toEqual([]);
      expect(repository.loadRunEvents("session-atomic-turn")).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  test("reads entries and run events with stable keyset cursors bounded by a captured snapshot", () => {
    const fixture = createRepository();
    const { repository } = fixture;
    const sessionId = "session-keyset-pages";
    try {
      repository.upsertSession({
        id: sessionId,
        status: "idle",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        conversation: [],
      });
      repository.appendEntries(
        sessionId,
        Array.from({ length: 5 }, (_, sequence) => ({
          sequence,
          entry: userEntry(`request-${sequence}`, `message-${sequence}`),
        })),
      );
      for (let sequence = 1; sequence <= 5; sequence += 1) {
        repository.appendRunEvent(sessionId, runEvent(sessionId, `request-${sequence}`, sequence));
        repository.upsertRunSnapshot({
          ...storedRunSnapshot(sessionId, `request-${sequence}`, sequence),
          status: sequence === 5 ? "running" : "completed",
        });
        repository.persistTurnArtifacts(
          sessionId,
          [],
          [
            {
              requestId: `request-${sequence}`,
              turnSequence: sequence,
              trace: { step: 1, seq: 0, kind: "tool", status: "done" },
            },
          ],
        );
      }
      const snapshot = repository.captureHistorySnapshot(sessionId);
      expect(snapshot).toEqual(
        expect.objectContaining({
          entryCount: 5,
          messageCount: 5,
          entryHighWaterMark: 4,
          stepTraceHighWaterMark: 5,
          runSnapshotHighWaterMark: 5,
          runEventHighWaterMark: 5,
        }),
      );

      repository.appendEntry(sessionId, userEntry("request-late", "late"), 5);
      repository.appendRunEvent(sessionId, runEvent(sessionId, "request-late", 6));
      repository.upsertRunSnapshot(storedRunSnapshot(sessionId, "request-late", 6));
      repository.upsertRunSnapshot({
        ...storedRunSnapshot(sessionId, "request-5", 5),
        status: "failed",
      });

      expect(readEntryPages(repository, sessionId, snapshot!.entryHighWaterMark!, 2)).toEqual([
        ["request-0", "request-1"],
        ["request-2", "request-3"],
        ["request-4"],
      ]);
      expect(readRunEventPages(repository, sessionId, snapshot!.runEventHighWaterMark!, 2)).toEqual([
        ["request-1", "request-2"],
        ["request-3", "request-4"],
        ["request-5"],
      ]);
      expect(readStepTracePages(repository, sessionId, snapshot!.stepTraceHighWaterMark!, 2)).toEqual([
        ["request-1", "request-2"],
        ["request-3", "request-4"],
        ["request-5"],
      ]);
      expect(readRunSnapshotPages(repository, sessionId, snapshot!.runSnapshotHighWaterMark!, 2)).toEqual([
        ["request-1", "request-2"],
        ["request-3", "request-4"],
        ["request-5"],
      ]);
      expect(
        repository
          .loadRunSnapshotsForRequests(
            sessionId,
            ["request-4", "request-2", "request-late"],
            snapshot!.runSnapshotHighWaterMark!,
          )
          .map((item) => item.requestId),
      ).toEqual(["request-2", "request-4"]);
      expect(
        repository.loadRunSnapshotsForRequests(sessionId, ["request-5"], snapshot!.runSnapshotHighWaterMark!),
      ).toEqual([expect.objectContaining({ requestId: "request-5", status: "running" })]);
      expect(
        repository
          .loadEntriesForRequests(sessionId, ["request-1", "request-3", "request-late"], 4)
          .map((item) => item.requestId),
      ).toEqual(["request-1", "request-3"]);
      expect(repository.loadStepTraceRequestIds(sessionId, ["request-2", "request-late"], 5)).toEqual(["request-2"]);
      expect(repository.loadRunningRunSnapshots()).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  test("advances an entry cursor past an undecodable row without repeating or omitting later rows", () => {
    const fixture = createRepository();
    const { repository } = fixture;
    const sessionId = "session-damaged-page";
    try {
      repository.upsertSession({
        id: sessionId,
        status: "idle",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        conversation: [],
      });
      repository.appendEntries(sessionId, [
        { sequence: 0, entry: userEntry("request-a", "A") },
        { sequence: 1, entry: userEntry("request-b", "B") },
        { sequence: 2, entry: userEntry("request-c", "C") },
      ]);
      const database = new Database(fixture.databasePath);
      try {
        database
          .prepare("UPDATE conversation_entries SET data = ? WHERE session_id = ? AND sequence = ?")
          .run("{invalid", sessionId, 1);
      } finally {
        database.close();
      }

      const first = repository.loadEntryPage(sessionId, { through: 2, pageSize: 1 });
      const damaged = repository.loadEntryPage(sessionId, {
        after: first.nextCursor,
        through: 2,
        pageSize: 1,
      });
      const last = repository.loadEntryPage(sessionId, {
        after: damaged.nextCursor,
        through: 2,
        pageSize: 1,
      });

      expect(first).toEqual({ items: [expect.objectContaining({ requestId: "request-a" })], nextCursor: 0 });
      expect(damaged).toEqual({ items: [], nextCursor: 1 });
      expect(last).toEqual({ items: [expect.objectContaining({ requestId: "request-c" })] });
    } finally {
      fixture.cleanup();
    }
  });
});

function createRepository(): { repository: SqliteSessionRepository; databasePath: string; cleanup: () => void } {
  const dir = createTemporaryDirectory("senera-session-repository");
  const databasePath = path.join(dir, "session.db");
  const repository = new SqliteSessionRepository(databasePath);
  return {
    repository,
    databasePath,
    cleanup: () => {
      repository.close();
      removeDirectory(dir);
    },
  };
}

function readEntryPages(
  repository: SqliteSessionRepository,
  sessionId: string,
  through: number,
  pageSize: number,
): string[][] {
  const pages: string[][] = [];
  let cursor: number | undefined;
  for (;;) {
    const page = repository.loadEntryPage(sessionId, { after: cursor, through, pageSize });
    pages.push(page.items.map((entry) => entry.requestId));
    if (page.nextCursor === undefined) return pages;
    cursor = page.nextCursor;
  }
}

function readRunEventPages(
  repository: SqliteSessionRepository,
  sessionId: string,
  through: number,
  pageSize: number,
): string[][] {
  const pages: string[][] = [];
  let cursor: number | undefined;
  for (;;) {
    const page = repository.loadRunEventPage(sessionId, { after: cursor, through, pageSize });
    pages.push(page.items.flatMap((event) => (event.requestId ? [event.requestId] : [])));
    if (page.nextCursor === undefined) return pages;
    cursor = page.nextCursor;
  }
}

function readStepTracePages(
  repository: SqliteSessionRepository,
  sessionId: string,
  throughRowId: number,
  pageSize: number,
): string[][] {
  const pages: string[][] = [];
  let cursor: Parameters<SqliteSessionRepository["loadStepTracePage"]>[1]["after"];
  for (;;) {
    const page = repository.loadStepTracePage(sessionId, { after: cursor, throughRowId, pageSize });
    pages.push(page.items.map((run) => run.requestId));
    if (!page.nextCursor) return pages;
    cursor = page.nextCursor;
  }
}

function readRunSnapshotPages(
  repository: SqliteSessionRepository,
  sessionId: string,
  through: number,
  pageSize: number,
): string[][] {
  const pages: string[][] = [];
  let cursor: number | undefined;
  for (;;) {
    const page = repository.loadRunSnapshotPage(sessionId, { after: cursor, through, pageSize });
    pages.push(page.items.map((snapshot) => snapshot.requestId));
    if (page.nextCursor === undefined) return pages;
    cursor = page.nextCursor;
  }
}

function installSessionContractThrough(database: Database.Database, version: number): void {
  database.exec(`
    CREATE TABLE __senera_database_contract (
      store_id TEXT PRIMARY KEY,
      data_class TEXT NOT NULL CHECK(data_class IN ('authoritative', 'derived'))
    ) STRICT;
    CREATE TABLE __senera_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  database
    .prepare("INSERT INTO __senera_database_contract (store_id, data_class) VALUES (?, ?)")
    .run(AgentSessionDatabaseContract.id, AgentSessionDatabaseContract.dataClass);
  const record = database.prepare(
    `INSERT INTO __senera_schema_migrations (version, name, checksum, applied_at)
     VALUES (?, ?, ?, ?)`,
  );
  for (const migration of AgentSessionDatabaseContract.migrations.slice(0, version)) {
    database.exec(migration.sql);
    record.run(migration.version, migration.name, migration.checksum, "2026-01-01T00:00:00.000Z");
  }
}

function userEntry(requestId: string, content: string) {
  return {
    id: `${requestId}:user`,
    requestId,
    timestamp: "2026-01-01T00:00:00.000Z",
    kind: "user.message" as const,
    content,
  };
}

function assistantEntry(requestId: string, xml: string) {
  return {
    id: `${requestId}:assistant`,
    requestId,
    timestamp: "2026-01-01T00:00:01.000Z",
    kind: "assistant.decision" as const,
    xml,
  };
}

function runEvent(sessionId: string, requestId: string, sequence: number) {
  return {
    channel: AgentEventChannels.AgentEvent,
    kind: AgentEventKinds.RunStarted,
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Run,
    requestId,
    sessionId,
    timestamp: "2026-01-01T00:00:00.000Z",
    sequence,
    data: {},
  } as const;
}

function storedRunSnapshot(sessionId: string, requestId: string, offset: number) {
  return {
    sessionId,
    requestId,
    input: requestId,
    status: "completed" as const,
    startedAt: timestamp(offset),
    updatedAt: timestamp(offset + 1),
    endedAt: timestamp(offset + 1),
  };
}

function timestamp(offset: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, offset)).toISOString();
}
