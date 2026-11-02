CREATE TABLE roleplay_state_events (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  request_id  TEXT NOT NULL,
  revision    INTEGER NOT NULL CHECK(revision > 0),
  event_index INTEGER NOT NULL CHECK(event_index >= 0),
  created_at  TEXT NOT NULL,
  event_json  TEXT NOT NULL,
  UNIQUE(session_id, revision, event_index),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX idx_roleplay_state_events_session_revision
  ON roleplay_state_events(session_id, revision, event_index);
CREATE INDEX idx_roleplay_state_events_session_request
  ON roleplay_state_events(session_id, request_id);

CREATE TABLE roleplay_state_snapshots (
  session_id TEXT PRIMARY KEY,
  revision   INTEGER NOT NULL CHECK(revision >= 0),
  updated_at TEXT NOT NULL,
  state_json TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
