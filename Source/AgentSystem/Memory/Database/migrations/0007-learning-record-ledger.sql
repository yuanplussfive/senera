DROP TABLE continuity_assertions;
DROP TABLE continuity_migrations;

DROP TABLE memory_observations;
DROP TABLE memory_item_vectors;
DROP TABLE memory_items;
DROP TABLE memory_candidates;
DROP TABLE memory_learning_jobs;

ALTER TABLE continuity_signals
  RENAME COLUMN source_observation_uris_json TO source_refs_json;

ALTER TABLE continuity_rules
  RENAME COLUMN source_observation_uris_json TO source_refs_json;
