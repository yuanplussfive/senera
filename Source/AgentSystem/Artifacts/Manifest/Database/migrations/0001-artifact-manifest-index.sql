CREATE TABLE artifact_manifest_index (
  artifact_root TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_uri TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  relative_dir TEXT NOT NULL,
  fingerprint_size INTEGER NOT NULL,
  fingerprint_mtime_ms REAL NOT NULL,
  fingerprint_ctime_ms REAL NOT NULL,
  fingerprint_ino INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('valid', 'invalid')),
  error_message TEXT,
  checkpoint_id TEXT,
  checkpoint_captured_at TEXT,
  scan_generation TEXT NOT NULL,
  PRIMARY KEY (artifact_root, artifact_id),
  UNIQUE (artifact_root, manifest_path),
  CHECK((status = 'valid' AND error_message IS NULL) OR (status = 'invalid' AND error_message IS NOT NULL))
) STRICT;

CREATE TABLE artifact_manifest_assets (
  artifact_root TEXT NOT NULL,
  resource_uri TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  PRIMARY KEY (artifact_root, resource_uri),
  FOREIGN KEY (artifact_root, artifact_id)
    REFERENCES artifact_manifest_index(artifact_root, artifact_id)
    ON DELETE CASCADE
) STRICT;

CREATE INDEX artifact_manifest_index_checkpoint
  ON artifact_manifest_index(artifact_root, checkpoint_id, checkpoint_captured_at);
CREATE INDEX artifact_manifest_assets_artifact
  ON artifact_manifest_assets(artifact_root, artifact_id);

CREATE TABLE artifact_manifest_invalid (
  artifact_root TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  fingerprint_size INTEGER NOT NULL,
  fingerprint_mtime_ms REAL NOT NULL,
  fingerprint_ctime_ms REAL NOT NULL,
  fingerprint_ino INTEGER NOT NULL,
  error_message TEXT NOT NULL,
  scan_generation TEXT NOT NULL,
  PRIMARY KEY (artifact_root, manifest_path)
) STRICT;
