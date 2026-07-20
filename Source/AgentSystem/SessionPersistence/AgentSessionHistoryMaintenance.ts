import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";
import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import { projectAgentRunEventForHistory } from "../Events/AgentRunEventHistoryPolicy.js";
import { parseStoredRunEvent } from "./AgentSessionJsonCodec.js";

export interface AgentSessionHistoryMaintenanceOptions {
  databasePath: string;
  batchSize?: number;
  maxTransactionBytes?: number;
  dryRun?: boolean;
  vacuum?: boolean;
  signal?: AbortSignal;
  onBatch?: (progress: AgentSessionHistoryMaintenanceProgress) => void | Promise<void>;
}

export interface AgentSessionHistoryMaintenanceProgress {
  batches: number;
  scannedEvents: number;
  rewritableEvents: number;
  reclaimableBytes: number;
}

export interface AgentSessionHistoryMaintenanceResult extends AgentSessionHistoryMaintenanceProgress {
  databasePath: string;
  dryRun: boolean;
  rewrittenEvents: number;
  invalidEvents: number;
  unchangedEvents: number;
  databaseBytesBefore: number;
  databaseBytesAfter: number;
  vacuumed: boolean;
}

interface StoredEventRow {
  id: number;
  event_id: string;
  event_json: string;
}

const DefaultMaintenanceBatchSize = 250;
const DefaultMaxTransactionBytes = 32 * 1024 * 1024;

export class AgentSessionHistoryMaintenance {
  async compact(options: AgentSessionHistoryMaintenanceOptions): Promise<AgentSessionHistoryMaintenanceResult> {
    const databasePath = path.resolve(options.databasePath);
    assertExistingDatabase(databasePath);
    const dryRun = options.dryRun ?? true;
    const vacuum = options.vacuum ?? false;
    if (dryRun && vacuum) {
      throw new Error("VACUUM requires an applied maintenance run.");
    }

    const databaseBytesBefore = fileSize(databasePath);
    const kernel = new AgentSqliteDatabaseKernel({ databasePath });
    const db = kernel.connection;
    try {
      // Maintenance shares the WAL database with the writer worker. Keep lock waits bounded
      // and avoid per-batch TRUNCATE checkpoints that would repeatedly evict the writer.
      db.pragma("busy_timeout = 60000");
      assertRunEventsTable(db);
      const batchSize = positiveInteger(options.batchSize) ?? DefaultMaintenanceBatchSize;
      const maxTransactionBytes = positiveInteger(options.maxTransactionBytes) ?? DefaultMaxTransactionBytes;
      if (!dryRun) db.pragma(`journal_size_limit = ${maxTransactionBytes}`);
      const selectBatch = db.prepare<[string, number, number], StoredEventRow>(`
        SELECT id, event_id, event_json
        FROM run_events
        WHERE kind = ? AND id > ?
        ORDER BY id ASC
        LIMIT ?
      `);
      const updateEvent = db.prepare(`UPDATE run_events SET event_json = ? WHERE id = ?`);
      const progress = createProgress();
      let cursor = 0;
      let pendingUpdates: Array<{ id: number; eventJson: string }> = [];
      let pendingUpdateBytes = 0;
      const flushUpdates = (): void => {
        if (dryRun || pendingUpdates.length === 0) return;
        const updates = pendingUpdates;
        db.exec("BEGIN IMMEDIATE");
        try {
          for (const update of updates) updateEvent.run(update.eventJson, update.id);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        progress.rewrittenEvents += pendingUpdates.length;
        pendingUpdates = [];
        pendingUpdateBytes = 0;
      };

      for (;;) {
        throwIfAborted(options.signal);
        const rows = selectBatch.all(AgentEventKinds.PiTrace, cursor, batchSize);
        if (rows.length === 0) break;

        for (const row of rows) {
          progress.scannedEvents += 1;
          const projected = projectStoredEvent(row.event_json, row.event_id);
          if (!projected) {
            progress.invalidEvents += 1;
            continue;
          }
          const originalBytes = Buffer.byteLength(row.event_json);
          const projectedBytes = Buffer.byteLength(projected);
          if (projectedBytes >= originalBytes) {
            progress.unchangedEvents += 1;
            continue;
          }
          progress.rewritableEvents += 1;
          progress.reclaimableBytes += originalBytes - projectedBytes;
          if (!dryRun) {
            pendingUpdates.push({ id: row.id, eventJson: projected });
            pendingUpdateBytes += originalBytes;
            if (pendingUpdateBytes >= maxTransactionBytes) flushUpdates();
          }
        }

        flushUpdates();
        cursor = rows.at(-1)?.id ?? cursor;
        progress.batches += 1;
        await options.onBatch?.(projectProgress(progress));
      }

      flushUpdates();
      if (!dryRun) db.pragma("wal_checkpoint(PASSIVE)");
      if (vacuum) db.exec("VACUUM");

      return {
        databasePath,
        dryRun,
        ...progress,
        databaseBytesBefore,
        databaseBytesAfter: fileSize(databasePath),
        vacuumed: vacuum,
      };
    } finally {
      kernel.close();
    }
  }
}

interface MutableMaintenanceProgress extends AgentSessionHistoryMaintenanceProgress {
  rewrittenEvents: number;
  invalidEvents: number;
  unchangedEvents: number;
}

function createProgress(): MutableMaintenanceProgress {
  return {
    batches: 0,
    scannedEvents: 0,
    rewritableEvents: 0,
    rewrittenEvents: 0,
    invalidEvents: 0,
    unchangedEvents: 0,
    reclaimableBytes: 0,
  };
}

function projectProgress(progress: MutableMaintenanceProgress): AgentSessionHistoryMaintenanceProgress {
  return {
    batches: progress.batches,
    scannedEvents: progress.scannedEvents,
    rewritableEvents: progress.rewritableEvents,
    reclaimableBytes: progress.reclaimableBytes,
  };
}

function projectStoredEvent(value: string, eventId: string): string | undefined {
  const event = parseStoredRunEvent(value);
  if (!event) return undefined;
  const projected = projectAgentRunEventForHistory(event as AgentEventEnvelope);
  return projected ? JSON.stringify({ ...projected, eventId: projected.eventId ?? eventId }) : undefined;
}

function assertRunEventsTable(db: Database.Database): void {
  const row = db
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'run_events'")
    .get();
  if (!row) throw new Error("The selected database does not contain Senera run history.");
}

function assertExistingDatabase(databasePath: string): void {
  if (!fs.existsSync(databasePath)) throw new Error(`Session database does not exist: ${databasePath}`);
}

function fileSize(filePath: string): number {
  return fs.statSync(filePath).size;
}

function positiveInteger(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
