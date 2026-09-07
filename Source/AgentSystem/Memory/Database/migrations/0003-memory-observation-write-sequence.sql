ALTER TABLE memory_observations ADD COLUMN write_sequence INTEGER NOT NULL DEFAULT 0;
WITH ordered_observations AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY memory_uri ORDER BY rowid ASC) AS write_sequence
  FROM memory_observations
)
UPDATE memory_observations
SET write_sequence = (
  SELECT ordered.write_sequence
  FROM ordered_observations AS ordered
  WHERE ordered.id = memory_observations.id
);
DROP INDEX idx_memory_observations_memory_time;
CREATE UNIQUE INDEX idx_memory_observations_memory_sequence ON memory_observations(memory_uri, write_sequence);
CREATE INDEX idx_memory_observations_memory_time ON memory_observations(memory_uri, created_at_ms, write_sequence);
