import type Database from "better-sqlite3";
import { defineAgentSqliteMigration } from "../Database/AgentSqliteMigration.js";
import { runAgentSqliteMigrations } from "../Database/AgentSqliteMigrationRunner.js";

const AgentMemoryInitialSchemaSql = `
    CREATE TABLE IF NOT EXISTS memory_episodes (
      id TEXT PRIMARY KEY,
      uri TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      status TEXT NOT NULL,
      raw_user_text TEXT NOT NULL,
      standalone_request TEXT NOT NULL,
      context_mode TEXT NOT NULL,
      context_basis TEXT NOT NULL,
      topic TEXT NOT NULL,
      summary TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL,
      completed_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      time_zone TEXT NOT NULL,
      local_date TEXT NOT NULL,
      local_hour TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      UNIQUE(session_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_episodes_session_time
      ON memory_episodes(session_id, started_at_ms);
    CREATE INDEX IF NOT EXISTS idx_memory_episodes_session_local_date
      ON memory_episodes(session_id, time_zone, local_date, started_at_ms);

    CREATE TABLE IF NOT EXISTS memory_sources (
      id TEXT PRIMARY KEY,
      uri TEXT NOT NULL UNIQUE,
      episode_id TEXT NOT NULL,
      episode_uri TEXT NOT NULL,
      session_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      role TEXT NOT NULL,
      text_content TEXT,
      summary TEXT,
      conversation_entry_id TEXT NOT NULL,
      evidence_uri TEXT NOT NULL,
      artifact_uri TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      time_zone TEXT NOT NULL,
      local_date TEXT NOT NULL,
      local_hour TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      FOREIGN KEY (episode_id) REFERENCES memory_episodes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memory_sources_episode
      ON memory_sources(episode_uri, source_kind);
    CREATE INDEX IF NOT EXISTS idx_memory_sources_session_request
      ON memory_sources(session_id, request_id);
    CREATE INDEX IF NOT EXISTS idx_memory_sources_evidence_uri
      ON memory_sources(evidence_uri);
    CREATE INDEX IF NOT EXISTS idx_memory_sources_artifact_uri
      ON memory_sources(artifact_uri);
    CREATE INDEX IF NOT EXISTS idx_memory_sources_session_local_date
      ON memory_sources(session_id, time_zone, local_date, created_at_ms);

    CREATE TABLE IF NOT EXISTS memory_candidates (
      id TEXT PRIMARY KEY,
      uri TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      subject TEXT NOT NULL,
      claim TEXT NOT NULL,
      how_to_apply TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      triggers_json TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL NOT NULL,
      embedding_json TEXT NOT NULL,
      session_id TEXT NOT NULL,
      source_episode_uri TEXT NOT NULL,
      source_request_id TEXT NOT NULL,
      promoted_memory_uri TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      time_zone TEXT NOT NULL,
      local_date TEXT NOT NULL,
      local_hour TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      FOREIGN KEY (source_episode_uri) REFERENCES memory_episodes(uri) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memory_candidates_status_type
      ON memory_candidates(session_id, status, type, created_at_ms);
    CREATE INDEX IF NOT EXISTS idx_memory_candidates_local_date
      ON memory_candidates(session_id, time_zone, local_date, created_at_ms);

    CREATE TABLE IF NOT EXISTS memory_items (
      id TEXT PRIMARY KEY,
      uri TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      subject TEXT NOT NULL,
      claim TEXT NOT NULL,
      how_to_apply TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      triggers_json TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL NOT NULL,
      session_id TEXT NOT NULL,
      source_episode_uri TEXT NOT NULL,
      source_request_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      time_zone TEXT NOT NULL,
      local_date TEXT NOT NULL,
      local_hour TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      FOREIGN KEY (source_episode_uri) REFERENCES memory_episodes(uri) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memory_items_status_type
      ON memory_items(status, type, updated_at_ms);
    CREATE INDEX IF NOT EXISTS idx_memory_items_session_time
      ON memory_items(session_id, updated_at_ms);
    CREATE INDEX IF NOT EXISTS idx_memory_items_local_date
      ON memory_items(time_zone, local_date, updated_at_ms);

    CREATE TABLE IF NOT EXISTS memory_item_vectors (
      memory_uri TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      embedding_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY(memory_uri, model),
      FOREIGN KEY (memory_uri) REFERENCES memory_items(uri) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memory_item_vectors_model
      ON memory_item_vectors(model, updated_at_ms);

    CREATE TABLE IF NOT EXISTS memory_observations (
      id TEXT PRIMARY KEY,
      uri TEXT NOT NULL UNIQUE,
      memory_uri TEXT NOT NULL,
      operation TEXT NOT NULL,
      candidate_uris_json TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      confidence REAL NOT NULL,
      session_id TEXT NOT NULL,
      source_episode_uri TEXT NOT NULL,
      source_request_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      time_zone TEXT NOT NULL,
      local_date TEXT NOT NULL,
      local_hour TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      FOREIGN KEY (memory_uri) REFERENCES memory_items(uri) ON DELETE CASCADE,
      FOREIGN KEY (source_episode_uri) REFERENCES memory_episodes(uri) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memory_observations_memory_time
      ON memory_observations(memory_uri, created_at_ms);
    CREATE INDEX IF NOT EXISTS idx_memory_observations_session_time
      ON memory_observations(session_id, created_at_ms);
`;

export const AgentMemoryDatabaseMigrations = Object.freeze([
  defineAgentSqliteMigration({
    version: 1,
    name: "memory_schema_baseline",
    sql: AgentMemoryInitialSchemaSql,
  }),
]);

export function installAgentMemorySchema(db: Database.Database): void {
  runAgentSqliteMigrations(db, AgentMemoryDatabaseMigrations);
}
