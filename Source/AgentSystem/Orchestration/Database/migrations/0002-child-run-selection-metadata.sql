ALTER TABLE child_runs
  ADD COLUMN model_selection_source TEXT
  CHECK (model_selection_source IS NULL OR model_selection_source IN ('extension_default', 'parent', 'runtime_default'));

ALTER TABLE child_runs
  ADD COLUMN selected_skills_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(selected_skills_json));

ALTER TABLE child_runs
  ADD COLUMN configuration_revision INTEGER
  CHECK (configuration_revision IS NULL OR configuration_revision >= 0);
