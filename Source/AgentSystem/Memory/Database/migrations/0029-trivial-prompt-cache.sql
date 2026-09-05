-- Learned trivial-prompt cache: inputs whose extraction returned no facts.
-- A cached hash lets the learning gate skip re-running extraction on inputs
-- already proven unproductive, without any hand-maintained phrase list.

CREATE TABLE continuity_trivial_prompt_cache (
  prompt_hash TEXT PRIMARY KEY,
  occurrences INTEGER NOT NULL CHECK(occurrences >= 0),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX idx_continuity_trivial_prompt_cache_last_seen
  ON continuity_trivial_prompt_cache(last_seen_at DESC);
