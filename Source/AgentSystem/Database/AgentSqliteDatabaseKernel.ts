import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { AgentSqliteMigration } from "./AgentSqliteMigration.js";
import { runAgentSqliteMigrations } from "./AgentSqliteMigrationRunner.js";

export const AgentSqliteJournalModes = {
  Wal: "WAL",
  Delete: "DELETE",
} as const;

export const AgentSqliteSynchronousModes = {
  Full: "FULL",
  Normal: "NORMAL",
} as const;

export interface AgentSqliteDatabaseProfile {
  readonly busyTimeoutMs: number;
  readonly journalMode: (typeof AgentSqliteJournalModes)[keyof typeof AgentSqliteJournalModes];
  readonly synchronous: (typeof AgentSqliteSynchronousModes)[keyof typeof AgentSqliteSynchronousModes];
  readonly checkpointOnClose: boolean;
}

export const DefaultAgentSqliteDatabaseProfile: AgentSqliteDatabaseProfile = Object.freeze({
  busyTimeoutMs: 5_000,
  journalMode: AgentSqliteJournalModes.Wal,
  synchronous: AgentSqliteSynchronousModes.Normal,
  checkpointOnClose: true,
});

export interface AgentSqliteDatabaseOptions {
  readonly databasePath: string;
  readonly migrations?: readonly AgentSqliteMigration[];
  readonly profile?: AgentSqliteDatabaseProfile;
}

export interface AgentSqliteDatabaseHealth {
  readonly integrity: "ok";
  readonly foreignKeyViolations: readonly AgentSqliteForeignKeyViolation[];
}

export interface AgentSqliteForeignKeyViolation {
  readonly table: string;
  readonly rowid: number | null;
  readonly parent: string;
  readonly fkid: number;
}

export class AgentSqliteDatabaseKernel {
  readonly databasePath: string;
  readonly connection: Database.Database;
  private readonly checkpointOnClose: boolean;
  private closed = false;

  constructor(options: AgentSqliteDatabaseOptions) {
    const profile = options.profile ?? DefaultAgentSqliteDatabaseProfile;
    this.databasePath = path.resolve(options.databasePath);
    this.checkpointOnClose = profile.checkpointOnClose;
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.connection = new Database(this.databasePath);
    try {
      configureConnection(this.connection, profile);
      if (options.migrations) runAgentSqliteMigrations(this.connection, options.migrations);
    } catch (error) {
      this.connection.close();
      this.closed = true;
      throw error;
    }
  }

  inspectHealth(): AgentSqliteDatabaseHealth {
    this.assertOpen();
    const integrity = this.connection.pragma("quick_check", { simple: true });
    if (integrity !== "ok") {
      throw new Error(`SQLite integrity check failed for ${this.databasePath}: ${String(integrity)}`);
    }
    const foreignKeyViolations = this.connection.pragma("foreign_key_check") as AgentSqliteForeignKeyViolation[];
    return { integrity, foreignKeyViolations };
  }

  checkpoint(): void {
    this.assertOpen();
    this.connection.pragma("wal_checkpoint(TRUNCATE)");
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.checkpointOnClose) this.connection.pragma("wal_checkpoint(TRUNCATE)");
    } finally {
      this.connection.close();
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error(`SQLite database is closed: ${this.databasePath}`);
  }
}

function configureConnection(database: Database.Database, profile: AgentSqliteDatabaseProfile): void {
  if (!Number.isSafeInteger(profile.busyTimeoutMs) || profile.busyTimeoutMs < 0) {
    throw new RangeError("SQLite busyTimeoutMs must be a non-negative safe integer.");
  }
  if (!Object.values(AgentSqliteJournalModes).includes(profile.journalMode)) {
    throw new RangeError(`Unsupported SQLite journal mode: ${String(profile.journalMode)}`);
  }
  if (!Object.values(AgentSqliteSynchronousModes).includes(profile.synchronous)) {
    throw new RangeError(`Unsupported SQLite synchronous mode: ${String(profile.synchronous)}`);
  }
  if (typeof profile.checkpointOnClose !== "boolean") {
    throw new TypeError("SQLite checkpointOnClose must be boolean.");
  }
  database.pragma(`busy_timeout = ${profile.busyTimeoutMs}`);
  database.pragma(`journal_mode = ${profile.journalMode}`);
  database.pragma(`synchronous = ${profile.synchronous}`);
  database.pragma("foreign_keys = ON");
}
