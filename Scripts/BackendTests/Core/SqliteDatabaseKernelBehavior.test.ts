import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { AgentConfigDatabaseContract } from "../../../Source/AgentSystem/Config/AgentConfigSqlSchema.js";
import {
  AgentSqliteContractMetadataTable,
  AgentSqliteMigrationLedgerTable,
} from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseSchema.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import type { AgentSqliteStoreContract } from "../../../Source/AgentSystem/Database/AgentSqliteStoreContract.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentSessionDatabaseContract } from "../../../Source/AgentSystem/SessionPersistence/AgentSessionSqlSchema.js";
import { AgentToolSearchLearningStoreContract } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemorySqlSchema.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite database kernel", () => {
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

  test("adopts the declared memory baseline and applies subsequent migrations", () => {
    const databasePath = temporaryDatabasePath("memory.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(AgentMemoryDatabaseContract.migrations[0].sql);
    legacy.close();

    withDatabaseKernel(databasePath, AgentMemoryDatabaseContract, (kernel) => {
      expect(userTable(kernel.connection, "memory_learning_jobs")).toBe(true);
      expect(columnNames(kernel.connection, "memory_observations")).toEqual(expect.arrayContaining(["write_sequence"]));
      expect(recordedVersions(kernel.connection)).toEqual(declaredVersions(AgentMemoryDatabaseContract));
    });
  });

  test("rebuilds only the declared stale derived schema", () => {
    const databasePath = temporaryDatabasePath("tool-search.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(AgentToolSearchLearningStoreContract.legacySnapshots[0].snapshot);
    legacy
      .prepare(
        "INSERT INTO tool_search_episodes (query, query_tokens, planner_tags, candidates, chosen_tools, outcome, calls, final_score, final_outcome, project_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("old query", "[]", "[]", "[]", "[]", "success", "[]", 1, "{}", "project", 1);
    legacy.close();

    withDatabaseKernel(databasePath, AgentToolSearchLearningStoreContract, (kernel) => {
      expect(columnNames(kernel.connection, "tool_search_episodes")).toEqual(
        expect.arrayContaining(["learned_keywords"]),
      );
      expect(kernel.connection.prepare("SELECT COUNT(*) AS count FROM tool_search_episodes").get()).toEqual({
        count: 0,
      });
      expect(recordedVersions(kernel.connection)).toEqual(declaredVersions(AgentToolSearchLearningStoreContract));
      const backup = openRecoveryBackup(kernel);
      expect(columnNames(backup, "tool_search_episodes")).not.toContain("learned_keywords");
      backup.close();
    });
  });

  test.each([
    { contract: AgentConfigDatabaseContract, currentTable: "config_revisions" },
    { contract: AgentMemoryDatabaseContract, currentTable: "memory_items" },
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

  test("rebuilds an unrecognized derived database during the startup preflight", () => {
    const databasePath = temporaryDatabasePath("unknown-derived.sqlite");
    const unknown = new Database(databasePath);
    unknown.exec("CREATE TABLE unrelated_records (id INTEGER PRIMARY KEY) STRICT;");
    unknown.close();

    const rebuilt = new AgentSqliteDatabaseKernel({
      databasePath,
      contract: AgentToolSearchLearningStoreContract,
    });
    expect(userTable(rebuilt.connection, "unrelated_records")).toBe(false);
    expect(userTable(rebuilt.connection, "tool_search_episodes")).toBe(true);
    expect(recordedVersions(rebuilt.connection)).toEqual(declaredVersions(AgentToolSearchLearningStoreContract));
    const backup = openRecoveryBackup(rebuilt);
    expect(userTable(backup, "unrelated_records")).toBe(true);
    backup.close();
    rebuilt.close();
  });

  test("rebuilds a legacy tool-search database with the old migration ledger", () => {
    const databasePath = temporaryDatabasePath("legacy-tool-search.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(AgentToolSearchLearningStoreContract.migrations[0]!.sql);
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations (version, name, checksum, applied_at)
      VALUES (1, 'tool_search_memory_schema_baseline', 'legacy-checksum', '2026-07-20T13:55:08.186Z');
    `);
    legacy.close();

    const rebuilt = new AgentSqliteDatabaseKernel({
      databasePath,
      contract: AgentToolSearchLearningStoreContract,
    });
    expect(userTable(rebuilt.connection, "schema_migrations")).toBe(false);
    expect(recordedVersions(rebuilt.connection)).toEqual(declaredVersions(AgentToolSearchLearningStoreContract));
    const backup = openRecoveryBackup(rebuilt);
    expect(userTable(backup, "schema_migrations")).toBe(true);
    backup.close();
    rebuilt.close();
  });

  test("backs up an explicitly identified different store before initializing the requested store", () => {
    const databasePath = temporaryDatabasePath("other-store.sqlite");
    const toolStore = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentToolSearchLearningStoreContract });
    toolStore.close();

    const recovered = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentConfigDatabaseContract });
    expect(userTable(recovered.connection, "tool_search_episodes")).toBe(false);
    expect(userTable(recovered.connection, "config_revisions")).toBe(true);
    const backup = openRecoveryBackup(recovered);
    expect(userTable(backup, "tool_search_episodes")).toBe(true);
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

  test("preserves a current derived database when its immutable contract has not changed", () => {
    const databasePath = temporaryDatabasePath("current-tool-search.sqlite");
    const first = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentToolSearchLearningStoreContract });
    first.connection
      .prepare(
        "INSERT INTO tool_search_episodes (query, query_tokens, planner_tags, candidates, chosen_tools, learned_keywords, outcome, calls, final_score, final_outcome, project_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("query", "[]", "[]", "[]", "[]", "[]", "success", "[]", 1, "{}", "project", 1);
    first.close();

    const reopened = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentToolSearchLearningStoreContract });
    expect(reopened.connection.prepare("SELECT query FROM tool_search_episodes").all()).toEqual([{ query: "query" }]);
    reopened.close();
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
