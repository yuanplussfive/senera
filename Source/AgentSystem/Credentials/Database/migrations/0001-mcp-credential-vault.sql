CREATE TABLE mcp_credentials (
  server_id TEXT NOT NULL CHECK (length(trim(server_id)) > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  value_envelope TEXT NOT NULL CHECK (length(value_envelope) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_id, name)
);

CREATE TABLE mcp_credential_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0)
);

INSERT INTO mcp_credential_state (singleton, revision) VALUES (1, 0);
