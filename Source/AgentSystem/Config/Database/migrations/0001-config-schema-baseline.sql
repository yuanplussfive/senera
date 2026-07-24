CREATE TABLE IF NOT EXISTS config_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS config_revisions (
  revision INTEGER PRIMARY KEY,
  config_json TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
