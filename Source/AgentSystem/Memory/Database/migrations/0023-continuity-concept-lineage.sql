CREATE TABLE continuity_concepts_next (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  canonical_label TEXT NOT NULL,
  normalized_label TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'merged', 'retired')),
  merged_into_uri TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO continuity_concepts_next
  (id, uri, canonical_label, normalized_label, scope_kind, scope_id, status, merged_into_uri, created_at, updated_at)
SELECT id, uri, canonical_label, normalized_label, scope_kind, scope_id, status, NULL, created_at, updated_at
FROM continuity_concepts;

CREATE TABLE continuity_concept_aliases_next (
  concept_uri TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(concept_uri, normalized_alias),
  FOREIGN KEY(concept_uri) REFERENCES continuity_concepts_next(uri) ON DELETE CASCADE
);

INSERT INTO continuity_concept_aliases_next (concept_uri, alias, normalized_alias, created_at)
SELECT concept_uri, alias, normalized_alias, created_at FROM continuity_concept_aliases;

CREATE TABLE continuity_record_concepts_next (
  record_uri TEXT NOT NULL,
  record_kind TEXT NOT NULL CHECK(record_kind IN ('fact', 'profile', 'signal', 'rule')),
  concept_uri TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  PRIMARY KEY(record_uri, record_kind),
  FOREIGN KEY(concept_uri) REFERENCES continuity_concepts_next(uri) ON DELETE CASCADE
);

INSERT INTO continuity_record_concepts_next (record_uri, record_kind, concept_uri, linked_at)
SELECT record_uri, record_kind, concept_uri, linked_at FROM continuity_record_concepts;

DROP TABLE continuity_concept_aliases;
DROP TABLE continuity_record_concepts;
DROP TABLE continuity_concepts;

ALTER TABLE continuity_concepts_next RENAME TO continuity_concepts;
ALTER TABLE continuity_concept_aliases_next RENAME TO continuity_concept_aliases;
ALTER TABLE continuity_record_concepts_next RENAME TO continuity_record_concepts;

CREATE UNIQUE INDEX idx_continuity_concepts_active_label
  ON continuity_concepts(scope_kind, scope_id, normalized_label) WHERE status = 'active';

CREATE INDEX idx_continuity_concepts_scope
  ON continuity_concepts(scope_kind, scope_id, status, updated_at);

CREATE INDEX idx_continuity_concepts_merged_into
  ON continuity_concepts(merged_into_uri);

CREATE INDEX idx_continuity_concept_alias_lookup
  ON continuity_concept_aliases(normalized_alias, concept_uri);

CREATE INDEX idx_continuity_record_concepts_concept
  ON continuity_record_concepts(concept_uri, record_kind, record_uri);
