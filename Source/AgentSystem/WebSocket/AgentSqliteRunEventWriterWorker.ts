import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";
import { AgentSessionDatabaseContract } from "../SessionPersistence/AgentSessionSqlSchema.js";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";

interface AppendMessage {
  readonly type: "append";
  readonly requestId: number;
  readonly events: readonly AgentEventEnvelope[];
}

interface FlushMessage {
  readonly type: "flush";
  readonly requestId: number;
}

interface ShutdownMessage {
  readonly type: "shutdown";
  readonly requestId: number;
}

type WriterMessage = AppendMessage | FlushMessage | ShutdownMessage;

interface OutboxRow {
  readonly event_id: string;
  readonly session_id: string;
  readonly request_id: string;
  readonly kind: string;
  readonly timestamp: string;
  readonly event_sequence: number;
  readonly step: number | null;
  readonly detail_id: string | null;
  readonly event_json: string;
}

const port = parentPort;
if (!port) throw new Error("SQLite event writer worker requires parentPort.");

const options = readWorkerOptions(workerData);
const kernel = new AgentSqliteDatabaseKernel({
  databasePath: options.databasePath,
  contract: AgentSessionDatabaseContract,
});
const db = kernel.connection;
const appendRunEvent = db.prepare(`
  INSERT INTO run_events
    (session_id, request_id, kind, timestamp, event_sequence, step, detail_id, event_id, reliability, event_json)
  VALUES (@session_id, @request_id, @kind, @timestamp, @event_sequence, @step, @detail_id, @event_id, @reliability, @event_json)
  ON CONFLICT(event_id) DO NOTHING
`);
const appendOutboxEvent = db.prepare(`
  INSERT INTO event_outbox
    (event_id, session_id, request_id, kind, timestamp, event_sequence, step, detail_id, event_json, state, created_at)
  VALUES (@event_id, @session_id, @request_id, @kind, @timestamp, @event_sequence, @step, @detail_id, @event_json, 'pending', @created_at)
  ON CONFLICT(event_id) DO NOTHING
`);
const selectPendingOutbox = db.prepare<[], OutboxRow>(`
  SELECT event_id, session_id, request_id, kind, timestamp, event_sequence, step, detail_id, event_json
  FROM event_outbox
  WHERE state = 'pending'
  ORDER BY created_at ASC, event_sequence ASC, event_id ASC
  LIMIT ${options.drainBatchSize}
`);
const markOutboxCommitted = db.prepare(`
  UPDATE event_outbox
  SET state = 'committed', committed_at = @committed_at, attempts = attempts + 1,
      next_attempt_at = NULL, last_error = NULL
  WHERE event_id = @event_id AND state = 'pending'
`);
const markOutboxFailed = db.prepare(`
  UPDATE event_outbox
  SET state = 'failed', attempts = attempts + 1, last_error = @last_error, next_attempt_at = NULL
  WHERE event_id = @event_id AND state = 'pending'
`);
const markOutboxRetry = db.prepare(`
  UPDATE event_outbox
  SET attempts = attempts + 1, last_error = @last_error
  WHERE event_id = @event_id AND state = 'pending'
`);
const deleteCommittedOutbox = db.prepare(`
  DELETE FROM event_outbox
  WHERE state = 'committed' AND committed_at IS NOT NULL AND committed_at < @before
`);
const appendBatch = db.transaction((events: readonly AgentEventEnvelope[]) => {
  const createdAt = new Date().toISOString();
  for (const event of events) {
    if (!event.sessionId || !event.requestId) continue;
    const eventId = resolveEventId(event);
    const eventJson = JSON.stringify({ ...event, eventId });
    appendOutboxEvent.run({
      event_id: eventId,
      session_id: event.sessionId,
      request_id: event.requestId,
      kind: event.kind,
      timestamp: event.timestamp,
      event_sequence: event.sequence,
      step: event.step ?? null,
      detail_id: event.detailId ?? null,
      event_json: eventJson,
      created_at: createdAt,
    });
  }
});
const drainOutboxBatch = db.transaction((): { count: number; watermarks: Record<string, number> } => {
  const rows = selectPendingOutbox.all();
  const committedAt = new Date().toISOString();
  const watermarks: Record<string, number> = {};
  for (const row of rows) {
    appendRunEvent.run({
      session_id: row.session_id,
      request_id: row.request_id,
      kind: row.kind,
      timestamp: row.timestamp,
      event_sequence: row.event_sequence,
      step: row.step,
      detail_id: row.detail_id,
      event_id: row.event_id,
      reliability: "durable",
      event_json: row.event_json,
    });
    markOutboxCommitted.run({ event_id: row.event_id, committed_at: committedAt });
    watermarks[row.session_id] = Math.max(watermarks[row.session_id] ?? 0, row.event_sequence);
  }
  return { count: rows.length, watermarks };
});

function drainOutbox(): Record<string, number> {
  const watermarks: Record<string, number> = {};
  for (;;) {
    const batch = drainOutboxBatch();
    for (const [sessionId, sequence] of Object.entries(batch.watermarks)) {
      watermarks[sessionId] = Math.max(watermarks[sessionId] ?? 0, sequence);
    }
    if (batch.count < options.drainBatchSize) break;
    // Each batch commits independently so recovery remains bounded without weakening flush semantics.
  }
  deleteCommittedOutbox.run({ before: new Date(Date.now() - options.committedRetentionMs).toISOString() });
  return watermarks;
}

let closed = false;
let startupError: { name: string; message: string; code?: string; retryable: boolean } | undefined;
try {
  drainOutbox();
} catch (error) {
  startupError = { ...serializeError(error), retryable: isRetryableSqliteError(error) };
}
port.postMessage({ type: "ready", error: startupError });

port.on("message", (message: WriterMessage) => {
  if (closed) return;
  try {
    switch (message.type) {
      case "append":
        appendBatch(message.events);
        port.postMessage({ type: "ack", requestId: message.requestId, committedEventWatermarks: drainOutbox() });
        return;
      case "flush":
        drainOutbox();
        port.postMessage({
          type: "ack",
          requestId: message.requestId,
          committedEventWatermarks: readCommittedWatermarks(),
        });
        return;
      case "shutdown":
        closed = true;
        kernel.close();
        port.postMessage({ type: "closed", requestId: message.requestId });
        port.close();
        return;
    }
  } catch (error) {
    const retryable = isRetryableSqliteError(error);
    if (message.type === "append") {
      const serialized = serializeError(error);
      for (const event of message.events) {
        const eventId = resolveEventId(event);
        try {
          if (retryable) markOutboxRetry.run({ event_id: eventId, last_error: serialized.message });
          else markOutboxFailed.run({ event_id: eventId, last_error: serialized.message });
        } catch {
          // The same database lock may also prevent the diagnostic state update.
          // The caller keeps the event in its durable retry backlog.
        }
      }
    }
    port.postMessage({
      type: "nack",
      requestId: message.requestId,
      retryable,
      error: serializeError(error),
    });
  }
});

function readWorkerOptions(value: unknown): {
  databasePath: string;
  drainBatchSize: number;
  committedRetentionMs: number;
} {
  if (!value || typeof value !== "object") {
    throw new Error("SQLite event writer worker requires options.");
  }
  const options = value as { databasePath?: unknown; drainBatchSize?: unknown; committedRetentionMs?: unknown };
  const databasePath = options.databasePath;
  if (typeof databasePath !== "string" || databasePath.trim().length === 0) {
    throw new Error("SQLite event writer worker databasePath must be a non-empty string.");
  }
  if (!Number.isSafeInteger(options.drainBatchSize) || Number(options.drainBatchSize) <= 0) {
    throw new Error("SQLite event writer worker drainBatchSize must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(options.committedRetentionMs) || Number(options.committedRetentionMs) <= 0) {
    throw new Error("SQLite event writer worker committedRetentionMs must be a positive safe integer.");
  }
  return {
    databasePath,
    drainBatchSize: Number(options.drainBatchSize),
    committedRetentionMs: Number(options.committedRetentionMs),
  };
}

function readCommittedWatermarks(): Record<string, number> {
  const rows = db
    .prepare<[], { session_id: string; event_sequence: number }>(
      "SELECT session_id, MAX(event_sequence) AS event_sequence FROM run_events GROUP BY session_id",
    )
    .all();
  return Object.fromEntries(rows.map((row) => [row.session_id, row.event_sequence]));
}

function resolveEventId(event: AgentEventEnvelope): string {
  if (event.eventId && event.eventId.trim().length > 0) return event.eventId;
  return `legacy:${event.sessionId ?? "global"}:${event.requestId ?? "unknown"}:${event.sequence}`;
}

function isRetryableSqliteError(error: unknown): boolean {
  const code = error instanceof Database.SqliteError ? error.code : (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && ["SQLITE_BUSY", "SQLITE_LOCKED", "SQLITE_IOERR"].includes(code);
}

function serializeError(error: unknown): { name: string; message: string; code?: string } {
  if (error instanceof Database.SqliteError) {
    return { name: error.name, message: error.message, code: error.code };
  }
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: "Error", message: String(error) };
}
