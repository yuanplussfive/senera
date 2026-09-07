ALTER TABLE child_runs
  ADD COLUMN structured_result_json TEXT
  CHECK (structured_result_json IS NULL OR json_valid(structured_result_json));
