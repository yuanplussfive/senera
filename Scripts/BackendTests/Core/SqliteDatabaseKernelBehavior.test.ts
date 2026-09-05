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
import type { AgentSqliteStoreContract } from "../../../Source/AgentSystem/Database/AgentSqliteStoreContract.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentSessionDatabaseContract } from "../../../Source/AgentSystem/SessionPersistence/AgentSessionSqlSchema.js";
import { DefaultAgentTimeZone } from "../../../Source/AgentSystem/Time/AgentTime.js";
import { AgentToolSearchLearningStoreContract } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemorySqlSchema.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite database kernel", () => {
  test("records the Shanghai business-time policy without changing the store contract schema", () => {
    const databasePath = temporaryDatabasePath("time-policy.sqlite");
    const initial = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentConfigDatabaseContract });

    expect(initial.timeZone).toBe(DefaultAgentTimeZone);
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

  test("adopts the declared memory baseline and applies subsequent migrations", () => {
    const databasePath = temporaryDatabasePath("memory.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(AgentMemoryDatabaseContract.migrations[0].sql);
    legacy.close();

    withDatabaseKernel(databasePath, AgentMemoryDatabaseContract, (kernel) => {
      expect(userTable(kernel.connection, "continuity_learning_jobs")).toBe(true);
      expect(userTable(kernel.connection, "continuity_observations")).toBe(true);
      expect(userTable(kernel.connection, "continuity_assertions")).toBe(false);
      expect(userTable(kernel.connection, "memory_items")).toBe(false);
      expect(columnNames(kernel.connection, "continuity_rules")).toContain("source_refs_json");
      expect(recordedVersions(kernel.connection)).toEqual(declaredVersions(AgentMemoryDatabaseContract));
    });
  });

  test("retires the execution goal ledger while preserving execution history", () => {
    const databasePath = temporaryDatabasePath("memory-goal-ledger-retirement.sqlite");
    const legacyContract: AgentSqliteStoreContract = {
      ...AgentMemoryDatabaseContract,
      migrations: AgentMemoryDatabaseContract.migrations.slice(0, 36),
    };
    const legacy = new AgentSqliteDatabaseKernel({ databasePath, contract: legacyContract });
    legacy.connection
      .prepare(
        `INSERT INTO agent_goals (
          id, uri, scope_kind, scope_id, objective, status, reason, created_at, updated_at,
          completed_at, session_id, request_id, origin
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "legacy-goal",
        "senera://goal/legacy-goal",
        "session",
        "session-1",
        "Legacy execution objective",
        "completed",
        null,
        "2026-08-22T00:00:00.000Z",
        "2026-08-22T00:01:00.000Z",
        "2026-08-22T00:01:00.000Z",
        "session-1",
        "request-1",
        "automatic",
      );
    legacy.connection
      .prepare(
        `INSERT INTO agent_execution_runs (
          id, uri, session_id, request_id, goal_id, objective, status, reason,
          created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "execution-1",
        "senera://execution/execution-1",
        "session-1",
        "request-1",
        "legacy-goal",
        "Legacy execution objective",
        "completed",
        "All planned steps completed.",
        "2026-08-22T00:00:00.000Z",
        "2026-08-22T00:01:00.000Z",
        "2026-08-22T00:01:00.000Z",
      );
    legacy.connection
      .prepare(
        `INSERT INTO agent_execution_steps (
          id, execution_id, node_id, plan_id, plan_revision, step_index, title, detail, status,
          dependency_ids_json, call_id, failure, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "execution-step-1",
        "execution-1",
        "node-1",
        "plan-1",
        1,
        0,
        "Inspect",
        "Inspect the workspace",
        "completed",
        "[]",
        "call-1",
        null,
        "2026-08-22T00:00:00.000Z",
        "2026-08-22T00:01:00.000Z",
      );
    legacy.connection
      .prepare(
        `INSERT INTO agent_execution_events (
          id, execution_id, event_kind, step_id, session_id, request_id, payload_json, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "execution-event-1",
        "execution-1",
        "execution.completed",
        "execution-step-1",
        "session-1",
        "request-1",
        '{"execution":"preserved"}',
        "2026-08-22T00:01:00.000Z",
      );
    legacy.close();

    withDatabaseKernel(databasePath, AgentMemoryDatabaseContract, (current) => {
      expect(userTable(current.connection, "agent_goals")).toBe(false);
      expect(userTable(current.connection, "agent_goal_evidence")).toBe(false);
      expect(columnNames(current.connection, "agent_execution_runs")).not.toContain("goal_id");
      expect(current.connection.prepare("SELECT id, objective FROM agent_execution_runs").all()).toEqual([
        { id: "execution-1", objective: "Legacy execution objective" },
      ]);
      expect(current.connection.prepare("SELECT id, execution_id FROM agent_execution_steps").all()).toEqual([
        { id: "execution-step-1", execution_id: "execution-1" },
      ]);
      expect(current.connection.prepare("SELECT id, event_kind FROM agent_execution_events").all()).toEqual([
        { id: "execution-event-1", event_kind: "execution.completed" },
      ]);
      expect(current.connection.pragma("foreign_key_check")).toEqual([]);
      expect(recordedVersions(current.connection)).toEqual(declaredVersions(AgentMemoryDatabaseContract));
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
    { contract: AgentMemoryDatabaseContract, currentTable: "continuity_observations" },
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
