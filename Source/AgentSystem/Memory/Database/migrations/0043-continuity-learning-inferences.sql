DROP INDEX IF EXISTS idx_continuity_trivial_prompt_cache_last_seen;
DROP TABLE IF EXISTS continuity_trivial_prompt_cache;

CREATE TABLE continuity_learning_inferences (
  inference_key TEXT PRIMARY KEY,
  stage TEXT NOT NULL CHECK(stage IN ('facts', 'rules')),
  contract_revision TEXT NOT NULL,
  bundle_revision TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_json TEXT NOT NULL CHECK(json_valid(input_json)),
  output_json TEXT NOT NULL CHECK(json_valid(output_json)),
  feature_keys_json TEXT NOT NULL CHECK(json_valid(feature_keys_json) AND json_type(feature_keys_json) = 'array'),
  accepted_item_count INTEGER NOT NULL CHECK(accepted_item_count >= 0),
  source_episode_uri TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  last_used_at TEXT NOT NULL,
  last_used_at_ms INTEGER NOT NULL,
  use_count INTEGER NOT NULL CHECK(use_count >= 1),
  FOREIGN KEY (source_episode_uri) REFERENCES memory_episodes(uri) ON DELETE CASCADE
);

CREATE INDEX idx_continuity_learning_inferences_examples
  ON continuity_learning_inferences(stage, contract_revision, accepted_item_count DESC, last_used_at_ms DESC);

CREATE INDEX idx_continuity_learning_inferences_source
  ON continuity_learning_inferences(source_episode_uri);
