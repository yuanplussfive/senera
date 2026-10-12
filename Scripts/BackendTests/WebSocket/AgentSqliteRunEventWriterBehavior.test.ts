import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
  type AgentEventEnvelope,
} from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { SqliteSessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import {
  AgentSqliteRunEventWriter,
  type AgentSqliteRunEventWriterOptions,
} from "../../../Source/AgentSystem/WebSocket/AgentSqliteRunEventWriter.js";
import { resolveAgentDefaults } from "../../../Source/AgentSystem/Defaults/AgentDefaultResolver.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const eventWriterDefaults = resolveAgentDefaults({} as AgentSystemConfig).Persistence.EventWriter;

describe("SQLite run event writer behavior", () => {
  test("acknowledges an append only after every outbox batch is committed", async () => {
    const directory = createTemporaryDirectory("senera-run-event-writer");
    const databasePath = path.join(directory, "sessions.db");
    const repository = new SqliteSessionRepository(databasePath);
    const writer = createWriter(databasePath, { drainBatchSize: 4 });
    try {
      repository.upsertSession({
        id: "session-batched-events",
        status: "idle",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        conversation: [],
      });
      const events = Array.from({ length: 11 }, (_, index) => createEvent(index));

      await withWriterDeadline(writer.append(events), writer, 2_000);
      await writer.flush();

      expect(repository.loadRunEvents("session-batched-events")).toHaveLength(events.length);
      expect(readOutboxStateCounts(databasePath)).toEqual([{ state: "committed", count: events.length }]);
      expect(writer.health()).toEqual(
        expect.objectContaining({
          state: "healthy",
          pendingBatches: 0,
          committedBatches: 1,
          failedBatches: 0,
          committedEventWatermarks: { "session-batched-events": events.length },
        }),
      );
    } finally {
      await writer.close();
      repository.close();
      removeDirectory(directory);
    }
  });

  test("recovers every pending outbox batch before flush resolves", async () => {
    const directory = createTemporaryDirectory("senera-run-event-recovery");
    const databasePath = path.join(directory, "sessions.db");
    const repository = new SqliteSessionRepository(databasePath);
    repository.upsertSession({
      id: "session-batched-events",
      status: "idle",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      conversation: [],
    });
    const events = Array.from({ length: 9 }, (_, index) => createEvent(index));
    seedPendingOutbox(databasePath, events);
    const writer = createWriter(databasePath, { drainBatchSize: 4 });
    try {
      await withWriterDeadline(writer.flush(), writer, 2_000);

      expect(repository.loadRunEvents("session-batched-events")).toHaveLength(events.length);
      expect(readOutboxStateCounts(databasePath)).toEqual([{ state: "committed", count: events.length }]);
    } finally {
      await writer.close();
      repository.close();
      removeDirectory(directory);
    }
  });

  test("removes committed outbox rows after the configured retention window", async () => {
    const directory = createTemporaryDirectory("senera-run-event-retention");
    const databasePath = path.join(directory, "sessions.db");
    const repository = new SqliteSessionRepository(databasePath);
    repository.upsertSession({
      id: "session-batched-events",
      status: "idle",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      conversation: [],
    });
    seedCommittedOutbox(databasePath, createEvent(0));
    const writer = createWriter(databasePath, { committedRetentionMs: 1 });
    try {
      await withWriterDeadline(writer.flush(), writer, 2_000);
      expect(readOutboxStateCounts(databasePath)).toEqual([]);
    } finally {
      await writer.close();
      repository.close();
      removeDirectory(directory);
    }
  });

  test("waits for a concurrent maintenance write lock without degrading or losing the event", async () => {
    const directory = createTemporaryDirectory("senera-run-event-maintenance-lock");
    const databasePath = path.join(directory, "sessions.db");
    const repository = new SqliteSessionRepository(databasePath);
    const writer = createWriter(databasePath);
    const maintenance = new Database(databasePath);
    try {
      repository.upsertSession({
        id: "session-batched-events",
        status: "idle",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        conversation: [],
      });
      await writer.flush();
      maintenance.pragma("journal_mode = WAL");
      maintenance.exec("BEGIN IMMEDIATE");

      const append = writer.append([createEvent(0)]);
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      expect(writer.health().pendingBatches).toBe(1);
      maintenance.exec("COMMIT");

      await withWriterDeadline(append, writer, 2_000);
      expect(repository.loadRunEvents("session-batched-events")).toHaveLength(1);
      expect(writer.health()).toMatchObject({
        state: "healthy",
        pendingBatches: 0,
        failedBatches: 0,
        committedEventWatermarks: { "session-batched-events": 1 },
      });
    } finally {
      if (maintenance.inTransaction) maintenance.exec("ROLLBACK");
      maintenance.close();
      await writer.close();
      repository.close();
      removeDirectory(directory);
    }
  });
});

function createWriter(
  databasePath: string,
  overrides: Partial<Omit<AgentSqliteRunEventWriterOptions, "databasePath">> = {},
): AgentSqliteRunEventWriter {
  return new AgentSqliteRunEventWriter({
    databasePath,
    restartDelayMs: eventWriterDefaults.RestartDelayMs,
    closeTimeoutMs: eventWriterDefaults.CloseTimeoutMs,
    drainBatchSize: eventWriterDefaults.DrainBatchSize,
    committedRetentionMs: eventWriterDefaults.CommittedRetentionMs,
    ...(overrides.restartDelayMs === undefined ? {} : { restartDelayMs: overrides.restartDelayMs }),
    ...(overrides.closeTimeoutMs === undefined ? {} : { closeTimeoutMs: overrides.closeTimeoutMs }),
    ...(overrides.drainBatchSize === undefined ? {} : { drainBatchSize: overrides.drainBatchSize }),
    ...(overrides.committedRetentionMs === undefined ? {} : { committedRetentionMs: overrides.committedRetentionMs }),
  });
}

function createEvent(index: number): AgentEventEnvelope {
  return {
    eventId: `event-batch-${index}`,
    channel: AgentEventChannels.AgentEvent,
    kind: AgentEventKinds.ModelStarted,
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Model,
    sessionId: "session-batched-events",
    requestId: "request-batched-events",
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    sequence: index + 1,
    data: { index },
  };
}

function withWriterDeadline<T>(
  operation: Promise<T>,
  writer: AgentSqliteRunEventWriter,
  timeoutMs: number,
): Promise<T> {
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`SQLite writer operation timed out: ${JSON.stringify(writer.health())}`)),
        timeoutMs,
      );
      timer.unref();
    }),
  ]);
}

function seedPendingOutbox(databasePath: string, events: readonly AgentEventEnvelope[]): void {
  const database = new Database(databasePath);
  try {
    const insertRunEvent = database.prepare(`
      INSERT INTO run_events
        (session_id, request_id, kind, timestamp, event_sequence, step, detail_id, event_id, reliability, event_json)
      VALUES (@session_id, @request_id, @kind, @timestamp, @event_sequence, @step, @detail_id, @event_id, 'durable', @event_json)
    `);
    const insert = database.prepare(`
      INSERT INTO event_outbox
        (event_id, session_id, request_id, kind, timestamp, event_sequence, step, detail_id, state, created_at)
      VALUES
        (@event_id, @session_id, @request_id, @kind, @timestamp, @event_sequence, @step, @detail_id, 'pending', @created_at)
    `);
    database.transaction((batch: readonly AgentEventEnvelope[]) => {
      for (const event of batch) {
        insertRunEvent.run({
          session_id: event.sessionId,
          request_id: event.requestId,
          kind: event.kind,
          timestamp: event.timestamp,
          event_sequence: event.sequence,
          step: event.step ?? null,
          detail_id: event.detailId ?? null,
          event_id: event.eventId,
          event_json: JSON.stringify(event),
        });
        insert.run({
          event_id: event.eventId,
          session_id: event.sessionId,
          request_id: event.requestId,
          kind: event.kind,
          timestamp: event.timestamp,
          event_sequence: event.sequence,
          step: event.step ?? null,
          detail_id: event.detailId ?? null,
          created_at: event.timestamp,
        });
      }
    })(events);
  } finally {
    database.close();
  }
}

function seedCommittedOutbox(databasePath: string, event: AgentEventEnvelope): void {
  const database = new Database(databasePath);
  try {
    database
      .prepare(
        `INSERT INTO run_events
          (session_id, request_id, kind, timestamp, event_sequence, step, detail_id, event_id, reliability, event_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'durable', ?)`,
      )
      .run(
        event.sessionId,
        event.requestId,
        event.kind,
        event.timestamp,
        event.sequence,
        event.step ?? null,
        event.detailId ?? null,
        event.eventId,
        JSON.stringify(event),
      );
    database
      .prepare(
        `INSERT INTO event_outbox
          (event_id, session_id, request_id, kind, timestamp, event_sequence, step, detail_id,
           state, created_at, committed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'committed', ?, ?)`,
      )
      .run(
        event.eventId,
        event.sessionId,
        event.requestId,
        event.kind,
        event.timestamp,
        event.sequence,
        event.step ?? null,
        event.detailId ?? null,
        "2020-01-01T00:00:00.000Z",
        "2020-01-01T00:00:00.000Z",
      );
  } finally {
    database.close();
  }
}

function readOutboxStateCounts(databasePath: string): Array<{ state: string; count: number }> {
  const database = new Database(databasePath, { readonly: true });
  try {
    return database
      .prepare<[], { state: string; count: number }>(
        `
        SELECT state, COUNT(*) AS count
        FROM event_outbox
        GROUP BY state
        ORDER BY state
      `,
      )
      .all();
  } finally {
    database.close();
  }
}
