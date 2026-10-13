CREATE TABLE workspace_observer_files (
  path_key TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('file', 'directory')),
  size INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  hash TEXT NOT NULL,
  content_state TEXT NOT NULL CHECK(content_state IN ('captured', 'omitted')),
  content_reason TEXT,
  content_ref TEXT,
  content_byte_length INTEGER,
  line_count INTEGER,
  CHECK(
    (content_state = 'captured' AND content_reason IS NULL AND content_ref IS NOT NULL AND line_count IS NOT NULL)
    OR
    (content_state = 'omitted' AND content_ref IS NULL AND line_count IS NULL)
  )
) WITHOUT ROWID, STRICT;

CREATE INDEX idx_workspace_observer_files_path
  ON workspace_observer_files(path);
