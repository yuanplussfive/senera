CREATE TABLE config_command_receipts (
  command_id TEXT PRIMARY KEY,
  operation_kind TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  revision INTEGER NOT NULL REFERENCES config_revisions(revision),
  created_at TEXT NOT NULL
) STRICT;
