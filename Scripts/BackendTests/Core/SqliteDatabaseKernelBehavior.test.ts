import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { AgentConfigDatabaseContract } from "../../../Source/AgentSystem/Config/AgentConfigSqlSchema.js";
import {
  AgentSqliteContractMetadataTable,
  AgentSqliteMigrationLedgerTable,
  AgentSqliteTimeMetadataTable,
  snapshotAgentSqliteSchema,
} from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseSchema.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { listAgentSqliteDatabaseFamilyPaths } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseLifecycle.js";
import type { AgentSqliteStoreContract } from "../../../Source/AgentSystem/Database/AgentSqliteStoreContract.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentSessionDatabaseContract } from "../../../Source/AgentSystem/SessionPersistence/AgentSessionSqlSchema.js";
import { DefaultAgentTimeZone } from "../../../Source/AgentSystem/Time/AgentTime.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite database kernel", () => {
  test("retains the active lifecycle marker while identifying the complete database family", () => {
    const databasePath = temporaryDatabasePath("lifecycle-family.sqlite");
    const kernel = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentConfigDatabaseContract });
    try {
      const completeFamily = listAgentSqliteDatabaseFamilyPaths(databasePath);
      const activeMarker = completeFamily.find((filePath) => filePath.includes(".senera-sqlite-open-"));
      expect(activeMarker).toBeDefined();
      expect(listAgentSqliteDatabaseFamilyPaths(databasePath, { excludeCurrentProcessMarkers: true })).not.toContain(
        activeMarker,
      );
    } finally {
      kernel.close();
    }
  });

  test("records the Shanghai business-time policy without changing the store contract schema", () => {
    const databasePath = temporaryDatabasePath("time-policy.sqlite");
    const initial = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentConfigDatabaseContract });

    expect(initial.timeZone).toBe(DefaultAgentTimeZone);
    expect(initial.connection.prepare("SELECT vec_version() AS version").get()).toEqual({
      version: expect.stringMatching(/^v\d+\.\d+\.\d+$/),
    });
    expect(initial.connection.prepare(`SELECT time_zone FROM ${AgentSqliteTimeMetadataTable}`).all()).toEqual([
      { time_zone: DefaultAgentTimeZone },
    ]);
    expect(snapshotAgentSqliteSchema(initial.connection)).toBe(AgentConfigDatabaseContract.migrations.at(-1)?.snapshot);
    initial.close();

    const reopened = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentConfigDatabaseContract });
    expect(reopened.timeZone).toBe(DefaultAgentTimeZone);
    expect(reopened.connection.prepare(`SELECT COUNT(*) AS count FROM ${AgentSqliteTimeMetadataTable}`).get()).toEqual({
      count: 1,
    });
    reopened.close();
  });

  test("adds the time policy to a pre-existing authoritative database without rebuilding it", () => {
    const databasePath = temporaryDatabasePath("legacy-time-policy.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(AgentConfigDatabaseContract.migrations[0].sql);
    legacy.close();

    const kernel = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentConfigDatabaseContract });
    expect(kernel.recovery).toBeUndefined();
    expect(kernel.timeZone).toBe(DefaultAgentTimeZone);
    expect(kernel.connection.prepare(`SELECT time_zone FROM ${AgentSqliteTimeMetadataTable}`).all()).toEqual([
      { time_zone: DefaultAgentTimeZone },
    ]);
    kernel.close();
  });

  test("adopts the declared configuration baseline and migrates it without losing revisions", () => {
    const databasePath = temporaryDatabasePath("config.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(AgentConfigDatabaseContract.migrations[0].sql);
    legacy
      .prepare("INSERT INTO config_revisions (revision, config_json, source, created_at) VALUES (?, ?, ?, ?)")
      .run(1, '{"Server":{"Port":8787}}', "seed", "2026-07-23T00:00:00.000Z");
    legacy.close();

    withDatabaseKernel(databasePath, AgentConfigDatabaseContract, (kernel) => {
      expect(kernel.connection.prepare("SELECT revision FROM config_revisions").all()).toEqual([{ revision: 1 }]);
      expect(userTable(kernel.connection, "config_metadata")).toBe(false);
      expect(recordedVersions(kernel.connection)).toEqual(declaredVersions(AgentConfigDatabaseContract));
    });
  });

  test("adopts the declared session baseline then applies all later structure migrations", () => {
    const databasePath = temporaryDatabasePath("sessions.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(AgentSessionDatabaseContract.migrations[0].sql);
    legacy
      .prepare(
        "INSERT INTO sessions (id, title, status, created_at, updated_at, active_request_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("session-1", "Saved session", "idle", "2026-07-23T00:00:00.000Z", "2026-07-23T00:00:00.000Z", null, "{}");
    legacy.close();

    withDatabaseKernel(databasePath, AgentSessionDatabaseContract, (kernel) => {
      expect(kernel.connection.prepare("SELECT id, title FROM sessions").all()).toEqual([
        { id: "session-1", title: "Saved session" },
      ]);
      expect(columnNames(kernel.connection, "run_events")).toEqual(expect.arrayContaining(["event_id", "reliability"]));
      expect(userTable(kernel.connection, "session_history_mutations")).toBe(true);
      expect(userTable(kernel.connection, "turn_preparations")).toBe(true);
      expect(userTable(kernel.connection, "event_outbox")).toBe(true);
      expect(recordedVersions(kernel.connection)).toEqual(declaredVersions(AgentSessionDatabaseContract));
    });
  });

  test("removes retired roleplay tables from an existing session database without losing sessions", () => {
    const databasePath = temporaryDatabasePath("sessions-roleplay-retirement.sqlite");
    const legacyContract = {
      ...AgentSessionDatabaseContract,
      migrations: AgentSessionDatabaseContract.migrations.slice(0, 11),
    };
    const legacy = new AgentSqliteDatabaseKernel({ databasePath, contract: legacyContract });
    legacy.connection
      .prepare(
        "INSERT INTO sessions (id, title, status, created_at, updated_at, active_request_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "session-retained",
        "Retained session",
        "idle",
        "2026-08-22T00:00:00.000Z",
        "2026-08-22T00:00:00.000Z",
        null,
        "{}",
      );
    expect(userTable(legacy.connection, "roleplay_state_events")).toBe(true);
    legacy.close();

    withDatabaseKernel(databasePath, AgentSessionDatabaseContract, (current) => {
      expect(current.connection.prepare("SELECT id, title FROM sessions").all()).toEqual([
        { id: "session-retained", title: "Retained session" },
      ]);
      expect(userTable(current.connection, "roleplay_state_events")).toBe(false);
      expect(userTable(current.connection, "roleplay_state_snapshots")).toBe(false);
      expect(recordedVersions(current.connection)).toEqual(declaredVersions(AgentSessionDatabaseContract));
    });
  });

  test("adopts the current memory baseline without obsolete semantic tables", () => {
    const databasePath = temporaryDatabasePath("memory.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(AgentMemoryDatabaseContract.migrations[0].sql);
    legacy.close();

    withDatabaseKernel(databasePath, AgentMemoryDatabaseContract, (kernel) => {
      expect(userTable(kernel.connection, "memory_episodes")).toBe(true);
      expect(userTable(kernel.connection, "memory_sources")).toBe(true);
      expect(userTable(kernel.connection, "continuity_learning_jobs")).toBe(false);
      expect(userTable(kernel.connection, "continuity_observations")).toBe(false);
      expect(userTable(kernel.connection, "continuity_assertions")).toBe(false);
      expect(userTable(kernel.connection, "memory_items")).toBe(false);
      expect(userTable(kernel.connection, "continuity_rules")).toBe(false);
      expect(recordedVersions(kernel.connection)).toEqual(declaredVersions(AgentMemoryDatabaseContract));
    });
  });

  test("initializes only the current physical and execution schema", () => {
    const databasePath = temporaryDatabasePath("memory-current-baseline.sqlite");
    withDatabaseKernel(databasePath, AgentMemoryDatabaseContract, (kernel) => {
      expect(kernel.connection.prepare("PRAGMA table_info(memory_episodes)").all()).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "context_mode" })]),
      );
      expect(
        kernel.connection
          .prepare<[], { name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all()
          .map((row) => row.name)
          .filter((name) => !name.startsWith("__senera_")),
      ).toEqual([
        "agent_execution_events",
        "agent_execution_runs",
        "agent_execution_steps",
        "agent_todos",
        "continuity_memory_delivery",
        "memory_background_learning_requests",
        "memory_catalog_state",
        "memory_episodes",
        "memory_sources",
        "pi_compaction_candidates",
      ]);
      expect(kernel.connection.prepare("SELECT catalog, revision FROM memory_catalog_state").all()).toEqual([
        { catalog: "physical_history", revision: 0 },
      ]);
      expect(kernel.connection.pragma("foreign_key_check")).toEqual([]);
    });
  });

  test.each([
    { contract: AgentConfigDatabaseContract, currentTable: "config_revisions" },
    { contract: AgentMemoryDatabaseContract, currentTable: "memory_episodes" },
    { contract: AgentSessionDatabaseContract, currentTable: "sessions" },
  ] as const)(
    "backs up and reinitializes an unrecognized $contract.id authoritative database",
    ({ contract, currentTable }) => {
      const databasePath = temporaryDatabasePath(`${contract.id}-unknown.sqlite`);
      const unknown = new Database(databasePath);
      unknown.exec("CREATE TABLE unrelated_records (id INTEGER PRIMARY KEY) STRICT;");
      unknown.close();

      const recovered = new AgentSqliteDatabaseKernel({ databasePath, contract });
      expect(userTable(recovered.connection, "unrelated_records")).toBe(false);
      expect(userTable(recovered.connection, currentTable)).toBe(true);
      const backup = openRecoveryBackup(recovered);
      expect(userTable(backup, "unrelated_records")).toBe(true);
      backup.close();
      recovered.close();
    },
  );

  test("backs up and reinitializes a manually changed authoritative schema", () => {
    const databasePath = temporaryDatabasePath("changed-config.sqlite");
    const initial = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentConfigDatabaseContract });
    initial.connection
      .prepare("INSERT INTO config_revisions (revision, config_json, source, created_at) VALUES (?, ?, ?, ?)")
      .run(1, "{}", "seed", "2026-07-23T00:00:00.000Z");
    initial.close();

    const changed = new Database(databasePath);
    changed.exec("ALTER TABLE config_revisions ADD COLUMN unexpected_value TEXT;");
    changed.close();

    const recovered = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentConfigDatabaseContract });
    expect(columnNames(recovered.connection, "config_revisions")).not.toContain("unexpected_value");
    expect(recovered.connection.prepare("SELECT revision FROM config_revisions").all()).toEqual([]);
    const backup = openRecoveryBackup(recovered);
    expect(columnNames(backup, "config_revisions")).toContain("unexpected_value");
    expect(backup.prepare("SELECT revision FROM config_revisions").all()).toEqual([{ revision: 1 }]);
    backup.close();
    recovered.close();
  });

  test("backs up and reinitializes malformed SQLite control tables", () => {
    const databasePath = temporaryDatabasePath("malformed-control.sqlite");
    const malformed = new Database(databasePath);
    malformed.exec(`
      CREATE TABLE ${AgentSqliteContractMetadataTable} (unexpected TEXT);
      CREATE TABLE ${AgentSqliteMigrationLedgerTable} (unexpected TEXT);
    `);
    malformed.close();

    const recovered = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentConfigDatabaseContract });
    expect(userTable(recovered.connection, "config_revisions")).toBe(true);
    const backup = openRecoveryBackup(recovered);
    expect(columnNames(backup, AgentSqliteContractMetadataTable)).toEqual(["unexpected"]);
    backup.close();
    recovered.close();
  });

  test("backs up a corrupt database file before initializing a healthy authoritative store", () => {
    const databasePath = temporaryDatabasePath("corrupt-config.sqlite");
    const original = Buffer.from("not-a-sqlite-database", "utf8");
    fs.writeFileSync(databasePath, original);

    const recovered = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentConfigDatabaseContract });
    expect(userTable(recovered.connection, "config_revisions")).toBe(true);
    const recovery = recovered.recovery;
    if (!recovery) throw new Error("Expected SQLite startup recovery metadata.");
    expect(fs.readFileSync(recovery.backupPath)).toEqual(original);
    recovered.close();
  });
});

function recordedVersions(database: Database.Database): Array<{ version: number }> {
  return database.prepare("SELECT version FROM __senera_schema_migrations ORDER BY version").all() as Array<{
    version: number;
  }>;
}

function declaredVersions(contract: AgentSqliteStoreContract): Array<{ version: number }> {
  return contract.migrations.map(({ version }) => ({ version }));
}

function openRecoveryBackup(kernel: AgentSqliteDatabaseKernel): Database.Database {
  if (!kernel.recovery) throw new Error("Expected SQLite startup recovery metadata.");
  return new Database(kernel.recovery.backupPath, { readonly: true, fileMustExist: true });
}

function withDatabaseKernel(
  databasePath: string,
  contract: AgentSqliteStoreContract,
  inspect: (kernel: AgentSqliteDatabaseKernel) => void,
): void {
  const kernel = new AgentSqliteDatabaseKernel({ databasePath, contract });
  try {
    inspect(kernel);
  } finally {
    kernel.close();
  }
}

function userTable(database: Database.Database, tableName: string): boolean {
  return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function columnNames(database: Database.Database, tableName: string): string[] {
  return (database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map(({ name }) => name);
}

function temporaryDatabasePath(fileName: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "senera-sqlite-kernel-"));
  temporaryDirectories.push(directory);
  return path.join(directory, fileName);
}
