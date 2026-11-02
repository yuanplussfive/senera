ALTER TABLE child_runs
  ADD COLUMN join_group_json TEXT
  CHECK (join_group_json IS NULL OR json_valid(join_group_json));

CREATE INDEX child_runs_join_group_idx
  ON child_runs (json_extract(join_group_json, '$.id'), status, created_at);
