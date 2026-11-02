CREATE TABLE conversation_entries_next (
  session_id TEXT NOT NULL,
  id         TEXT NOT NULL,
  request_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  timestamp  TEXT NOT NULL,
  sequence   INTEGER NOT NULL,
  data       TEXT NOT NULL,
  PRIMARY KEY (session_id, id),
  UNIQUE (session_id, sequence),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

INSERT INTO conversation_entries_next
  (session_id, id, request_id, kind, timestamp, sequence, data)
SELECT
  session_id,
  id,
  request_id,
  kind,
  timestamp,
  ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY sequence, rowid) - 1,
  data
FROM conversation_entries;

DROP TABLE conversation_entries;
ALTER TABLE conversation_entries_next RENAME TO conversation_entries;

CREATE INDEX idx_entries_session_request
  ON conversation_entries(session_id, request_id);

CREATE TABLE session_commands (
  session_id     TEXT NOT NULL,
  command_id     TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  payload_hash   TEXT NOT NULL,
  request_id     TEXT NOT NULL,
  state          TEXT NOT NULL CHECK(state IN ('running', 'completed', 'failed', 'cancelled')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (session_id, command_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_session_commands_request
  ON session_commands(session_id, request_id);
