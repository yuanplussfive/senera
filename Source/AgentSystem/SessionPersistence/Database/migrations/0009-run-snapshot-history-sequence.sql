DROP INDEX idx_run_snapshots_session;

CREATE TABLE run_snapshots_next (
  session_id      TEXT NOT NULL,
  request_id      TEXT NOT NULL,
  input           TEXT NOT NULL,
  status          TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
  started_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  ended_at        TEXT,
  error_message   TEXT,
  model_provider  TEXT,
  history_sequence INTEGER NOT NULL CHECK(history_sequence >= 0),
  PRIMARY KEY (session_id, request_id),
  UNIQUE (session_id, history_sequence),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

INSERT INTO run_snapshots_next
  (session_id, request_id, input, status, started_at, updated_at, ended_at, error_message, model_provider,
   history_sequence)
SELECT
  session_id,
  request_id,
  input,
  status,
  started_at,
  updated_at,
  ended_at,
  error_message,
  model_provider,
  ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY started_at, request_id) - 1
FROM run_snapshots;

DROP TABLE run_snapshots;
ALTER TABLE run_snapshots_next RENAME TO run_snapshots;

CREATE INDEX idx_run_snapshots_session
  ON run_snapshots(session_id, history_sequence);

CREATE INDEX idx_run_snapshots_status
  ON run_snapshots(status, session_id, history_sequence);
