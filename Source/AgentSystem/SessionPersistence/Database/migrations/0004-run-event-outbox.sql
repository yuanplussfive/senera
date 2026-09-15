CREATE TABLE event_outbox (
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
CREATE INDEX idx_event_outbox_pending ON event_outbox(state, next_attempt_at, created_at);
CREATE INDEX idx_event_outbox_session ON event_outbox(session_id, created_at);
