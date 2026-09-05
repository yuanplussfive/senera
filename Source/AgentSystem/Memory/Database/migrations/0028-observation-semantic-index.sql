-- Semantic recall index: write-time embeddings for learned observations.
-- Absence of a row simply means the record ranks on lexical evidence only.

CREATE TABLE continuity_observation_embeddings (
  observation_uri TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  text_sha256 TEXT NOT NULL,
  vector_json TEXT NOT NULL CHECK(json_valid(vector_json)),
  dimensions INTEGER NOT NULL CHECK(dimensions > 0),
  embedded_at TEXT NOT NULL
);

CREATE INDEX idx_continuity_observation_embeddings_model
  ON continuity_observation_embeddings(model, embedded_at DESC);
