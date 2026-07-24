import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { snapshotAgentSqliteSchema } from "../Source/AgentSystem/Database/AgentSqliteDatabaseSchema.js";

interface ContractManifest {
  id?: unknown;
  dataClass?: unknown;
  versions?: unknown;
  legacySnapshots?: unknown;
}

interface ContractVersion {
  version?: unknown;
  name?: unknown;
  migration?: unknown;
  migrationSha256?: unknown;
  snapshot?: unknown;
  snapshotSha256?: unknown;
}

interface LegacySnapshot {
  id?: unknown;
  definition?: unknown;
  definitionSha256?: unknown;
  snapshot?: unknown;
  snapshotSha256?: unknown;
}

const check = process.argv.includes("--check");
const sourceRoot = path.join(process.cwd(), "Source", "AgentSystem");
const RuntimeContractFileName = "runtime.json";
const failures: string[] = [];

for (const manifestPath of discoverContractManifests(sourceRoot)) {
  try {
    synchronizeContract(manifestPath, check);
  } catch (error) {
    failures.push(`${relativePath(manifestPath)}: ${errorMessage(error)}`);
  }
}

if (failures.length > 0) {
  throw new Error(
    [
      `SQLite database contract ${check ? "verification" : "generation"} failed.`,
      ...failures.map((failure) => `- ${failure}`),
    ].join("\n"),
  );
}

console.log(`SQLite database contracts ${check ? "verified" : "generated"}.`);

function synchronizeContract(manifestPath: string, verifyOnly: boolean): void {
  const directory = path.dirname(manifestPath);
  const manifest = parseManifest(manifestPath);
  const versions = readVersions(manifest, manifestPath);
  const legacySnapshots = readLegacySnapshots(manifest, manifestPath);
  const database = new Database(":memory:");
  try {
    for (const [index, version] of versions.entries()) {
      const expectedVersion = index + 1;
      if (version.version !== expectedVersion) {
        throw new Error(
          `versions must be contiguous from 1; expected ${expectedVersion}, received ${String(version.version)}.`,
        );
      }
      const migrationPath = resolveResource(directory, version.migration, "migration");
      const snapshotPath = resolveResource(directory, version.snapshot, "snapshot");
      const migration = fs.readFileSync(migrationPath, "utf8");
      database.exec(migration);
      const snapshot = snapshotAgentSqliteSchema(database);
      synchronizeTextFile(snapshotPath, snapshot, verifyOnly);
      version.migrationSha256 = sha256(migration);
      version.snapshotSha256 = sha256(snapshot);
    }

    for (const legacy of legacySnapshots) {
      synchronizeLegacySnapshot(directory, legacy, verifyOnly);
    }
  } finally {
    database.close();
  }

  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  synchronizeTextFile(manifestPath, serialized, verifyOnly);
  const runtimeContract = buildRuntimeContract(directory, manifest, versions, legacySnapshots);
  synchronizeTextFile(
    path.join(directory, RuntimeContractFileName),
    `${JSON.stringify(runtimeContract, null, 2)}\n`,
    verifyOnly,
  );
}

function buildRuntimeContract(
  directory: string,
  manifest: ContractManifest,
  versions: readonly ContractVersion[],
  legacySnapshots: readonly LegacySnapshot[],
): object {
  const runtimeVersions = versions.map((version, index) => {
    const number = index + 1;
    const migrationPath = resolveResource(directory, version.migration, `version ${number} migration`);
    const snapshotPath = resolveResource(directory, version.snapshot, `version ${number} snapshot`);
    return {
      version: number,
      name: readNonEmptyString(version.name, `version ${number} name`),
      sql: fs.readFileSync(migrationPath, "utf8"),
      checksum: readNonEmptyString(version.migrationSha256, `version ${number} migrationSha256`),
      snapshot: fs.readFileSync(snapshotPath, "utf8"),
      snapshotChecksum: readNonEmptyString(version.snapshotSha256, `version ${number} snapshotSha256`),
    };
  });
  const runtimeLegacySnapshots = legacySnapshots.map((legacy) => {
    const id = readNonEmptyString(legacy.id, "legacy snapshot id");
    const snapshotPath = resolveResource(directory, legacy.snapshot, `legacy snapshot ${id}`);
    return {
      id,
      snapshot: fs.readFileSync(snapshotPath, "utf8"),
      checksum: readNonEmptyString(legacy.snapshotSha256, `legacy snapshot ${id} snapshotSha256`),
    };
  });
  return {
    formatVersion: 1,
    id: readNonEmptyString(manifest.id, "id"),
    dataClass: readNonEmptyString(manifest.dataClass, "dataClass"),
    versions: runtimeVersions,
    ...(runtimeLegacySnapshots.length > 0 ? { legacySnapshots: runtimeLegacySnapshots } : {}),
  };
}

function synchronizeLegacySnapshot(directory: string, legacy: LegacySnapshot, verifyOnly: boolean): void {
  const id = readNonEmptyString(legacy.id, "legacy snapshot id");
  const definitionPath = resolveResource(directory, legacy.definition, `legacy snapshot ${id} definition`);
  const snapshotPath = resolveResource(directory, legacy.snapshot, `legacy snapshot ${id} snapshot`);
  const database = new Database(":memory:");
  try {
    const definition = fs.readFileSync(definitionPath, "utf8");
    database.exec(definition);
    const snapshot = snapshotAgentSqliteSchema(database);
    synchronizeTextFile(snapshotPath, snapshot, verifyOnly);
    legacy.definitionSha256 = sha256(definition);
    legacy.snapshotSha256 = sha256(snapshot);
  } finally {
    database.close();
  }
}

function parseManifest(manifestPath: string): ContractManifest {
  const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!isRecord(parsed)) throw new Error("contract root must be an object.");
  readNonEmptyString(parsed.id, "id");
  if (parsed.dataClass !== "authoritative" && parsed.dataClass !== "derived") {
    throw new Error("dataClass must be authoritative or derived.");
  }
  return parsed as ContractManifest;
}

function readVersions(manifest: ContractManifest, manifestPath: string): ContractVersion[] {
  if (
    !Array.isArray(manifest.versions) ||
    manifest.versions.length === 0 ||
    manifest.versions.some((entry) => !isRecord(entry))
  ) {
    throw new Error(`${relativePath(manifestPath)} versions must be a non-empty object array.`);
  }
  return manifest.versions as ContractVersion[];
}

function readLegacySnapshots(manifest: ContractManifest, manifestPath: string): LegacySnapshot[] {
  if (manifest.legacySnapshots === undefined) return [];
  if (!Array.isArray(manifest.legacySnapshots) || manifest.legacySnapshots.some((entry) => !isRecord(entry))) {
    throw new Error(`${relativePath(manifestPath)} legacySnapshots must be an object array.`);
  }
  return manifest.legacySnapshots as LegacySnapshot[];
}

function resolveResource(directory: string, value: unknown, label: string): string {
  const relative = readNonEmptyString(value, label);
  if (path.isAbsolute(relative)) throw new Error(`${label} must be relative.`);
  const resolved = path.resolve(directory, relative);
  const inside = path.relative(directory, resolved);
  if (inside === "" || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) {
    throw new Error(`${label} escapes its contract directory.`);
  }
  return resolved;
}

function synchronizeTextFile(filePath: string, expected: string, verifyOnly: boolean): void {
  const actual = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : undefined;
  if (actual === expected) return;
  if (verifyOnly) {
    throw new Error(`${relativePath(filePath)} is stale. Run npm run generate.database-contracts.`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, expected, "utf8");
}

function discoverContractManifests(root: string): string[] {
  return walkFiles(root)
    .filter(
      (filePath) => path.basename(filePath) === "contract.json" && path.basename(path.dirname(filePath)) === "Database",
    )
    .sort((left, right) => left.localeCompare(right));
}

function walkFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(entryPath) : [entryPath];
  });
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).split(path.sep).join("/");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
