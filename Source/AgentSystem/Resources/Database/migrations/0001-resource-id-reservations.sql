CREATE TABLE resource_id_reservations (
  resource_id TEXT PRIMARY KEY NOT NULL,
  owner_key TEXT UNIQUE,
  allocated_at TEXT NOT NULL
) STRICT;
