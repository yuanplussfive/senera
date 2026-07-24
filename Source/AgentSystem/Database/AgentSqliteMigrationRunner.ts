import type Database from "better-sqlite3";
import {
  AgentSqliteContractMetadataTable,
  AgentSqliteMigrationLedgerTable,
  isAgentSqliteSchemaEmpty,
  snapshotAgentSqliteSchema,
} from "./AgentSqliteDatabaseSchema.js";
import {
  AgentSqliteStoreDataClasses,
  type AgentSqliteStoreContract,
  type AgentSqliteStoreDataClass,
  type AgentSqliteStoreMigration,
} from "./AgentSqliteStoreContract.js";

interface StoreIdentityRow {
  readonly store_id: string;
  readonly data_class: AgentSqliteStoreDataClass;
}

interface AppliedMigrationRow {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

export const AgentSqliteMigrationErrorCodes = {
  ContractIdentityMismatch: "contract_identity_mismatch",
  InvalidHistory: "invalid_history",
  SchemaMismatch: "schema_mismatch",
  UntrackedDatabase: "untracked_database",
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

export type AgentSqliteStoreReconciliation =
  | { readonly kind: "current" }
  | { readonly kind: "initialize" }
  | { readonly kind: "adopt"; readonly version: number }
  | { readonly kind: "migrate" }
  | { readonly kind: "rebuild" };

export function planAgentSqliteStoreReconciliation(
  database: Database.Database,
  contract: AgentSqliteStoreContract,
): AgentSqliteStoreReconciliation {
  const hasIdentity = hasTable(database, AgentSqliteContractMetadataTable);
  const hasLedger = hasTable(database, AgentSqliteMigrationLedgerTable);
  const schema = snapshotAgentSqliteSchema(database);

  if (hasIdentity) {
    if (!hasLedger) {
      throw migrationError(
        AgentSqliteMigrationErrorCodes.InvalidHistory,
        `SQLite store ${contract.id} has contract metadata without its migration ledger.`,
      );
    }
    assertStoreIdentity(database, contract);
    const applied = readAppliedMigrations(database);
    assertAppliedMigrationHistory(contract, applied);
    const appliedVersion = applied.at(-1)?.version ?? 0;
    if (appliedVersion === 0) {
      if (!isAgentSqliteSchemaEmpty(database)) {
        throw migrationError(
          AgentSqliteMigrationErrorCodes.SchemaMismatch,
          `SQLite store ${contract.id} has an empty migration ledger but a non-empty schema.`,
        );
      }
      return contract.dataClass === AgentSqliteStoreDataClasses.Derived ? { kind: "rebuild" } : { kind: "migrate" };
    }
    const expected = migrationAt(contract, appliedVersion).snapshot;
    if (schema !== expected) {
      throw migrationError(
        AgentSqliteMigrationErrorCodes.SchemaMismatch,
        `SQLite store ${contract.id} schema does not match recorded migration ${appliedVersion}.`,
      );
    }
    if (appliedVersion === contract.migrations.length) {
      return { kind: "current" };
    }
    return contract.dataClass === AgentSqliteStoreDataClasses.Derived ? { kind: "rebuild" } : { kind: "migrate" };
  }

  if (hasLedger) {
    throw migrationError(
      AgentSqliteMigrationErrorCodes.InvalidHistory,
      `SQLite store ${contract.id} has a migration ledger without contract metadata.`,
    );
  }
  if (isAgentSqliteSchemaEmpty(database)) {
    return { kind: "initialize" };
  }

  const matchingMigration = contract.migrations.find((migration) => migration.snapshot === schema);
  if (matchingMigration) {
    return contract.dataClass === AgentSqliteStoreDataClasses.Derived
      ? { kind: "rebuild" }
      : { kind: "adopt", version: matchingMigration.version };
  }
  if (contract.legacySnapshots.some((snapshot) => snapshot.snapshot === schema)) {
    return contract.dataClass === AgentSqliteStoreDataClasses.Derived
      ? { kind: "rebuild" }
      : { kind: "adopt", version: 0 };
  }
  throw migrationError(
    AgentSqliteMigrationErrorCodes.UntrackedDatabase,
    `SQLite database does not match a declared ${contract.id} schema snapshot.`,
  );
}

export function migrateAgentSqliteStore(
  database: Database.Database,
  contract: AgentSqliteStoreContract,
  appliedAt = (): string => new Date().toISOString(),
): void {
  const migrate = database.transaction(() => {
    const plan = planAgentSqliteStoreReconciliation(database, contract);
    if (plan.kind === "current") return;
    if (plan.kind === "rebuild") {
      throw new Error(`Derived SQLite store ${contract.id} must be rebuilt before it can be migrated.`);
    }
    if (plan.kind === "initialize" || plan.kind === "adopt") {
      installStoreControlTables(database, contract);
      if (plan.kind === "adopt") {
        recordAdoptedMigrations(database, contract, plan.version, appliedAt);
      }
    }
    const applied = readAppliedMigrations(database);
    assertAppliedMigrationHistory(contract, applied);
    const appliedVersions = new Set(applied.map(({ version }) => version));
    const recordMigration = database.prepare(`
      INSERT INTO ${AgentSqliteMigrationLedgerTable} (version, name, checksum, applied_at)
      VALUES (@version, @name, @checksum, @appliedAt)
    `);
    for (const migration of contract.migrations) {
      if (appliedVersions.has(migration.version)) continue;
      database.exec(migration.sql);
      recordMigration.run({
        version: migration.version,
        name: migration.name,
        checksum: migration.checksum,
        appliedAt: appliedAt(),
      });
    }
    const finalSnapshot = snapshotAgentSqliteSchema(database);
    const expectedSnapshot = contract.migrations.at(-1)?.snapshot;
    if (finalSnapshot !== expectedSnapshot) {
      throw migrationError(
        AgentSqliteMigrationErrorCodes.SchemaMismatch,
        `SQLite store ${contract.id} did not reach its declared current schema.`,
      );
    }
  });
  migrate.immediate();
}

function installStoreControlTables(database: Database.Database, contract: AgentSqliteStoreContract): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${AgentSqliteContractMetadataTable} (
      store_id TEXT PRIMARY KEY,
      data_class TEXT NOT NULL CHECK(data_class IN ('authoritative', 'derived'))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS ${AgentSqliteMigrationLedgerTable} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  database
    .prepare(`INSERT INTO ${AgentSqliteContractMetadataTable} (store_id, data_class) VALUES (?, ?)`)
    .run(contract.id, contract.dataClass);
}

function recordAdoptedMigrations(
  database: Database.Database,
  contract: AgentSqliteStoreContract,
  version: number,
  appliedAt: () => string,
): void {
  const record = database.prepare(`
    INSERT INTO ${AgentSqliteMigrationLedgerTable} (version, name, checksum, applied_at)
    VALUES (?, ?, ?, ?)
  `);
  for (const migration of contract.migrations) {
    if (migration.version > version) break;
    record.run(migration.version, migration.name, migration.checksum, appliedAt());
  }
}

function assertStoreIdentity(database: Database.Database, contract: AgentSqliteStoreContract): void {
  const identities = database
    .prepare<[], StoreIdentityRow>(
      `
      SELECT store_id, data_class
      FROM ${AgentSqliteContractMetadataTable}
      ORDER BY store_id
    `,
    )
    .all();
  if (identities.length !== 1) {
    throw migrationError(
      AgentSqliteMigrationErrorCodes.InvalidHistory,
      `SQLite store ${contract.id} must contain exactly one contract metadata row.`,
    );
  }
  const identity = identities[0];
  if (identity.store_id !== contract.id || identity.data_class !== contract.dataClass) {
    throw migrationError(
      AgentSqliteMigrationErrorCodes.ContractIdentityMismatch,
      `SQLite database belongs to ${identity.store_id} (${identity.data_class}), not ${contract.id} (${contract.dataClass}).`,
    );
  }
}

function readAppliedMigrations(database: Database.Database): AppliedMigrationRow[] {
  return database
    .prepare<[], AppliedMigrationRow>(
      `
      SELECT version, name, checksum
      FROM ${AgentSqliteMigrationLedgerTable}
      ORDER BY version ASC
    `,
    )
    .all();
}

function assertAppliedMigrationHistory(
  contract: AgentSqliteStoreContract,
  applied: readonly AppliedMigrationRow[],
): void {
  for (const [index, row] of applied.entries()) {
    const expectedVersion = index + 1;
    if (row.version !== expectedVersion) {
      throw migrationError(
        AgentSqliteMigrationErrorCodes.InvalidHistory,
        `SQLite store ${contract.id} migration history is not contiguous at version ${row.version}.`,
      );
    }
    const migration = migrationAt(contract, row.version);
    if (migration.name !== row.name || migration.checksum !== row.checksum) {
      throw migrationError(
        AgentSqliteMigrationErrorCodes.InvalidHistory,
        `SQLite store ${contract.id} migration ${row.version} no longer matches its immutable contract resource.`,
      );
    }
  }
}

function migrationAt(contract: AgentSqliteStoreContract, version: number): AgentSqliteStoreMigration {
  const migration = contract.migrations[version - 1];
  if (!migration || migration.version !== version) {
    throw migrationError(
      AgentSqliteMigrationErrorCodes.InvalidHistory,
      `SQLite store ${contract.id} references unknown migration ${version}.`,
    );
  }
  return migration;
}

function hasTable(database: Database.Database, tableName: string): boolean {
  return Boolean(
    database
      .prepare<[string], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  );
}

function migrationError(code: AgentSqliteMigrationErrorCode, message: string): AgentSqliteMigrationError {
  return new AgentSqliteMigrationError(code, message);
}
