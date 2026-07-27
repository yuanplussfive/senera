import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  AgentSqliteMigrationError,
  AgentSqliteMigrationErrorCodes,
  migrateAgentSqliteStore,
  planAgentSqliteStoreReconciliation,
  type AgentSqliteStoreReconciliation,
} from "./AgentSqliteMigrationRunner.js";
import { AgentSqliteStoreDataClasses, type AgentSqliteStoreContract } from "./AgentSqliteStoreContract.js";
import type { AgentUpgradeSession } from "../Upgrade/AgentUpgradeSession.js";

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
  readonly contract: AgentSqliteStoreContract;
  readonly profile?: AgentSqliteDatabaseProfile;
  readonly upgradeSession?: AgentUpgradeSession;
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
    this.connection = openDatabase(this.databasePath, profile, options.contract, options.upgradeSession);
  }

  inspectHealth(): AgentSqliteDatabaseHealth {
    this.assertOpen();
    const integrity = this.connection.pragma("quick_check", { simple: true });
    if (integrity !== "ok") {
      throw new Error(`SQLite integrity check failed for ${this.databasePath}: ${String(integrity)}`);
    }
    const foreignKeyViolations = this.connection.pragma("foreign_key_check") as AgentSqliteForeignKeyViolation[];
    return { integrity: "ok", foreignKeyViolations };
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

function openDatabase(
  databasePath: string,
  profile: AgentSqliteDatabaseProfile,
  contract: AgentSqliteStoreContract,
  upgradeSession?: AgentUpgradeSession,
): Database.Database {
  if (contract.dataClass === AgentSqliteStoreDataClasses.Authoritative) {
    return openAuthoritativeDatabase(databasePath, profile, contract, upgradeSession);
  }
  if (contract.dataClass === AgentSqliteStoreDataClasses.Derived) {
    return openDerivedDatabase(databasePath, profile, contract, upgradeSession);
  }
  throw new TypeError("Unsupported SQLite store data class.");
}

function openAuthoritativeDatabase(
  databasePath: string,
  profile: AgentSqliteDatabaseProfile,
  contract: AgentSqliteStoreContract,
  upgradeSession?: AgentUpgradeSession,
): Database.Database {
  const database = new Database(databasePath);
  try {
    configureConnection(database, profile);
    assertDatabaseIntegrity(database, contract.id);
    const plan = planAgentSqliteStoreReconciliation(database, contract);
    if (upgradeSession) {
      upgradeSession.migrateSqlite({ database, databasePath, contract, plan });
    } else {
      migrateAgentSqliteStore(database, contract);
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function openDerivedDatabase(
  databasePath: string,
  profile: AgentSqliteDatabaseProfile,
  contract: AgentSqliteStoreContract,
  upgradeSession?: AgentUpgradeSession,
): Database.Database {
  const database = new Database(databasePath);
  try {
    configureConnection(database, profile);
    assertDatabaseIntegrity(database, contract.id);
    const plan = planDerivedStoreReconciliation(database, contract);
    if (plan.kind === "current") return database;
    if (plan.kind === "initialize") {
      migrateAgentSqliteStore(database, contract);
      return database;
    }
    if (plan.kind === "rebuild" && upgradeSession) {
      upgradeSession.prepareDerivedSqliteRebuild({ database, databasePath, contract, plan });
    }
  } catch (error) {
    database.close();
    throw error;
  }
  database.close();

  replaceStoreDatabase(databasePath, profile, contract);
  const replacement = openRebuiltStoreDatabase(databasePath, profile, contract);
  upgradeSession?.markSqliteMigrationApplied(contract.id);
  return replacement;
}

function planDerivedStoreReconciliation(
  database: Database.Database,
  contract: AgentSqliteStoreContract,
): AgentSqliteStoreReconciliation {
  try {
    return planAgentSqliteStoreReconciliation(database, contract);
  } catch (error) {
    if (!(error instanceof AgentSqliteMigrationError) || !isDerivedRebuildableError(error.code)) {
      throw error;
    }
    return { kind: "rebuild" };
  }
}

function isDerivedRebuildableError(code: AgentSqliteMigrationError["code"]): boolean {
  return (
    code === AgentSqliteMigrationErrorCodes.InvalidHistory ||
    code === AgentSqliteMigrationErrorCodes.SchemaMismatch ||
    code === AgentSqliteMigrationErrorCodes.UntrackedDatabase
  );
}

function openRebuiltStoreDatabase(
  databasePath: string,
  profile: AgentSqliteDatabaseProfile,
  contract: AgentSqliteStoreContract,
): Database.Database {
  const replacement = new Database(databasePath);
  try {
    configureConnection(replacement, profile);
    assertDatabaseIntegrity(replacement, contract.id);
    if (planAgentSqliteStoreReconciliation(replacement, contract).kind !== "current") {
      throw new Error(`Derived SQLite store ${contract.id} was not rebuilt to its current contract.`);
    }
    return replacement;
  } catch (error) {
    replacement.close();
    throw error;
  }
}

function replaceStoreDatabase(
  databasePath: string,
  profile: AgentSqliteDatabaseProfile,
  contract: AgentSqliteStoreContract,
): void {
  const stagingPath = `${databasePath}.${randomUUID()}.next`;
  const staging = new Database(stagingPath);
  try {
    configureConnection(staging, profile);
    migrateAgentSqliteStore(staging, contract);
    assertDatabaseIntegrity(staging, contract.id);
  } finally {
    staging.close();
  }

  const previousPath = `${databasePath}.${randomUUID()}.replaced`;
  const movedFiles: string[] = [];
  let committed = false;
  try {
    for (const filePath of databaseFilePaths(databasePath)) {
      if (!fs.existsSync(filePath)) continue;
      const movedPath = filePath.replace(databasePath, previousPath);
      fs.renameSync(filePath, movedPath);
      movedFiles.push(movedPath);
    }
    fs.renameSync(stagingPath, databasePath);
    committed = true;
  } finally {
    if (committed) {
      removeDatabaseFiles(previousPath);
    } else {
      removeDatabaseFiles(stagingPath);
      for (const movedPath of movedFiles.reverse()) {
        const originalPath = movedPath.replace(previousPath, databasePath);
        fs.renameSync(movedPath, originalPath);
      }
      removeDatabaseFiles(previousPath);
    }
  }
}

function removeDatabaseFiles(databasePath: string): void {
  for (const filePath of databaseFilePaths(databasePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

function databaseFilePaths(databasePath: string): string[] {
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
}

function assertDatabaseIntegrity(database: Database.Database, storeId: string): void {
  const integrity = database.pragma("quick_check", { simple: true });
  if (integrity !== "ok") {
    throw new AgentSqliteDatabaseIntegrityError(
      `SQLite store ${storeId} integrity check failed: ${String(integrity)}.`,
    );
  }
}

class AgentSqliteDatabaseIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentSqliteDatabaseIntegrityError";
  }
}

function configureConnection(database: Database.Database, profile: AgentSqliteDatabaseProfile): void {
  if (!Number.isSafeInteger(profile.busyTimeoutMs) || profile.busyTimeoutMs < 0) {
    throw new RangeError("SQLite busyTimeoutMs must be a non-negative safe integer.");
  }
  if (!Object.values(AgentSqliteJournalModes).includes(profile.journalMode)) {
    throw new RangeError(`Unsupported SQLite journal mode: ${String(profile.journalMode)}.`);
  }
  if (!Object.values(AgentSqliteSynchronousModes).includes(profile.synchronous)) {
    throw new RangeError(`Unsupported SQLite synchronous mode: ${String(profile.synchronous)}.`);
  }
  if (typeof profile.checkpointOnClose !== "boolean") {
    throw new TypeError("SQLite checkpointOnClose must be boolean.");
  }
  database.pragma(`busy_timeout = ${profile.busyTimeoutMs}`);
  database.pragma(`journal_mode = ${profile.journalMode}`);
  database.pragma(`synchronous = ${profile.synchronous}`);
  database.pragma("foreign_keys = ON");
}
