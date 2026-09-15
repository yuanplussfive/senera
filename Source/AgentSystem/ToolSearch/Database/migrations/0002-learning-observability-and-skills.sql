CREATE TABLE learning_episodes (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL CHECK(domain IN ('tool_routing', 'skill_routing')),
  state TEXT NOT NULL CHECK(state IN ('observed', 'learned', 'skipped', 'failed')),
  reason TEXT NOT NULL,
  error TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  query TEXT NOT NULL,
  subjects_json TEXT NOT NULL,
  context_json TEXT NOT NULL,
  outcome_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_learning_episodes_project_time
  ON learning_episodes(project_id, updated_at_ms DESC);
CREATE INDEX idx_learning_episodes_request
  ON learning_episodes(request_id, domain, updated_at_ms DESC);
CREATE INDEX idx_learning_episodes_state
  ON learning_episodes(project_id, domain, state, updated_at_ms DESC);

CREATE TABLE skill_learning_terms (
  project_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  skill_revision TEXT NOT NULL,
  term TEXT NOT NULL,
  source TEXT NOT NULL,
  support REAL NOT NULL,
  weight REAL NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, skill_name, skill_revision, term, source)
);
CREATE INDEX idx_skill_learning_terms_project_skill
  ON skill_learning_terms(project_id, skill_name, skill_revision);
