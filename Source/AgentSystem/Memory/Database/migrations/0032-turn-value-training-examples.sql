DROP INDEX idx_continuity_trivial_prompt_cache_last_seen;

ALTER TABLE continuity_trivial_prompt_cache RENAME TO continuity_turn_value_examples;

ALTER TABLE continuity_turn_value_examples ADD COLUMN prompt_text TEXT NOT NULL DEFAULT '';
ALTER TABLE continuity_turn_value_examples ADD COLUMN label TEXT NOT NULL DEFAULT 'unproductive'
  CHECK (label IN ('valuable', 'unproductive'));

CREATE UNIQUE INDEX idx_continuity_turn_value_examples_identity
  ON continuity_turn_value_examples(prompt_hash, label);

CREATE INDEX idx_continuity_turn_value_examples_last_seen
  ON continuity_turn_value_examples(last_seen_at DESC, prompt_hash ASC);
