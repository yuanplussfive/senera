CREATE TABLE memory_catalog_state (
  catalog TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision >= 0)
);

INSERT INTO memory_catalog_state (catalog, revision)
VALUES ('physical_history', 0);

CREATE TRIGGER memory_episodes_catalog_revision_insert
AFTER INSERT ON memory_episodes
BEGIN
  UPDATE memory_catalog_state
  SET revision = revision + 1
  WHERE catalog = 'physical_history';
END;

CREATE TRIGGER memory_episodes_catalog_revision_update
AFTER UPDATE ON memory_episodes
BEGIN
  UPDATE memory_catalog_state
  SET revision = revision + 1
  WHERE catalog = 'physical_history';
END;

CREATE TRIGGER memory_episodes_catalog_revision_delete
AFTER DELETE ON memory_episodes
BEGIN
  UPDATE memory_catalog_state
  SET revision = revision + 1
  WHERE catalog = 'physical_history';
END;

CREATE TRIGGER memory_sources_catalog_revision_insert
AFTER INSERT ON memory_sources
BEGIN
  UPDATE memory_catalog_state
  SET revision = revision + 1
  WHERE catalog = 'physical_history';
END;

CREATE TRIGGER memory_sources_catalog_revision_update
AFTER UPDATE ON memory_sources
BEGIN
  UPDATE memory_catalog_state
  SET revision = revision + 1
  WHERE catalog = 'physical_history';
END;

CREATE TRIGGER memory_sources_catalog_revision_delete
AFTER DELETE ON memory_sources
BEGIN
  UPDATE memory_catalog_state
  SET revision = revision + 1
  WHERE catalog = 'physical_history';
END;
