import { defineAgentSqliteMigration } from "../Database/AgentSqliteMigration.js";

const AgentConfigInitialSchemaSql = `
  CREATE TABLE IF NOT EXISTS config_revisions (
    revision INTEGER PRIMARY KEY,
    config_json TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
`;

export const AgentConfigDatabaseMigrations = Object.freeze([
  defineAgentSqliteMigration({
    version: 1,
    name: "config_schema_baseline",
    sql: AgentConfigInitialSchemaSql,
  }),
]);
