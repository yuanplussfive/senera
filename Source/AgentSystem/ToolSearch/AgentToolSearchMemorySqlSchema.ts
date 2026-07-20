import type Database from "better-sqlite3";
import { defineAgentSqliteMigration } from "../Database/AgentSqliteMigration.js";
import { runAgentSqliteMigrations } from "../Database/AgentSqliteMigrationRunner.js";

const AgentToolSearchMemoryInitialSchemaSql = `
    CREATE TABLE IF NOT EXISTS tool_search_episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      query_tokens TEXT NOT NULL,
      planner_tags TEXT NOT NULL,
      candidates TEXT NOT NULL,
      chosen_tools TEXT NOT NULL,
      learned_keywords TEXT NOT NULL,
      outcome TEXT NOT NULL,
      calls TEXT NOT NULL,
      final_score REAL NOT NULL,
      final_outcome TEXT NOT NULL,
      project_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tool_search_episodes_project_time
      ON tool_search_episodes(project_id, timestamp DESC);
    CREATE TABLE IF NOT EXISTS tool_learning_terms (
      project_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      term TEXT NOT NULL,
      source TEXT NOT NULL,
      support REAL NOT NULL,
      weight REAL NOT NULL,
      last_seen_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, tool_name, term, source)
    );
    CREATE INDEX IF NOT EXISTS idx_tool_learning_terms_project_tool
      ON tool_learning_terms(project_id, tool_name);
    CREATE TABLE IF NOT EXISTS tool_use_patterns (
      project_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      pattern_key TEXT NOT NULL,
      trigger_terms TEXT NOT NULL,
      argument_keys TEXT NOT NULL,
      evidence_kinds TEXT NOT NULL,
      support REAL NOT NULL,
      last_seen_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, tool_name, pattern_key)
    );
    CREATE INDEX IF NOT EXISTS idx_tool_use_patterns_project_tool
      ON tool_use_patterns(project_id, tool_name);
`;

export const AgentToolSearchMemoryDatabaseMigrations = Object.freeze([
  defineAgentSqliteMigration({
    version: 1,
    name: "tool_search_memory_schema_baseline",
    sql: AgentToolSearchMemoryInitialSchemaSql,
  }),
]);

export function installToolSearchMemorySchema(db: Database.Database): void {
  runAgentSqliteMigrations(db, AgentToolSearchMemoryDatabaseMigrations);
}
