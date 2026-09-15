CREATE TABLE continuity_concepts (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  canonical_label TEXT NOT NULL,
  normalized_label TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'merged', 'retired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scope_kind, scope_id, normalized_label)
);

CREATE TABLE continuity_concept_aliases (
  concept_uri TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(concept_uri, normalized_alias),
  FOREIGN KEY(concept_uri) REFERENCES continuity_concepts(uri) ON DELETE CASCADE
);

CREATE TABLE continuity_record_concepts (
  record_uri TEXT NOT NULL,
  record_kind TEXT NOT NULL CHECK(record_kind IN ('fact', 'profile', 'signal', 'rule')),
  concept_uri TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  PRIMARY KEY(record_uri, record_kind),
  FOREIGN KEY(concept_uri) REFERENCES continuity_concepts(uri) ON DELETE CASCADE
);

CREATE INDEX idx_continuity_concepts_scope
  ON continuity_concepts(scope_kind, scope_id, status, updated_at);

CREATE INDEX idx_continuity_concept_alias_lookup
  ON continuity_concept_aliases(normalized_alias, concept_uri);

CREATE INDEX idx_continuity_record_concepts_concept
  ON continuity_record_concepts(concept_uri, record_kind, record_uri);
