import type Database from "better-sqlite3";
import type { AgentSqliteMigration, AgentSqliteMigrationContext } from "./AgentSqliteMigration.js";

const MigrationTableName = "schema_migrations";

interface AppliedMigrationRow {
  version: number;
  name: string;
  checksum: string;
}

export const AgentSqliteMigrationErrorCodes = {
  InvalidPlan: "invalid_plan",
  InvalidHistory: "invalid_history",
  Drift: "migration_drift",
  UnknownAppliedMigration: "unknown_applied_migration",
} as const;

export type AgentSqliteMigrationErrorCode =
  (typeof AgentSqliteMigrationErrorCodes)[keyof typeof AgentSqliteMigrationErrorCodes];

export class AgentSqliteMigrationError extends Error {
  constructor(
    readonly code: AgentSqliteMigrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentSqliteMigrationError";
  }
}

export function runAgentSqliteMigrations(
  database: Database.Database,
  migrations: readonly AgentSqliteMigration[],
  appliedAt = (): string => new Date().toISOString(),
): void {
  const ordered = validateMigrationPlan(migrations);
  const migrate = database.transaction(() => {
    installMigrationLedger(database);
    const applied = readAppliedMigrations(database);
    assertMigrationHistory(ordered, applied);
    const appliedVersions = new Set(applied.map(({ version }) => version));
    const context: AgentSqliteMigrationContext = {
      database,
      execute: (sql) => database.exec(sql),
    };
    const recordMigration = database.prepare(`
      INSERT INTO ${MigrationTableName} (version, name, checksum, applied_at)
      VALUES (@version, @name, @checksum, @appliedAt)
    `);

    for (const migration of ordered) {
      if (appliedVersions.has(migration.version)) continue;
      migration.up(context);
      recordMigration.run({
        version: migration.version,
        name: migration.name,
        checksum: migration.checksum,
        appliedAt: appliedAt(),
      });
    }
  });

  migrate.immediate();
}

function validateMigrationPlan(migrations: readonly AgentSqliteMigration[]): readonly AgentSqliteMigration[] {
  const ordered = [...migrations].sort((left, right) => left.version - right.version);
  for (const [index, migration] of ordered.entries()) {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new AgentSqliteMigrationError(
        AgentSqliteMigrationErrorCodes.InvalidPlan,
        `SQLite migrations must be contiguous from version 1; expected ${expectedVersion}, received ${migration.version}.`,
      );
    }
    if (migration.name.trim().length === 0 || migration.checksum.trim().length === 0) {
      throw new AgentSqliteMigrationError(
        AgentSqliteMigrationErrorCodes.InvalidPlan,
        `SQLite migration ${migration.version} must have a name and checksum.`,
      );
    }
  }
  return ordered;
}

function installMigrationLedger(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${MigrationTableName} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
}

function readAppliedMigrations(database: Database.Database): AppliedMigrationRow[] {
  return database
    .prepare<[], AppliedMigrationRow>(
      `
      SELECT version, name, checksum
      FROM ${MigrationTableName}
      ORDER BY version ASC
    `,
    )
    .all();
}

function assertMigrationHistory(
  migrations: readonly AgentSqliteMigration[],
  applied: readonly AppliedMigrationRow[],
): void {
  for (const [index, row] of applied.entries()) {
    const expectedVersion = index + 1;
    if (row.version !== expectedVersion) {
      throw new AgentSqliteMigrationError(
        AgentSqliteMigrationErrorCodes.InvalidHistory,
        `SQLite migration history is not contiguous; expected version ${expectedVersion}, received ${row.version}.`,
      );
    }
  }
  const plannedByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  for (const row of applied) {
    const planned = plannedByVersion.get(row.version);
    if (!planned) {
      throw new AgentSqliteMigrationError(
        AgentSqliteMigrationErrorCodes.UnknownAppliedMigration,
        `Database contains unknown migration version ${row.version} (${row.name}).`,
      );
    }
    if (planned.name !== row.name || planned.checksum !== row.checksum) {
      throw new AgentSqliteMigrationError(
        AgentSqliteMigrationErrorCodes.Drift,
        `SQLite migration ${row.version} no longer matches the applied migration ${row.name}.`,
      );
    }
  }
}
