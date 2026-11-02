ALTER TABLE workspace_observer_files
  ADD COLUMN content_encoding TEXT NOT NULL DEFAULT 'utf8'
  CHECK(content_encoding IN ('utf8', 'base64'));
