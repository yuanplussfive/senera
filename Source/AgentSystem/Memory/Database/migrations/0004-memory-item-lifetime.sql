CREATE TABLE memory_items_v4 (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  claim TEXT NOT NULL,
  how_to_apply TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  triggers_json TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence REAL NOT NULL,
  session_id TEXT NOT NULL,
  source_episode_uri TEXT NOT NULL,
  source_request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  time_zone TEXT NOT NULL,
  local_date TEXT NOT NULL,
  local_hour TEXT NOT NULL,
  metadata_json TEXT NOT NULL
);

INSERT INTO memory_items_v4 (
  id,
  uri,
  type,
  subject,
  claim,
  how_to_apply,
  tags_json,
  triggers_json,
  source_refs_json,
  status,
  confidence,
  session_id,
  source_episode_uri,
  source_request_id,
  created_at,
  updated_at,
  created_at_ms,
  updated_at_ms,
  time_zone,
  local_date,
  local_hour,
  metadata_json
)
SELECT
  id,
  uri,
  type,
  subject,
  claim,
  how_to_apply,
  tags_json,
  triggers_json,
  source_refs_json,
  status,
  confidence,
  session_id,
  source_episode_uri,
  source_request_id,
  created_at,
  updated_at,
  created_at_ms,
  updated_at_ms,
  time_zone,
  local_date,
  local_hour,
  metadata_json
FROM memory_items;

CREATE TABLE memory_item_vectors_v4 (
  memory_uri TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  embedding_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY(memory_uri, model),
  FOREIGN KEY (memory_uri) REFERENCES memory_items_v4(uri) ON DELETE CASCADE
);

INSERT INTO memory_item_vectors_v4 (
  memory_uri,
  model,
  dimensions,
  embedding_json,
  updated_at,
  updated_at_ms
)
SELECT
  memory_uri,
  model,
  dimensions,
  embedding_json,
  updated_at,
  updated_at_ms
FROM memory_item_vectors;

CREATE TABLE memory_observations_v4 (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  memory_uri TEXT NOT NULL,
  operation TEXT NOT NULL,
  candidate_uris_json TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  confidence REAL NOT NULL,
  session_id TEXT NOT NULL,
  source_episode_uri TEXT NOT NULL,
  source_request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  time_zone TEXT NOT NULL,
  local_date TEXT NOT NULL,
  local_hour TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  write_sequence INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (memory_uri) REFERENCES memory_items_v4(uri) ON DELETE CASCADE,
  FOREIGN KEY (source_episode_uri) REFERENCES memory_episodes(uri) ON DELETE CASCADE
);

INSERT INTO memory_observations_v4 (
  id,
  uri,
  memory_uri,
  operation,
  candidate_uris_json,
  source_refs_json,
  reason,
  confidence,
  session_id,
  source_episode_uri,
  source_request_id,
  created_at,
  created_at_ms,
  time_zone,
  local_date,
  local_hour,
  metadata_json,
  write_sequence
)
SELECT
  id,
  uri,
  memory_uri,
  operation,
  candidate_uris_json,
  source_refs_json,
  reason,
  confidence,
  session_id,
  source_episode_uri,
  source_request_id,
  created_at,
  created_at_ms,
  time_zone,
  local_date,
  local_hour,
  metadata_json,
  write_sequence
FROM memory_observations;

DROP TABLE memory_observations;
DROP TABLE memory_item_vectors;
DROP TABLE memory_items;

ALTER TABLE memory_items_v4 RENAME TO memory_items;
ALTER TABLE memory_item_vectors_v4 RENAME TO memory_item_vectors;
ALTER TABLE memory_observations_v4 RENAME TO memory_observations;

CREATE INDEX idx_memory_items_status_type ON memory_items(status, type, updated_at_ms);
CREATE INDEX idx_memory_items_session_time ON memory_items(session_id, updated_at_ms);
CREATE INDEX idx_memory_items_local_date ON memory_items(time_zone, local_date, updated_at_ms);
CREATE INDEX idx_memory_item_vectors_model ON memory_item_vectors(model, updated_at_ms);
CREATE UNIQUE INDEX idx_memory_observations_memory_sequence
  ON memory_observations(memory_uri, write_sequence);
CREATE INDEX idx_memory_observations_memory_time
  ON memory_observations(memory_uri, created_at_ms, write_sequence);
CREATE INDEX idx_memory_observations_session_time ON memory_observations(session_id, created_at_ms);
