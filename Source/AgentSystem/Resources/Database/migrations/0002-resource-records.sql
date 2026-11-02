CREATE TABLE resource_records (
  resource_id TEXT PRIMARY KEY NOT NULL REFERENCES resource_id_reservations(resource_id),
  kind TEXT NOT NULL CHECK(kind IN ('artifact', 'file')),
  entity_id TEXT NOT NULL,
  locator TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending', 'ready', 'deleted')),
  UNIQUE(kind, entity_id)
) STRICT;

CREATE TABLE resource_uri_aliases (
  alias TEXT PRIMARY KEY NOT NULL,
  resource_id TEXT NOT NULL REFERENCES resource_records(resource_id)
) STRICT;
