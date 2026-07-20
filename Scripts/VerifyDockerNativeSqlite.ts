import assert from "node:assert/strict";
import Database from "better-sqlite3";

const database = new Database(":memory:");
try {
  database.exec("CREATE TABLE smoke_check (value TEXT NOT NULL); INSERT INTO smoke_check VALUES ('ok');");
  const row = database.prepare("SELECT value FROM smoke_check LIMIT 1").get() as { value?: unknown } | undefined;
  assert.equal(row?.value, "ok");
} finally {
  database.close();
}

console.log("Docker native SQLite verification passed.");
