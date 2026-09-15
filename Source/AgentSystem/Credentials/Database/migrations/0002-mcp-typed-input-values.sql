CREATE TABLE mcp_input_values (
  server_id TEXT NOT NULL CHECK (length(trim(server_id)) > 0),
  input_id TEXT NOT NULL CHECK (length(trim(input_id)) > 0),
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_id, input_id)
);

CREATE TABLE mcp_input_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0)
);

INSERT INTO mcp_input_state (singleton, revision) VALUES (1, 0);
