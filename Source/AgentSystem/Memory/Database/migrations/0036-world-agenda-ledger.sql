CREATE TABLE agent_agenda_worlds (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  time_zone TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE agent_agenda_actors (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  world_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'resident', 'system')),
  created_at TEXT NOT NULL,
  UNIQUE(world_id, role),
  FOREIGN KEY(world_id) REFERENCES agent_agenda_worlds(id) ON DELETE CASCADE
);

CREATE TABLE agent_agenda_records (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  world_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('goal', 'activity', 'event', 'schedule')),
  created_at TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES agent_agenda_worlds(id) ON DELETE CASCADE,
  FOREIGN KEY(actor_id) REFERENCES agent_agenda_actors(id) ON DELETE RESTRICT
);

CREATE TABLE agent_agenda_events (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  record_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  event_kind TEXT NOT NULL CHECK(event_kind IN ('declared', 'started', 'progressed', 'paused', 'finished', 'cancelled', 'occurred', 'due', 'evidence_attached')),
  mutation_json TEXT NOT NULL CHECK(json_valid(mutation_json)),
  source_refs_json TEXT NOT NULL CHECK(json_valid(source_refs_json) AND json_array_length(source_refs_json) > 0),
  authority TEXT NOT NULL CHECK(authority IN ('user_explicit', 'tool_verified', 'world_definition', 'host')),
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  UNIQUE(record_id, sequence),
  FOREIGN KEY(record_id) REFERENCES agent_agenda_records(id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_agenda_records_world
  ON agent_agenda_records(world_id, created_at, id);

CREATE INDEX idx_agent_agenda_events_record_time
  ON agent_agenda_events(record_id, occurred_at, recorded_at, id);

CREATE INDEX idx_agent_agenda_events_local_date
  ON agent_agenda_events(local_date, occurred_at, id);
