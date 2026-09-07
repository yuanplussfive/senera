-- Fact timeline: when the current claim version became authoritative and
-- which factKey a paraphrase-merged head folded into.

ALTER TABLE continuity_fact_heads ADD COLUMN valid_from TEXT NOT NULL DEFAULT '';

UPDATE continuity_fact_heads
SET valid_from = created_at
WHERE valid_from = '';

ALTER TABLE continuity_fact_heads ADD COLUMN superseded_by TEXT;

CREATE INDEX idx_continuity_fact_heads_superseded_by
  ON continuity_fact_heads(superseded_by);
