import type Database from "better-sqlite3";
import { defineAgentSqliteMigration } from "../Database/AgentSqliteMigration.js";
import { runAgentSqliteMigrations } from "../Database/AgentSqliteMigrationRunner.js";

/* SQL kept as one immutable baseline so existing databases are adopted without rewriting data. */
const AgentSessionInitialSchemaSql = `
    CREATE TABLE IF NOT EXISTS sessions (
      id                  TEXT PRIMARY KEY,
      title               TEXT NOT NULL DEFAULT '新对话',
      status              TEXT NOT NULL DEFAULT 'idle',
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL,
      active_request_id   TEXT,
      metadata            TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

    CREATE TABLE IF NOT EXISTS session_history_mutations (
      session_id        TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      mutation_id       TEXT NOT NULL UNIQUE,
      kind              TEXT NOT NULL CHECK(kind = 'truncate'),
      from_request_id   TEXT NOT NULL,
      pi_kind           TEXT NOT NULL CHECK(pi_kind IN ('none', 'reset', 'rewind')),
      pi_entry_id       TEXT,
      model_provider_id TEXT,
      created_at        TEXT NOT NULL,
      CHECK((pi_kind = 'rewind' AND pi_entry_id IS NOT NULL) OR (pi_kind != 'rewind' AND pi_entry_id IS NULL))
    );

    CREATE TABLE IF NOT EXISTS conversation_entries (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL,
      request_id  TEXT NOT NULL,
      kind        TEXT NOT NULL,
      timestamp   TEXT NOT NULL,
      sequence    INTEGER NOT NULL,
      data        TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_entries_session_seq ON conversation_entries(session_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_entries_request ON conversation_entries(request_id);

    CREATE TABLE IF NOT EXISTS run_events (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id     TEXT NOT NULL,
      request_id     TEXT NOT NULL,
      kind           TEXT NOT NULL,
      timestamp      TEXT NOT NULL,
      event_sequence INTEGER NOT NULL,
      step           INTEGER,
      detail_id      TEXT,
      event_json     TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_run_events_session_id ON run_events(session_id, id);
    CREATE INDEX IF NOT EXISTS idx_run_events_request ON run_events(request_id);

    CREATE TABLE IF NOT EXISTS app_settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS step_traces (
      session_id    TEXT NOT NULL,
      request_id    TEXT NOT NULL,
      turn_sequence INTEGER NOT NULL,
      step          INTEGER NOT NULL,
      seq           INTEGER NOT NULL,
      data          TEXT NOT NULL,
      PRIMARY KEY (session_id, request_id, step, seq),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_step_traces_session ON step_traces(session_id, turn_sequence, step, seq);

    CREATE TABLE IF NOT EXISTS run_snapshots (
      session_id      TEXT NOT NULL,
      request_id      TEXT NOT NULL,
      input           TEXT NOT NULL,
      status          TEXT NOT NULL CHECK(status IN ('running','completed','failed','cancelled')),
      started_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      ended_at        TEXT,
      error_message   TEXT,
      model_provider  TEXT,
      PRIMARY KEY (session_id, request_id),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_run_snapshots_session ON run_snapshots(session_id, started_at);

    CREATE TABLE IF NOT EXISTS turn_preparations (
      session_id     TEXT NOT NULL,
      request_id     TEXT NOT NULL,
      snapshot_json  TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      PRIMARY KEY (session_id, request_id),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_turn_preparations_session ON turn_preparations(session_id, created_at);
`;

export const AgentSessionDatabaseMigrations = Object.freeze([
  defineAgentSqliteMigration({
    version: 1,
    name: "session_schema_baseline",
    sql: AgentSessionInitialSchemaSql,
  }),
  defineAgentSqliteMigration({
    version: 2,
    name: "run_event_identity",
    sql: `
      ALTER TABLE run_events ADD COLUMN event_id TEXT;
      ALTER TABLE run_events ADD COLUMN reliability TEXT NOT NULL DEFAULT 'durable';
      UPDATE run_events SET event_id = 'legacy:' || CAST(id AS TEXT) WHERE event_id IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_run_events_event_id ON run_events(event_id);
    `,
  }),
  defineAgentSqliteMigration({
    version: 3,
    name: "run_event_outbox",
    sql: `
      CREATE TABLE IF NOT EXISTS event_outbox (
        event_id         TEXT PRIMARY KEY,
        session_id       TEXT NOT NULL,
        request_id       TEXT NOT NULL,
        kind             TEXT NOT NULL,
        timestamp        TEXT NOT NULL,
        event_sequence   INTEGER NOT NULL,
        step             INTEGER,
        detail_id        TEXT,
        event_json       TEXT NOT NULL,
        state            TEXT NOT NULL CHECK(state IN ('pending', 'committed', 'failed')),
        attempts         INTEGER NOT NULL DEFAULT 0,
        next_attempt_at  TEXT,
        last_error       TEXT,
        created_at       TEXT NOT NULL,
        committed_at     TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_event_outbox_pending
        ON event_outbox(state, next_attempt_at, created_at);
      CREATE INDEX IF NOT EXISTS idx_event_outbox_session
        ON event_outbox(session_id, created_at);
    `,
  }),
  defineAgentSqliteMigration({
    version: 4,
    name: "run_event_outbox_retention_index",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_event_outbox_committed_retention
        ON event_outbox(state, committed_at);
    `,
  }),
]);

export function installAgentSessionSchema(db: Database.Database): void {
  runAgentSqliteMigrations(db, AgentSessionDatabaseMigrations);
}
