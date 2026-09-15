CREATE TABLE agent_world_events (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  world_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  subject_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  changes_json TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  FOREIGN KEY (world_id) REFERENCES agent_agenda_worlds(id) ON DELETE CASCADE,
  UNIQUE(world_id, sequence)
) STRICT;

CREATE INDEX idx_agent_world_events_world_time
  ON agent_world_events(world_id, occurred_at, sequence);
CREATE INDEX idx_agent_world_events_world_subject
  ON agent_world_events(world_id, subject_id, sequence);

CREATE TABLE agent_world_clock (
  world_id TEXT PRIMARY KEY,
  last_advanced_at TEXT NOT NULL,
  next_wake_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (world_id) REFERENCES agent_agenda_worlds(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE agent_world_machine_snapshots (
  world_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  definition_revision TEXT NOT NULL,
  history_revision TEXT NOT NULL,
  through_sequence INTEGER NOT NULL CHECK(through_sequence >= 0),
  snapshot_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (world_id, actor_id, machine_id),
  FOREIGN KEY (world_id) REFERENCES agent_agenda_worlds(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE agent_world_machine_definitions (
  world_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  definition_revision TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (world_id, machine_id),
  FOREIGN KEY (world_id) REFERENCES agent_agenda_worlds(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE agent_world_habits (
  world_id TEXT NOT NULL,
  habit_id TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  definition_revision TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (world_id, habit_id),
  FOREIGN KEY (world_id) REFERENCES agent_agenda_worlds(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE agent_world_habit_occurrences (
  world_id TEXT NOT NULL,
  habit_id TEXT NOT NULL,
  occurrence_at TEXT NOT NULL,
  eligible_until TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('pending', 'applied', 'skipped')),
  event_uri TEXT,
  reason TEXT,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (world_id, habit_id, occurrence_at),
  FOREIGN KEY (world_id, habit_id) REFERENCES agent_world_habits(world_id, habit_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_agent_world_habit_occurrences_due
  ON agent_world_habit_occurrences(world_id, occurrence_at, outcome);

UPDATE continuity_concept_relations
   SET relation_id = 'lives_at'
 WHERE relation_id = 'lives_in';
