CREATE TABLE run_snapshot_revisions (
  revision_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       TEXT NOT NULL,
  request_id       TEXT NOT NULL,
  history_sequence INTEGER NOT NULL CHECK(history_sequence >= 0),
  input             TEXT NOT NULL,
  status            TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
  started_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  ended_at          TEXT,
  error_message     TEXT,
  model_provider    TEXT,
  deleted           INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0, 1))
);

INSERT INTO run_snapshot_revisions
  (session_id, request_id, history_sequence, input, status, started_at, updated_at, ended_at,
   error_message, model_provider, deleted)
SELECT
  session_id, request_id, history_sequence, input, status, started_at, updated_at, ended_at,
  error_message, model_provider, 0
FROM run_snapshots
ORDER BY session_id, history_sequence;

CREATE INDEX idx_run_snapshot_revisions_session_revision
  ON run_snapshot_revisions(session_id, revision_id);

CREATE INDEX idx_run_snapshot_revisions_session_history
  ON run_snapshot_revisions(session_id, history_sequence, revision_id);

CREATE INDEX idx_run_snapshot_revisions_request
  ON run_snapshot_revisions(session_id, request_id, revision_id DESC);

CREATE TRIGGER trg_run_snapshots_revision_insert
AFTER INSERT ON run_snapshots
BEGIN
  INSERT INTO run_snapshot_revisions
    (session_id, request_id, history_sequence, input, status, started_at, updated_at, ended_at,
     error_message, model_provider, deleted)
  VALUES
    (NEW.session_id, NEW.request_id, NEW.history_sequence, NEW.input, NEW.status, NEW.started_at,
     NEW.updated_at, NEW.ended_at, NEW.error_message, NEW.model_provider, 0);
END;

CREATE TRIGGER trg_run_snapshots_revision_update
AFTER UPDATE ON run_snapshots
WHEN OLD.input IS NOT NEW.input
  OR OLD.status IS NOT NEW.status
  OR OLD.started_at IS NOT NEW.started_at
  OR OLD.updated_at IS NOT NEW.updated_at
  OR OLD.ended_at IS NOT NEW.ended_at
  OR OLD.error_message IS NOT NEW.error_message
  OR OLD.model_provider IS NOT NEW.model_provider
BEGIN
  INSERT INTO run_snapshot_revisions
    (session_id, request_id, history_sequence, input, status, started_at, updated_at, ended_at,
     error_message, model_provider, deleted)
  VALUES
    (NEW.session_id, NEW.request_id, NEW.history_sequence, NEW.input, NEW.status, NEW.started_at,
     NEW.updated_at, NEW.ended_at, NEW.error_message, NEW.model_provider, 0);
END;

CREATE TRIGGER trg_run_snapshots_revision_delete
AFTER DELETE ON run_snapshots
BEGIN
  INSERT INTO run_snapshot_revisions
    (session_id, request_id, history_sequence, input, status, started_at, updated_at, ended_at,
     error_message, model_provider, deleted)
  VALUES
    (OLD.session_id, OLD.request_id, OLD.history_sequence, OLD.input, OLD.status, OLD.started_at,
     OLD.updated_at, OLD.ended_at, OLD.error_message, OLD.model_provider, 1);
END;

CREATE TRIGGER trg_sessions_run_snapshot_revisions_cleanup
AFTER DELETE ON sessions
BEGIN
  DELETE FROM run_snapshot_revisions WHERE session_id = OLD.id;
END;
