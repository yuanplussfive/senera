import type Database from "better-sqlite3";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../Memory/AgentMemorySqlSchema.js";
import type { AgentUpgradeSession } from "../Upgrade/AgentUpgradeSession.js";
import { AgentMemoryRecallEntrySchema } from "./AgentMemoryRecallContract.js";

/**
 * Immutable automatic-memory snapshots kept beside MemOS. Semantic knowledge
 * and its graph, validity, and embeddings belong to MemOS.
 */
export class AgentContinuitySqliteStore {
  private readonly kernel: AgentSqliteDatabaseKernel;
  private readonly ownsKernel: boolean;
  private readonly db: Database.Database;

  constructor(database: string | AgentSqliteDatabaseKernel, upgradeSession?: AgentUpgradeSession) {
    this.ownsKernel = typeof database === "string";
    this.kernel =
      typeof database === "string"
        ? new AgentSqliteDatabaseKernel({
            databasePath: database,
            contract: AgentMemoryDatabaseContract,
            upgradeSession,
          })
        : database;
    this.db = this.kernel.connection;
  }

  readMemorySnapshot(sessionId: string, subjectId?: string): AgentContinuityMemorySnapshot | undefined {
    const row = this.db
      .prepare<[string, string | null, string | null], { entries_json: string; diary_index: string }>(
        `SELECT v.entries_json,v.diary_index FROM continuity_memory_snapshot_versions v
         JOIN continuity_memory_boundaries b USING(session_id,generation) WHERE v.session_id = ? AND (? IS NULL OR b.subject_id=?)`,
      )
      .get(sessionId, subjectId ?? null, subjectId ?? null);
    return row
      ? { entries: MemorySnapshotEntriesSchema.parse(JSON.parse(row.entries_json)), diaryIndex: row.diary_index }
      : undefined;
  }

  createMemorySnapshot(
    sessionId: string,
    snapshot: AgentContinuityMemorySnapshot,
    now: string,
  ): AgentContinuityMemorySnapshot {
    const normalized = {
      entries: MemorySnapshotEntriesSchema.parse(snapshot.entries),
      diaryIndex: z.string().parse(snapshot.diaryIndex),
    };
    this.db
      .prepare(
        "INSERT INTO continuity_memory_boundaries(session_id,generation,boundary_key) VALUES(?,0,'initial') ON CONFLICT DO NOTHING",
      )
      .run(sessionId);
    this.db
      .prepare(
        `INSERT INTO continuity_memory_snapshot_versions(session_id,generation,entries_json,diary_index,created_at)
         SELECT session_id,generation,?,?,? FROM continuity_memory_boundaries WHERE session_id=?
         ON CONFLICT(session_id,generation) DO NOTHING`,
      )
      .run(JSON.stringify(normalized.entries), normalized.diaryIndex, now, sessionId);
    return this.readMemorySnapshot(sessionId) ?? normalized;
  }

  clearMemorySnapshot(sessionId: string, boundaryKey: string = randomUUID()): number {
    return this.db
      .prepare(
        `INSERT INTO continuity_memory_boundaries(session_id,generation,boundary_key) VALUES(?,1,?)
      ON CONFLICT(session_id) DO UPDATE SET generation=generation+1,boundary_key=excluded.boundary_key
      WHERE boundary_key<>excluded.boundary_key`,
      )
      .run(sessionId, boundaryKey).changes;
  }

  snapshotGeneration(sessionId: string): number {
    return (
      this.db
        .prepare<[string], { generation: number }>(
          "SELECT generation FROM continuity_memory_boundaries WHERE session_id=?",
        )
        .get(sessionId)?.generation ?? 0
    );
  }

  prepareSnapshotSubject(sessionId: string, subjectId: string): void {
    this.db
      .prepare(
        `INSERT INTO continuity_memory_boundaries(session_id,generation,boundary_key,subject_id) VALUES(?,0,'initial',?)
      ON CONFLICT(session_id) DO UPDATE SET generation=generation+1,subject_id=excluded.subject_id,boundary_key='subject:' || excluded.subject_id
      WHERE subject_id<>excluded.subject_id`,
      )
      .run(sessionId, subjectId);
  }

  clearAllMemorySnapshots(): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM continuity_memory_snapshot_versions").run();
      this.db.prepare("UPDATE continuity_memory_boundaries SET generation=generation+1").run();
    })();
  }

  deleteSession(sessionId: string): void {
    this.db.prepare("DELETE FROM continuity_memory_snapshot_versions WHERE session_id=?").run(sessionId);
    this.db.prepare("DELETE FROM continuity_memory_boundaries WHERE session_id=?").run(sessionId);
  }

  close(): void {
    if (this.ownsKernel) this.kernel.close();
  }
}

export type AgentContinuityMemorySnapshotEntry = import("zod").z.infer<typeof MemorySnapshotEntrySchema>;

export interface AgentContinuityMemorySnapshot {
  readonly entries: readonly AgentContinuityMemorySnapshotEntry[];
  readonly diaryIndex: string;
}

const MemorySnapshotEntrySchema = AgentMemoryRecallEntrySchema.omit({ uri: true });

const MemorySnapshotEntriesSchema = z.array(MemorySnapshotEntrySchema).superRefine((entries, context) => {
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Memory snapshot contains duplicate node IDs." });
  }
});
