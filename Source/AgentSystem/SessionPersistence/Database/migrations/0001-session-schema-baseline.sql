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
