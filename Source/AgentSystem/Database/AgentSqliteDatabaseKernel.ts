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
import { errorMessage } from "../Core/AgentErrors.js";
import { nodeErrorCode } from "../Core/AgentFs.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";

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

export interface AgentSqliteDatabaseRecovery {
  readonly storeId: string;
  readonly databasePath: string;
  readonly backupPath: string;
  readonly reason: string;
}

interface OpenedAgentSqliteDatabase {
  readonly connection: Database.Database;
  readonly recovery?: AgentSqliteDatabaseRecovery;
}

export class AgentSqliteDatabaseKernel {
  readonly databasePath: string;
  readonly connection: Database.Database;
  readonly recovery?: AgentSqliteDatabaseRecovery;
  private readonly checkpointOnClose: boolean;
  private closed = false;

  constructor(options: AgentSqliteDatabaseOptions) {
    const profile = options.profile ?? DefaultAgentSqliteDatabaseProfile;
    this.databasePath = path.resolve(options.databasePath);
    this.checkpointOnClose = profile.checkpointOnClose;
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    const opened = openDatabase(this.databasePath, profile, options.contract, options.upgradeSession);
    this.connection = opened.connection;
    this.recovery = opened.recovery;
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
): OpenedAgentSqliteDatabase {
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
): OpenedAgentSqliteDatabase {
  let database: Database.Database | undefined;
  let plan: AgentSqliteStoreReconciliation;
  try {
    database = new Database(databasePath);
    configureConnection(database, profile);
    assertDatabaseIntegrity(database, contract.id);
    plan = reconcileStore(database, contract);
  } catch (error) {
    if (!isRecoverablePreflightError(error)) {
      database?.close();
      throw error;
    }
    const upgradeRecoveryPrepared = prepareUpgradeReinitializationAndClose(
      upgradeSession,
      database,
      databasePath,
      contract,
      error,
    );
    const recovered = recoverStoreDatabase(databasePath, profile, contract, error);
    if (upgradeRecoveryPrepared) upgradeSession?.markSqliteMigrationApplied(contract.id);
    return recovered;
  }

  try {
    if (upgradeSession) {
      upgradeSession.migrateSqlite({ database, databasePath, contract, plan });
    } else {
      migrateAgentSqliteStore(database, contract);
    }
    return { connection: database };
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
): OpenedAgentSqliteDatabase {
  let database: Database.Database | undefined;
  let plan: AgentSqliteStoreReconciliation;
  try {
    database = new Database(databasePath);
    configureConnection(database, profile);
    assertDatabaseIntegrity(database, contract.id);
    plan = reconcileStore(database, contract);
  } catch (error) {
    if (!isRecoverablePreflightError(error)) {
      database?.close();
      throw error;
    }
    const upgradeRecoveryPrepared = prepareUpgradeReinitializationAndClose(
      upgradeSession,
      database,
      databasePath,
      contract,
      error,
    );
    const recovered = recoverStoreDatabase(databasePath, profile, contract, error);
    if (upgradeRecoveryPrepared) upgradeSession?.markSqliteMigrationApplied(contract.id);
    return recovered;
  }

  try {
    if (plan.kind === "current") return { connection: database };
    if (plan.kind === "initialize") {
      migrateAgentSqliteStore(database, contract);
      return { connection: database };
    }
    if (plan.kind === "rebuild" && upgradeSession) {
      upgradeSession.prepareDerivedSqliteRebuild({ database, databasePath, contract, plan });
    }
  } catch (error) {
    database.close();
    throw error;
  }
  database.close();

  if (plan.kind !== "rebuild") {
    throw new Error(`SQLite store ${contract.id} reached an unsupported rebuild plan: ${plan.kind}.`);
  }
  const replacement = replaceAndOpenStoreWithRecovery(
    databasePath,
    profile,
    contract,
    `SQLite store ${contract.id} was rebuilt to match its current contract.`,
  );
  upgradeSession?.markSqliteMigrationApplied(contract.id);
  return replacement;
}

function recoverStoreDatabase(
  databasePath: string,
  profile: AgentSqliteDatabaseProfile,
  contract: AgentSqliteStoreContract,
  cause: unknown,
): OpenedAgentSqliteDatabase {
  return replaceAndOpenStoreWithRecovery(databasePath, profile, contract, errorMessage(cause), cause);
}

function replaceAndOpenStoreWithRecovery(
  databasePath: string,
  profile: AgentSqliteDatabaseProfile,
  contract: AgentSqliteStoreContract,
  reason: string,
  warningCause?: unknown,
): OpenedAgentSqliteDatabase {
  const backupPath = recoveryBackupPath(databasePath, contract.id);
  replaceStoreDatabase(databasePath, profile, contract, { preservePreviousAt: backupPath });
  let connection: Database.Database;
  try {
    connection = openRebuiltStoreDatabase(databasePath, profile, contract);
  } catch (error) {
    try {
      restoreStoreDatabaseFromBackup(databasePath, backupPath);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        `SQLite store ${contract.id} could not be opened or restored from its recovery backup.`,
        { cause: restoreError },
      );
    }
    throw new Error(errorMessage(error), { cause: error });
  }
  const recovery = {
    storeId: contract.id,
    databasePath,
    backupPath,
    reason,
  } satisfies AgentSqliteDatabaseRecovery;
  process.emitWarning(`SQLite store ${contract.id} was reinitialized; the original database is at ${backupPath}.`, {
    code: "SENERA_SQLITE_STORE_RECOVERED",
    detail: warningCause ? errorMessage(warningCause) : recovery.reason,
  });
  return { connection, recovery };
}

function isRecoverablePreflightError(error: unknown): boolean {
  if (error instanceof AgentSqliteMigrationError || error instanceof AgentSqliteDatabaseIntegrityError) return true;
  const code = nodeErrorCode(error);
  return code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB";
}

function prepareUpgradeReinitialization(
  upgradeSession: AgentUpgradeSession | undefined,
  database: Database.Database | undefined,
  databasePath: string,
  contract: AgentSqliteStoreContract,
  cause: unknown,
): boolean {
  if (!upgradeSession || !database || isDatabaseIntegrityFailure(cause)) return false;
  upgradeSession.prepareSqliteReinitialize({ database, databasePath, contract });
  return true;
}

function prepareUpgradeReinitializationAndClose(
  upgradeSession: AgentUpgradeSession | undefined,
  database: Database.Database | undefined,
  databasePath: string,
  contract: AgentSqliteStoreContract,
  cause: unknown,
): boolean {
  try {
    return prepareUpgradeReinitialization(upgradeSession, database, databasePath, contract, cause);
  } finally {
    database?.close();
  }
}

function isDatabaseIntegrityFailure(error: unknown): boolean {
  if (error instanceof AgentSqliteDatabaseIntegrityError) return true;
  const code = nodeErrorCode(error);
  return code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB";
}

function recoveryBackupPath(databasePath: string, storeId: string): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/gu, "");
  return `${databasePath}.${storeId}.${timestamp}.${randomUUID()}.recovery`;
}

function reconcileStore(
  database: Database.Database,
  contract: AgentSqliteStoreContract,
): AgentSqliteStoreReconciliation {
  try {
    return planAgentSqliteStoreReconciliation(database, contract);
  } catch (error) {
    if (error instanceof AgentSqliteMigrationError) throw error;
    throw new AgentSqliteMigrationError(
      AgentSqliteMigrationErrorCodes.SchemaMismatch,
      `SQLite store ${contract.id} could not be reconciled: ${errorMessage(error)}`,
    );
  }
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
    if (reconcileStore(replacement, contract).kind !== "current") {
      throw new Error(`SQLite store ${contract.id} was not rebuilt to its current contract.`);
    }
    return replacement;
  } catch (error) {
    replacement.close();
    throw error;
  }
}

function restoreStoreDatabaseFromBackup(databasePath: string, backupPath: string): void {
  removeDatabaseFiles(databasePath);
  const sourceFiles = databaseFilePaths(backupPath);
  const targetFiles = databaseFilePaths(databasePath);
  for (const [index, sourcePath] of sourceFiles.entries()) {
    const targetPath = targetFiles[index];
    if (!targetPath) continue;
    if (fs.existsSync(sourcePath)) fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  }
}

function replaceStoreDatabase(
  databasePath: string,
  profile: AgentSqliteDatabaseProfile,
  contract: AgentSqliteStoreContract,
  options: { preservePreviousAt?: string } = {},
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

  const previousPath = options.preservePreviousAt ?? `${databasePath}.${randomUUID()}.replaced`;
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
    if (committed && !options.preservePreviousAt) {
      removeDatabaseFiles(previousPath);
    } else if (!committed) {
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

class AgentSqliteDatabaseIntegrityError extends AgentBaseError {
  constructor(message: string) {
    super(message);
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
