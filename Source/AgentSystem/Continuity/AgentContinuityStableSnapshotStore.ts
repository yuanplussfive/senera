import type Database from "better-sqlite3";
import { z } from "zod";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../Memory/AgentMemorySqlSchema.js";
import {
  AgentResidentProfileMaturities,
  AgentResidentProfileSubjects,
  type AgentResidentProfilePromptEntry,
} from "../Profile/AgentResidentProfileTypes.js";

export interface AgentContinuityStablePromptSnapshot {
  readonly sessionId: string;
  readonly revision: string;
  readonly residentProfile: readonly AgentResidentProfilePromptEntry[];
  readonly createdAt: string;
}

export interface AgentContinuityStablePromptSnapshotInput {
  readonly sessionId: string;
  readonly revision: string;
  readonly residentProfile: readonly AgentResidentProfilePromptEntry[];
  readonly createdAt?: string;
}

interface StablePromptSnapshotRow {
  session_id: string;
  revision: string;
  resident_profile_json: string;
  created_at: string;
}

/** Persists the stable memory view for one conversation. */
export class AgentContinuityStableSnapshotStore {
  private readonly kernel: AgentSqliteDatabaseKernel;
  private readonly ownsKernel: boolean;
  private readonly db: Database.Database;

  constructor(database: string | AgentSqliteDatabaseKernel) {
    this.ownsKernel = typeof database === "string";
    this.kernel =
      typeof database === "string"
        ? new AgentSqliteDatabaseKernel({
            databasePath: database,
            contract: AgentMemoryDatabaseContract,
          })
        : database;
    this.db = this.kernel.connection;
  }

  read(sessionId: string): AgentContinuityStablePromptSnapshot | undefined {
    const normalizedSessionId = requireSessionId(sessionId);
    const row = this.db
      .prepare<[string], StablePromptSnapshotRow>(
        `SELECT session_id, revision, resident_profile_json, created_at
         FROM continuity_stable_prompt_snapshots
         WHERE session_id = ?`,
      )
      .get(normalizedSessionId);
    return row ? snapshotFromRow(row) : undefined;
  }

  save(input: AgentContinuityStablePromptSnapshotInput): AgentContinuityStablePromptSnapshot {
    const sessionId = requireSessionId(input.sessionId);
    const revision = requireRevision(input.revision);
    const createdAt = input.createdAt?.trim() || new Date().toISOString();
    const snapshot = {
      sessionId,
      revision,
      residentProfile: [...input.residentProfile],
      createdAt,
    } satisfies AgentContinuityStablePromptSnapshot;
    this.db
      .prepare(
        `INSERT INTO continuity_stable_prompt_snapshots (
          session_id, revision, resident_profile_json, created_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          revision = excluded.revision,
          resident_profile_json = excluded.resident_profile_json`,
      )
      .run(snapshot.sessionId, snapshot.revision, JSON.stringify(snapshot.residentProfile), snapshot.createdAt);
    const persisted = this.read(sessionId);
    if (!persisted) throw new Error(`Stable continuity snapshot was not persisted for session ${sessionId}.`);
    return persisted;
  }

  deleteSession(sessionId: string): void {
    this.db
      .prepare("DELETE FROM continuity_stable_prompt_snapshots WHERE session_id = ?")
      .run(requireSessionId(sessionId));
  }

  close(): void {
    if (this.ownsKernel) this.kernel.close();
  }
}

function snapshotFromRow(row: StablePromptSnapshotRow): AgentContinuityStablePromptSnapshot {
  return {
    sessionId: row.session_id,
    revision: row.revision,
    residentProfile: parseArray(row.resident_profile_json, "resident profile", ResidentProfilePromptEntrySchema),
    createdAt: row.created_at,
  };
}

const ResidentProfilePromptEntrySchema: z.ZodType<AgentResidentProfilePromptEntry> = z
  .object({
    subject: z.enum(AgentResidentProfileSubjects),
    key: z.string(),
    valueJson: z.string(),
    claim: z.string(),
    validUntil: z.string(),
    sourceRefs: z.array(z.string()),
    maturity: z.enum(AgentResidentProfileMaturities).optional(),
    supportCount: z.number().int().nonnegative().optional(),
  })
  .strict();

function parseArray<T>(value: string, label: string, schema: z.ZodType<T>): readonly T[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Stable continuity ${label} is not valid JSON.`, { cause: error });
  }
  const result = z.array(schema).safeParse(parsed);
  if (!result.success) {
    throw new Error(`Stable continuity ${label} has an invalid shape.`, { cause: result.error });
  }
  return result.data;
}

function requireSessionId(value: string): string {
  const sessionId = value.trim();
  if (!sessionId) throw new Error("Stable continuity snapshot requires a session id.");
  return sessionId;
}

function requireRevision(value: string): string {
  const revision = value.trim();
  if (!revision) throw new Error("Stable continuity snapshot requires a revision.");
  return revision;
}
