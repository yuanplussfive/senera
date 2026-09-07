import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  AgentUpgradeParticipantKinds,
  AgentUpgradeParticipantPhases,
  AgentUpgradeStatuses,
  CurrentAgentUpgradeSchemaVersion,
  type AgentUpgradeManifest,
  type AgentUpgradeParticipant,
} from "./AgentUpgradeContract.js";
import { AgentUpgradeJournal, assertInside, resolveInside } from "./AgentUpgradeJournal.js";
import { acquireAgentUpgradeLock } from "./AgentUpgradeLock.js";
import {
  migrateAgentSqliteStore,
  type AgentSqliteStoreReconciliation,
} from "../Database/AgentSqliteMigrationRunner.js";
import type { AgentSqliteStoreContract } from "../Database/AgentSqliteStoreContract.js";
import { errorMessage } from "../Core/AgentErrors.js";

export interface AgentUpgradeSessionOptions {
  readonly workspaceRoot: string;
  readonly stateRoot?: string;
  readonly allowedDataRoots?: readonly string[];
  readonly appVersion: string;
  readonly imageReference?: string;
  readonly now?: () => Date;
  readonly operationId?: () => string;
}

export interface AgentSqliteUpgradeInput {
  readonly database: Database.Database;
  readonly databasePath: string;
  readonly contract: AgentSqliteStoreContract;
  readonly plan: AgentSqliteStoreReconciliation;
}

export type AgentDerivedSqliteUpgradeInput = AgentSqliteUpgradeInput & {
  readonly plan: Extract<AgentSqliteStoreReconciliation, { kind: "rebuild" }>;
};

export type AgentSqliteReinitializeInput = Omit<AgentSqliteUpgradeInput, "plan">;

export interface AgentSqliteDataUpgradeInput {
  readonly id: string;
  readonly database: Database.Database;
  readonly databasePath: string;
  readonly sourceVersion: number;
  readonly targetVersion: number;
  readonly migrate: (database: Database.Database) => void;
}

export class AgentUpgradeSession {
  readonly journal: AgentUpgradeJournal;
  private readonly allowedDataRoots: readonly string[];
  private readonly now: () => Date;
  private readonly operationId: () => string;
  private manifest: AgentUpgradeManifest | undefined;
  private releaseLock: (() => void) | undefined;

  constructor(private readonly options: AgentUpgradeSessionOptions) {
    const workspaceRoot = path.resolve(options.workspaceRoot);
    this.journal = new AgentUpgradeJournal(options.stateRoot ?? path.join(workspaceRoot, ".senera"));
    this.allowedDataRoots = Object.freeze([
      workspaceRoot,
      ...(options.allowedDataRoots ?? []).map((root) => path.resolve(root)),
    ]);
    this.now = options.now ?? (() => new Date());
    this.operationId = options.operationId ?? (() => `${compactTimestamp(this.now())}-${randomUUID()}`);
  }

  recoverInterruptedUpgrade(): AgentUpgradeManifest | undefined {
    const interrupted = this.journal
      .listManifests()
      .filter(({ status }) => status === AgentUpgradeStatuses.InProgress || status === AgentUpgradeStatuses.Failed)
      .at(-1);
    if (!interrupted) return undefined;
    this.ensureLock();
    try {
      this.rollbackManifest(interrupted, "startup.recovery");
      return this.journal.readManifest(interrupted.upgradeId);
    } finally {
      this.unlock();
    }
  }

  migrateSqlite(input: AgentSqliteUpgradeInput): void {
    if (input.contract.dataClass !== "authoritative") {
      migrateAgentSqliteStore(input.database, input.contract);
      return;
    }
    if (input.plan.kind === "current" || input.plan.kind === "initialize") {
      migrateAgentSqliteStore(input.database, input.contract);
      return;
    }

    const sourcePath = this.assertAllowedDataPath(input.databasePath);
    const sourceVersion = readSourceVersion(input.database, input.plan);
    const targetVersion = input.contract.migrations.length;
    const participant = this.backupSqlite(input.database, {
      id: input.contract.id,
      dataClass: input.contract.dataClass,
      sourcePath,
      sourceVersion,
      targetVersion,
    });

    this.dryRunSqlite(participant, input.contract);
    migrateAgentSqliteStore(input.database, input.contract);
    assertSqliteHealth(input.database, input.contract.id);
    this.updateParticipant(participant.id, AgentUpgradeParticipantPhases.Migrated, "migration.applied");
  }

  migrateSqliteData(input: AgentSqliteDataUpgradeInput): void {
    const sourcePath = this.assertAllowedDataPath(input.databasePath);
    const participant = this.backupSqlite(input.database, {
      id: input.id,
      dataClass: "authoritative",
      sourcePath,
      sourceVersion: input.sourceVersion,
      targetVersion: input.targetVersion,
    });

    this.dryRunSqliteData(participant, input);
    input.migrate(input.database);
    assertSqliteHealth(input.database, input.id);
    this.updateParticipant(participant.id, AgentUpgradeParticipantPhases.Migrated, "migration.applied");
  }

  prepareDerivedSqliteRebuild(input: AgentDerivedSqliteUpgradeInput): void {
    this.prepareSqliteReinitialize(input);
  }

  prepareSqliteReinitialize(input: AgentSqliteReinitializeInput): void {
    const sourcePath = this.assertAllowedDataPath(input.databasePath);
    const participant = this.backupSqlite(input.database, {
      id: input.contract.id,
      dataClass: input.contract.dataClass,
      sourcePath,
      targetVersion: input.contract.migrations.length,
    });
    this.dryRunDerivedSqliteRebuild(participant, input.contract);
  }

  markSqliteMigrationApplied(id: string): void {
    this.updateParticipant(id, AgentUpgradeParticipantPhases.Migrated, "migration.applied");
  }

  backupFileMigration(input: { id: string; sourcePath: string; sourceVersion?: number; targetVersion?: number }): void {
    const sourcePath = this.assertAllowedDataPath(input.sourcePath);
    if (!fs.existsSync(sourcePath)) return;
    const manifest = this.ensureManifest();
    if (manifest.participants.some(({ id }) => id === input.id)) return;
    const backupPath = this.backupPath(input.id, path.extname(sourcePath) || ".json");
    fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
    fs.copyFileSync(sourcePath, backupPath, fs.constants.COPYFILE_EXCL);
    const backupSha256 = sha256File(backupPath);
    if (backupSha256 !== sha256File(sourcePath)) {
      throw new Error(`Upgrade backup checksum does not match its source for ${input.id}.`);
    }
    const participant: AgentUpgradeParticipant = {
      id: input.id,
      kind: AgentUpgradeParticipantKinds.File,
      dataClass: "authoritative",
      sourcePath,
      backupPath: path.relative(this.journal.operationRoot(manifest.upgradeId), backupPath),
      backupSha256,
      sourceVersion: input.sourceVersion,
      targetVersion: input.targetVersion,
      phase: AgentUpgradeParticipantPhases.BackedUp,
    };
    manifest.participants.push(participant);
    this.record("backup.created", input.id);
    this.record("backup.validated", input.id);
  }

  markFileMigrationDryRunPassed(id: string): void {
    this.updateParticipant(id, AgentUpgradeParticipantPhases.DryRunPassed, "migration.dry_run_passed");
  }

  markFileMigrationApplied(id: string): void {
    this.updateParticipant(id, AgentUpgradeParticipantPhases.Migrated, "migration.applied");
  }

  markStarting(): void {
    if (this.manifest) this.record("startup.started");
  }

  markHealthy(): void {
    const completedAt = this.timestamp();
    if (this.manifest) {
      this.manifest.status = AgentUpgradeStatuses.Healthy;
      this.manifest.completedAt = completedAt;
      this.record("startup.health_passed");
      this.journal.pruneCompleted(3);
    }
    this.journal.writeRuntimeMarker({
      schemaVersion: CurrentAgentUpgradeSchemaVersion,
      appVersion: this.options.appVersion,
      imageReference: normalizedOptional(this.options.imageReference),
      updatedAt: completedAt,
    });
    this.unlock();
    this.manifest = undefined;
  }

  failAndRollback(error: unknown): void {
    if (!this.manifest) return;
    this.manifest.status = AgentUpgradeStatuses.Failed;
    this.manifest.failure = errorMessage(error);
    this.record("startup.failed", undefined, this.manifest.failure);
    try {
      this.rollbackManifest(this.manifest, "startup.rollback");
    } finally {
      this.unlock();
    }
  }

  rollbackManifest(manifest: AgentUpgradeManifest, event: string): void {
    this.ensureLock();
    const operationRoot = this.journal.operationRoot(manifest.upgradeId);
    for (const participant of [...manifest.participants].reverse()) {
      if (participant.phase === AgentUpgradeParticipantPhases.Restored) continue;
      const sourcePath = this.assertAllowedDataPath(participant.sourcePath);
      const backupPath = resolveInside(operationRoot, participant.backupPath);
      if (sha256File(backupPath) !== participant.backupSha256) {
        throw new Error(`Upgrade backup checksum does not match for ${participant.id}.`);
      }
      restoreFileSnapshot({ operationRoot, participant, sourcePath, backupPath });
      participant.phase = AgentUpgradeParticipantPhases.Restored;
      manifest.events.push({ at: this.timestamp(), phase: event, participantId: participant.id });
      this.journal.writeManifest(manifest);
    }
    manifest.status = AgentUpgradeStatuses.RolledBack;
    manifest.completedAt = this.timestamp();
    manifest.events.push({ at: manifest.completedAt, phase: "rollback.completed" });
    this.journal.writeManifest(manifest);
    if (manifest.source.appVersion) {
      this.journal.writeRuntimeMarker({
        schemaVersion: CurrentAgentUpgradeSchemaVersion,
        appVersion: manifest.source.appVersion,
        imageReference: manifest.source.imageReference,
        updatedAt: manifest.completedAt,
      });
    } else {
      this.journal.clearRuntimeMarker();
    }
    this.manifest = undefined;
  }

  close(): void {
    this.unlock();
  }

  private backupSqlite(
    database: Database.Database,
    input: {
      id: string;
      dataClass: AgentUpgradeParticipant["dataClass"];
      sourcePath: string;
      sourceVersion?: number;
      targetVersion: number;
    },
  ): AgentUpgradeParticipant {
    const manifest = this.ensureManifest();
    const existing = manifest.participants.find(({ id }) => id === input.id);
    if (existing) {
      if (path.resolve(existing.sourcePath) !== input.sourcePath) {
        throw new Error(`Upgrade participant ${input.id} resolved to multiple database paths.`);
      }
      return existing;
    }
    const backupPath = this.backupPath(input.id, ".sqlite");
    fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
    database.prepare("VACUUM INTO ?").run(backupPath);
    const participant: AgentUpgradeParticipant = {
      id: input.id,
      kind: AgentUpgradeParticipantKinds.Sqlite,
      dataClass: input.dataClass,
      sourcePath: input.sourcePath,
      backupPath: path.relative(this.journal.operationRoot(manifest.upgradeId), backupPath),
      backupSha256: sha256File(backupPath),
      sourceVersion: input.sourceVersion,
      targetVersion: input.targetVersion,
      phase: AgentUpgradeParticipantPhases.BackedUp,
    };
    manifest.participants.push(participant);
    this.record("backup.created", input.id);
    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
      assertSqliteHealth(backup, input.id);
    } finally {
      backup.close();
    }
    this.record("backup.validated", input.id);
    return participant;
  }

  private dryRunSqlite(participant: AgentUpgradeParticipant, contract: AgentSqliteStoreContract): void {
    const operationRoot = this.journal.operationRoot(this.requireManifest().upgradeId);
    const backupPath = resolveInside(operationRoot, participant.backupPath);
    const dryRunPath = resolveInside(operationRoot, "dry-run", `${participant.id}.sqlite`);
    fs.mkdirSync(path.dirname(dryRunPath), { recursive: true, mode: 0o700 });
    fs.copyFileSync(backupPath, dryRunPath);
    const dryRun = new Database(dryRunPath, { fileMustExist: true });
    try {
      dryRun.pragma("foreign_keys = ON");
      migrateAgentSqliteStore(dryRun, contract);
      assertSqliteHealth(dryRun, contract.id);
    } finally {
      dryRun.close();
      removeSqliteFiles(dryRunPath);
    }
    this.updateParticipant(participant.id, AgentUpgradeParticipantPhases.DryRunPassed, "migration.dry_run_passed");
  }

  private dryRunDerivedSqliteRebuild(participant: AgentUpgradeParticipant, contract: AgentSqliteStoreContract): void {
    const operationRoot = this.journal.operationRoot(this.requireManifest().upgradeId);
    const dryRunPath = resolveInside(operationRoot, "dry-run", `${participant.id}.sqlite`);
    fs.mkdirSync(path.dirname(dryRunPath), { recursive: true, mode: 0o700 });
    const dryRun = new Database(dryRunPath);
    try {
      dryRun.pragma("foreign_keys = ON");
      migrateAgentSqliteStore(dryRun, contract);
      assertSqliteHealth(dryRun, contract.id);
    } finally {
      dryRun.close();
      removeSqliteFiles(dryRunPath);
    }
    this.updateParticipant(participant.id, AgentUpgradeParticipantPhases.DryRunPassed, "migration.dry_run_passed");
  }

  private dryRunSqliteData(participant: AgentUpgradeParticipant, input: AgentSqliteDataUpgradeInput): void {
    const operationRoot = this.journal.operationRoot(this.requireManifest().upgradeId);
    const backupPath = resolveInside(operationRoot, participant.backupPath);
    const dryRunPath = resolveInside(operationRoot, "dry-run", `${participant.id}.sqlite`);
    fs.mkdirSync(path.dirname(dryRunPath), { recursive: true, mode: 0o700 });
    fs.copyFileSync(backupPath, dryRunPath);
    const dryRun = new Database(dryRunPath, { fileMustExist: true });
    try {
      dryRun.pragma("foreign_keys = ON");
      input.migrate(dryRun);
      assertSqliteHealth(dryRun, input.id);
    } finally {
      dryRun.close();
      removeSqliteFiles(dryRunPath);
    }
    this.updateParticipant(participant.id, AgentUpgradeParticipantPhases.DryRunPassed, "migration.dry_run_passed");
  }

  private ensureManifest(): AgentUpgradeManifest {
    if (this.manifest) return this.manifest;
    this.ensureLock();
    const source = this.journal.readRuntimeMarker();
    const startedAt = this.timestamp();
    this.manifest = {
      schemaVersion: CurrentAgentUpgradeSchemaVersion,
      upgradeId: this.operationId(),
      status: AgentUpgradeStatuses.InProgress,
      source: source ? { appVersion: source.appVersion, imageReference: source.imageReference } : {},
      target: {
        appVersion: this.options.appVersion,
        imageReference: normalizedOptional(this.options.imageReference),
      },
      startedAt,
      participants: [],
      events: [{ at: startedAt, phase: "upgrade.started" }],
    };
    this.journal.writeManifest(this.manifest);
    return this.manifest;
  }

  private ensureLock(): void {
    this.releaseLock ??= acquireAgentUpgradeLock(this.journal.root, this.now);
  }

  private unlock(): void {
    this.releaseLock?.();
    this.releaseLock = undefined;
  }

  private updateParticipant(id: string, phase: AgentUpgradeParticipant["phase"], event: string): void {
    const participant = this.requireManifest().participants.find((candidate) => candidate.id === id);
    if (!participant) throw new Error(`Upgrade participant is not registered: ${id}`);
    participant.phase = phase;
    this.record(event, id);
  }

  private record(phase: string, participantId?: string, detail?: string): void {
    const manifest = this.requireManifest();
    manifest.events.push({ at: this.timestamp(), phase, participantId, detail });
    this.journal.writeManifest(manifest);
  }

  private backupPath(id: string, extension: string): string {
    if (!/^[a-z][a-z0-9-]*$/u.test(id)) throw new Error(`Invalid upgrade participant id: ${id}`);
    return resolveInside(this.journal.operationRoot(this.requireManifest().upgradeId), "backups", `${id}${extension}`);
  }

  private assertAllowedDataPath(value: string): string {
    const candidate = path.resolve(value);
    if (!this.allowedDataRoots.some((root) => isInside(root, candidate))) {
      throw new Error(`Upgrade data path is outside the declared data roots: ${candidate}`);
    }
    return candidate;
  }

  private requireManifest(): AgentUpgradeManifest {
    if (!this.manifest) throw new Error("Upgrade manifest has not been initialized.");
    return this.manifest;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

export function rollbackAgentUpgrade(options: {
  workspaceRoot: string;
  stateRoot?: string;
  allowedDataRoots?: readonly string[];
  upgradeId?: string;
}): AgentUpgradeManifest {
  const session = new AgentUpgradeSession({
    workspaceRoot: options.workspaceRoot,
    stateRoot: options.stateRoot,
    allowedDataRoots: options.allowedDataRoots,
    appVersion: "rollback-cli",
  });
  const manifest = options.upgradeId
    ? session.journal.readManifest(options.upgradeId)
    : session.journal
        .listManifests()
        .filter(({ status }) => status === AgentUpgradeStatuses.Healthy)
        .at(-1);
  if (!manifest) throw new Error("No completed Senera upgrade is available to roll back.");
  if (manifest.status !== AgentUpgradeStatuses.Healthy) {
    throw new Error(`Senera upgrade ${manifest.upgradeId} is ${manifest.status} and cannot be rolled back manually.`);
  }
  try {
    session.rollbackManifest(manifest, "cli.rollback");
  } finally {
    session.close();
  }
  return session.journal.readManifest(manifest.upgradeId);
}

function restoreFileSnapshot(input: {
  operationRoot: string;
  participant: AgentUpgradeParticipant;
  sourcePath: string;
  backupPath: string;
}): void {
  const failedRoot = resolveInside(
    input.operationRoot,
    "failed-state",
    input.participant.id,
    `${Date.now()}-${randomUUID()}`,
  );
  fs.mkdirSync(failedRoot, { recursive: true, mode: 0o700 });
  const currentFiles =
    input.participant.kind === AgentUpgradeParticipantKinds.Sqlite
      ? [input.sourcePath, `${input.sourcePath}-wal`, `${input.sourcePath}-shm`]
      : [input.sourcePath];
  for (const currentPath of currentFiles) {
    if (!fs.existsSync(currentPath)) continue;
    moveFilePreservingSource(currentPath, resolveInside(failedRoot, path.basename(currentPath)));
  }
  fs.mkdirSync(path.dirname(input.sourcePath), { recursive: true });
  const stagingPath = `${input.sourcePath}.${randomUUID()}.restore`;
  try {
    fs.copyFileSync(input.backupPath, stagingPath, fs.constants.COPYFILE_EXCL);
    fs.renameSync(stagingPath, input.sourcePath);
  } finally {
    fs.rmSync(stagingPath, { force: true });
  }
}

function moveFilePreservingSource(sourcePath: string, targetPath: string): void {
  try {
    fs.renameSync(sourcePath, targetPath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EXDEV")) throw error;
    fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
    fs.rmSync(sourcePath);
  }
}

function readSourceVersion(database: Database.Database, plan: AgentSqliteStoreReconciliation): number {
  if (plan.kind === "adopt") return plan.version;
  const row = database
    .prepare<[], { version: number | null }>("SELECT MAX(version) AS version FROM __senera_schema_migrations")
    .get();
  return row?.version ?? 0;
}

function assertSqliteHealth(database: Database.Database, id: string): void {
  const integrity = database.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") throw new Error(`SQLite backup integrity check failed for ${id}: ${String(integrity)}.`);
  const violations = database.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) throw new Error(`SQLite foreign key check failed for ${id}.`);
}

function removeSqliteFiles(databasePath: string): void {
  for (const filePath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    fs.rmSync(filePath, { force: true });
  }
}

function sha256File(filePath: string): string {
  const hash = createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function compactTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
}

function normalizedOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isInside(root: string, candidate: string): boolean {
  try {
    assertInside(root, candidate, "Upgrade data path");
    return true;
  } catch {
    return false;
  }
}
