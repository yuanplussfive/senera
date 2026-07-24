import { createHash } from "node:crypto";

export const AgentSqliteStoreDataClasses = {
  Authoritative: "authoritative",
  Derived: "derived",
} as const;

export type AgentSqliteStoreDataClass = (typeof AgentSqliteStoreDataClasses)[keyof typeof AgentSqliteStoreDataClasses];

export interface AgentSqliteStoreMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
  readonly snapshot: string;
  readonly snapshotChecksum: string;
}

export interface AgentSqliteStoreLegacySnapshot {
  readonly id: string;
  readonly snapshot: string;
  readonly checksum: string;
}

export interface AgentSqliteStoreContract {
  readonly id: string;
  readonly dataClass: AgentSqliteStoreDataClass;
  readonly migrations: readonly AgentSqliteStoreMigration[];
  readonly legacySnapshots: readonly AgentSqliteStoreLegacySnapshot[];
}

interface RawAgentSqliteStoreManifest {
  readonly formatVersion?: unknown;
  readonly id?: unknown;
  readonly dataClass?: unknown;
  readonly versions?: unknown;
  readonly legacySnapshots?: unknown;
}

interface RawAgentSqliteStoreVersion {
  readonly version?: unknown;
  readonly name?: unknown;
  readonly sql?: unknown;
  readonly checksum?: unknown;
  readonly snapshot?: unknown;
  readonly snapshotChecksum?: unknown;
}

interface RawAgentSqliteStoreLegacySnapshot {
  readonly id?: unknown;
  readonly snapshot?: unknown;
  readonly checksum?: unknown;
}

/**
 * Validates a generated, domain-local SQLite runtime contract. The build-time
 * generator remains responsible for reading the authoritative SQL resources.
 */
export function loadAgentSqliteStoreContract(value: unknown): AgentSqliteStoreContract {
  if (!isRecord(value)) throw new TypeError("SQLite store runtime contract must be an object.");
  const manifest = value as RawAgentSqliteStoreManifest;
  assertKnownKeys(
    manifest,
    ["formatVersion", "id", "dataClass", "versions", "legacySnapshots"],
    "SQLite store contract",
  );
  if (manifest.formatVersion !== 1) {
    throw new Error("SQLite store runtime contract formatVersion must be 1.");
  }
  const id = readStoreId(manifest.id, "SQLite store contract");
  const context = `SQLite store contract ${id}`;
  const dataClass = readDataClass(manifest.dataClass, context);
  const rawVersions = readArray<RawAgentSqliteStoreVersion>(manifest.versions, "versions", context);
  const migrations = rawVersions.map((version, index) => readMigration(version, index + 1, context));
  const rawLegacySnapshots =
    manifest.legacySnapshots === undefined
      ? []
      : readArray<RawAgentSqliteStoreLegacySnapshot>(manifest.legacySnapshots, "legacySnapshots", context, true);
  const legacySnapshots = rawLegacySnapshots.map((snapshot) => readLegacySnapshot(snapshot, context));

  assertUnique(
    legacySnapshots.map(({ id: legacyId }) => legacyId),
    "legacy snapshot id",
    context,
  );
  const snapshotChecksums = new Set(migrations.map(({ snapshotChecksum }) => snapshotChecksum));
  for (const legacy of legacySnapshots) {
    if (snapshotChecksums.has(legacy.checksum)) {
      throw new Error(`${context} declares a legacy snapshot that duplicates a versioned snapshot.`);
    }
  }

  return Object.freeze({
    id,
    dataClass,
    migrations: Object.freeze(migrations),
    legacySnapshots: Object.freeze(legacySnapshots),
  });
}

export function sha256AgentSqliteResource(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function readMigration(
  raw: RawAgentSqliteStoreVersion,
  expectedVersion: number,
  context: string,
): AgentSqliteStoreMigration {
  assertKnownKeys(raw, ["version", "name", "sql", "checksum", "snapshot", "snapshotChecksum"], context);
  const version = readPositiveInteger(raw.version, "version", context);
  if (version !== expectedVersion) {
    throw new Error(`${context} versions must be contiguous from 1; expected ${expectedVersion}, received ${version}.`);
  }
  const name = readNonEmptyString(raw.name, "version name", context);
  const sql = readNonEmptyString(raw.sql, "sql", context);
  const snapshot = readNonEmptyString(raw.snapshot, "snapshot", context);
  const checksum = readChecksum(raw.checksum, "checksum", context);
  const snapshotChecksum = readChecksum(raw.snapshotChecksum, "snapshotChecksum", context);
  assertChecksum(sql, checksum, `${context} migration ${version}`);
  assertChecksum(snapshot, snapshotChecksum, `${context} snapshot ${version}`);
  return Object.freeze({ version, name, sql, checksum, snapshot, snapshotChecksum });
}

function readLegacySnapshot(raw: RawAgentSqliteStoreLegacySnapshot, context: string): AgentSqliteStoreLegacySnapshot {
  assertKnownKeys(raw, ["id", "snapshot", "checksum"], context);
  const id = readStoreId(raw.id, context);
  const snapshot = readNonEmptyString(raw.snapshot, "legacy snapshot", context);
  const checksum = readChecksum(raw.checksum, "legacy checksum", context);
  assertChecksum(snapshot, checksum, `${context} legacy snapshot ${id}`);
  return Object.freeze({ id, snapshot, checksum });
}

function readDataClass(value: unknown, manifestPath: string): AgentSqliteStoreDataClass {
  if (value === AgentSqliteStoreDataClasses.Authoritative || value === AgentSqliteStoreDataClasses.Derived) {
    return value;
  }
  throw new Error(`${manifestPath} dataClass must be authoritative or derived.`);
}

function readStoreId(value: unknown, context: string): string {
  const id = readNonEmptyString(value, "id", context);
  if (!/^[a-z][a-z0-9-]*$/u.test(id)) {
    throw new Error(`${context} id must be lowercase kebab-case.`);
  }
  return id;
}

function readPositiveInteger(value: unknown, field: string, context: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${context} ${field} must be a positive safe integer.`);
  }
  return value as number;
}

function readNonEmptyString(value: unknown, field: string, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} ${field} must be a non-empty string.`);
  }
  return value;
}

function readChecksum(value: unknown, field: string, context: string): string {
  const checksum = readNonEmptyString(value, field, context);
  if (!/^[a-f0-9]{64}$/u.test(checksum)) {
    throw new Error(`${context} ${field} must be a lowercase SHA-256 checksum.`);
  }
  return checksum;
}

function readArray<T>(value: unknown, field: string, context: string, allowEmpty = false): T[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((entry) => !isRecord(entry))) {
    throw new Error(`${context} ${field} must be ${allowEmpty ? "an" : "a non-empty"} array of objects.`);
  }
  return value as T[];
}

function assertChecksum(content: string, expected: string, filePath: string): void {
  const actual = sha256AgentSqliteResource(content);
  if (actual !== expected) {
    throw new Error(
      `SQLite contract resource checksum mismatch: ${filePath}. Run npm run generate.database-contracts.`,
    );
  }
}

function assertUnique(values: readonly string[], label: string, context: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${context} contains duplicate ${label} entries.`);
  }
}

function assertKnownKeys(value: object, keys: readonly string[], context: string): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${context} contains unsupported contract keys: ${unknown.join(", ")}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
