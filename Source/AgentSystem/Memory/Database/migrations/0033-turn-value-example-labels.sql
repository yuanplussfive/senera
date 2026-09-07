DROP INDEX idx_continuity_turn_value_examples_identity;
DROP INDEX idx_continuity_turn_value_examples_last_seen;

CREATE TABLE continuity_turn_value_examples_v2 (
  prompt_hash TEXT NOT NULL,
  occurrences INTEGER NOT NULL CHECK (occurrences >= 0),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  prompt_text TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL CHECK (label IN ('valuable', 'unproductive')),
  PRIMARY KEY (prompt_hash, label)
);

INSERT INTO continuity_turn_value_examples_v2
  (prompt_hash, occurrences, first_seen_at, last_seen_at, prompt_text, label)
SELECT prompt_hash, occurrences, first_seen_at, last_seen_at, prompt_text, label
FROM continuity_turn_value_examples;

DROP TABLE continuity_turn_value_examples;
ALTER TABLE continuity_turn_value_examples_v2 RENAME TO continuity_turn_value_examples;

CREATE INDEX idx_continuity_turn_value_examples_last_seen
  ON continuity_turn_value_examples(last_seen_at DESC, prompt_hash ASC);
