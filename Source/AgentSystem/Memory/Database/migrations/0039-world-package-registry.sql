CREATE TABLE agent_world_packages (
  world_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  definition_revision TEXT NOT NULL,
  source_uri TEXT NOT NULL,
  applied_event_uri TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY (world_id, package_id),
  FOREIGN KEY (world_id) REFERENCES agent_agenda_worlds(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_agent_world_packages_world_revision
  ON agent_world_packages(world_id, definition_revision);
