ALTER TABLE workspace_observer_files
  ADD COLUMN scan_generation TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_workspace_observer_files_scan_generation
  ON workspace_observer_files(scan_generation);
