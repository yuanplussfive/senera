import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { defineAgentSqliteMigration } from "../../../Source/AgentSystem/Database/AgentSqliteMigration.js";
import {
  AgentSqliteMigrationError,
  AgentSqliteMigrationErrorCodes,
  runAgentSqliteMigrations,
} from "../../../Source/AgentSystem/Database/AgentSqliteMigrationRunner.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite database kernel", () => {
  test("opens an absolute database path and applies migrations exactly once", () => {
    const databasePath = temporaryDatabasePath("nested", "kernel.sqlite");
    const migrations = [
      migration(1, "create_records", "CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT;"),
      migration(2, "seed_record", "INSERT INTO records (id, value) VALUES (1, 'seed');"),
    ];

    const first = new AgentSqliteDatabaseKernel({ databasePath, migrations });
    expect(first.databasePath).toBe(path.resolve(databasePath));
    expect(first.inspectHealth()).toEqual({ integrity: "ok", foreignKeyViolations: [] });
    first.close();

    const second = new AgentSqliteDatabaseKernel({ databasePath, migrations });
    const count = second.connection.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM records").get();
    const ledger = second.connection.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all();
    expect(count?.count).toBe(1);
    expect(ledger).toEqual([
      { version: 1, name: "create_records" },
      { version: 2, name: "seed_record" },
    ]);
    second.close();
  });

  test("fails closed when an applied migration changes", () => {
    const databasePath = temporaryDatabasePath("drift.sqlite");
    const original = migration(1, "create_records", "CREATE TABLE records (id INTEGER PRIMARY KEY) STRICT;");
    new AgentSqliteDatabaseKernel({ databasePath, migrations: [original] }).close();

    const changed = migration(1, "create_records", "CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT) STRICT;");
    expect(() => new AgentSqliteDatabaseKernel({ databasePath, migrations: [changed] })).toThrowError(
      expect.objectContaining<Partial<AgentSqliteMigrationError>>({ code: AgentSqliteMigrationErrorCodes.Drift }),
    );
  });

  test("rolls back the schema and ledger when a migration fails", () => {
    const databasePath = temporaryDatabasePath("rollback.sqlite");
    const database = new Database(databasePath);
    const migrations = [
      migration(1, "create_records", "CREATE TABLE records (id INTEGER PRIMARY KEY) STRICT;"),
      migration(2, "invalid_change", "ALTER TABLE missing_table ADD COLUMN value TEXT;"),
    ];

    expect(() => runAgentSqliteMigrations(database, migrations)).toThrow();
    const tables = database
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all();
    expect(tables).toEqual([]);
    database.close();
  });

  test("rejects non-contiguous migration plans before changing the database", () => {
    const databasePath = temporaryDatabasePath("invalid-plan.sqlite");
    expect(
      () => new AgentSqliteDatabaseKernel({ databasePath, migrations: [migration(2, "late", "SELECT 1;")] }),
    ).toThrowError(
      expect.objectContaining<Partial<AgentSqliteMigrationError>>({
        code: AgentSqliteMigrationErrorCodes.InvalidPlan,
      }),
    );
  });

  test("adopts a legacy database without rewriting its records", () => {
    const databasePath = temporaryDatabasePath("legacy.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT;");
    legacy.prepare("INSERT INTO records (id, value) VALUES (?, ?)").run(7, "preserved");
    legacy.close();

    const kernel = new AgentSqliteDatabaseKernel({
      databasePath,
      migrations: [
        migration(
          1,
          "records_baseline",
          "CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT;",
        ),
      ],
    });
    expect(kernel.connection.prepare("SELECT id, value FROM records").all()).toEqual([{ id: 7, value: "preserved" }]);
    expect(kernel.connection.prepare("SELECT version FROM schema_migrations").all()).toEqual([{ version: 1 }]);
    kernel.close();
  });
});

function migration(version: number, name: string, sql: string) {
  return defineAgentSqliteMigration({ version, name, sql });
}

function temporaryDatabasePath(...segments: string[]): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "senera-sqlite-kernel-"));
  temporaryDirectories.push(directory);
  return path.join(directory, ...segments);
}
