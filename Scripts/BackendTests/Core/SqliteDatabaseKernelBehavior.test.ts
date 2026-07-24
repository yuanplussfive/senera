import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { AgentConfigDatabaseContract } from "../../../Source/AgentSystem/Config/AgentConfigSqlSchema.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import type { AgentSqliteStoreContract } from "../../../Source/AgentSystem/Database/AgentSqliteStoreContract.js";
import {
  AgentSqliteMigrationError,
  AgentSqliteMigrationErrorCodes,
} from "../../../Source/AgentSystem/Database/AgentSqliteMigrationRunner.js";
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
    });
  });

  test("rebuilds an unrecognized authoritative database into its declared current contract", () => {
    const databasePath = temporaryDatabasePath("unknown.sqlite");
    const unknown = new Database(databasePath);
    unknown.exec("CREATE TABLE unrelated_records (id INTEGER PRIMARY KEY) STRICT;");
    unknown.close();

    withDatabaseKernel(databasePath, AgentConfigDatabaseContract, (kernel) => {
      expect(userTable(kernel.connection, "unrelated_records")).toBe(false);
      expect(userTable(kernel.connection, "config_revisions")).toBe(true);
      expect(recordedVersions(kernel.connection)).toEqual(declaredVersions(AgentConfigDatabaseContract));
    });
  });

  test("rebuilds a manually changed authoritative schema after validating a replacement", () => {
    const databasePath = temporaryDatabasePath("changed-config.sqlite");
    const initial = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentConfigDatabaseContract });
    initial.connection
      .prepare("INSERT INTO config_revisions (revision, config_json, source, created_at) VALUES (?, ?, ?, ?)")
      .run(1, "{}", "seed", "2026-07-23T00:00:00.000Z");
    initial.close();

    const changed = new Database(databasePath);
    changed.exec("ALTER TABLE config_revisions ADD COLUMN unexpected_value TEXT;");
    changed.close();

    const rebuilt = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentConfigDatabaseContract });
    expect(columnNames(rebuilt.connection, "config_revisions")).not.toContain("unexpected_value");
    expect(rebuilt.connection.prepare("SELECT COUNT(*) AS count FROM config_revisions").get()).toEqual({ count: 0 });
    rebuilt.close();
  });

  test("rejects an unrecognized derived database instead of deleting an arbitrary SQLite file", () => {
    const databasePath = temporaryDatabasePath("unknown-derived.sqlite");
    const unknown = new Database(databasePath);
    unknown.exec("CREATE TABLE unrelated_records (id INTEGER PRIMARY KEY) STRICT;");
    unknown.close();

    expect(
      () => new AgentSqliteDatabaseKernel({ databasePath, contract: AgentToolSearchLearningStoreContract }),
    ).toThrowError(
      expect.objectContaining<Partial<AgentSqliteMigrationError>>({
        code: AgentSqliteMigrationErrorCodes.UntrackedDatabase,
      }),
    );
  });

  test("rejects an explicitly identified different store instead of rebuilding over it", () => {
    const databasePath = temporaryDatabasePath("other-store.sqlite");
    const toolStore = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentToolSearchLearningStoreContract });
    toolStore.close();

    expect(() => new AgentSqliteDatabaseKernel({ databasePath, contract: AgentConfigDatabaseContract })).toThrowError(
      expect.objectContaining<Partial<AgentSqliteMigrationError>>({
        code: AgentSqliteMigrationErrorCodes.ContractIdentityMismatch,
      }),
    );

    const unchanged = new Database(databasePath);
    expect(userTable(unchanged, "tool_search_episodes")).toBe(true);
    expect(userTable(unchanged, "config_revisions")).toBe(false);
    unchanged.close();
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
