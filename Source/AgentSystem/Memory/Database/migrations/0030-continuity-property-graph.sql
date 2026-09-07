-- Property graph foundation for host-owned continuity entities and evidence-backed relations.

CREATE TABLE continuity_concepts_next (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  canonical_label TEXT NOT NULL,
  normalized_label TEXT NOT NULL,
  entity_kind TEXT NOT NULL DEFAULT 'concept'
    CHECK(entity_kind IN (
      'concept', 'person', 'organization', 'place', 'time', 'event', 'topic',
      'artifact', 'preference', 'state', 'goal', 'task', 'conversation'
    )),
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'merged', 'retired')),
  merged_into_uri TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO continuity_concepts_next (
  id, uri, canonical_label, normalized_label, entity_kind,
  scope_kind, scope_id, status, merged_into_uri, created_at, updated_at
)
SELECT id, uri, canonical_label, normalized_label, 'concept',
       scope_kind, scope_id, status, merged_into_uri, created_at, updated_at
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
SELECT concept_uri, alias, normalized_alias, created_at
FROM continuity_concept_aliases;

CREATE TABLE continuity_record_concepts_next (
  record_uri TEXT NOT NULL,
  record_kind TEXT NOT NULL CHECK(record_kind IN ('fact', 'profile', 'signal', 'rule')),
  concept_uri TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  PRIMARY KEY(record_uri, record_kind, concept_uri),
  FOREIGN KEY(concept_uri) REFERENCES continuity_concepts_next(uri) ON DELETE CASCADE
);

INSERT INTO continuity_record_concepts_next (record_uri, record_kind, concept_uri, linked_at)
SELECT record_uri, record_kind, concept_uri, linked_at
FROM continuity_record_concepts;

DROP TABLE continuity_concept_aliases;
DROP TABLE continuity_record_concepts;
DROP TABLE continuity_concepts;

ALTER TABLE continuity_concepts_next RENAME TO continuity_concepts;
ALTER TABLE continuity_concept_aliases_next RENAME TO continuity_concept_aliases;
ALTER TABLE continuity_record_concepts_next RENAME TO continuity_record_concepts;

CREATE UNIQUE INDEX idx_continuity_concepts_active_label
  ON continuity_concepts(scope_kind, scope_id, normalized_label) WHERE status = 'active';

CREATE INDEX idx_continuity_concepts_scope
  ON continuity_concepts(scope_kind, scope_id, status, entity_kind, updated_at);

CREATE INDEX idx_continuity_concepts_merged_into
  ON continuity_concepts(merged_into_uri);

CREATE INDEX idx_continuity_concept_alias_lookup
  ON continuity_concept_aliases(normalized_alias, concept_uri);

CREATE INDEX idx_continuity_record_concepts_concept
  ON continuity_record_concepts(concept_uri, record_kind, record_uri);

CREATE INDEX idx_continuity_record_concepts_record
  ON continuity_record_concepts(record_uri, record_kind, linked_at);

CREATE TABLE continuity_concept_relations (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  subject_uri TEXT NOT NULL,
  relation_id TEXT NOT NULL,
  object_uri TEXT NOT NULL,
  temporal_kind TEXT NOT NULL CHECK(temporal_kind IN ('persistent', 'instant', 'interval', 'until_condition', 'recurring')),
  valid_from TEXT,
  valid_until TEXT,
  time_zone TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'superseded', 'retracted')),
  authority TEXT NOT NULL CHECK(authority IN ('user_explicit', 'tool_verified', 'system_observed', 'model_inferred')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  source_refs_json TEXT NOT NULL CHECK(json_valid(source_refs_json)),
  support_count INTEGER NOT NULL CHECK(support_count >= 0),
  support_mass REAL NOT NULL CHECK(support_mass >= 0 AND support_mass <= 1),
  maturity TEXT NOT NULL CHECK(maturity IN ('candidate', 'active', 'established')),
  superseded_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scope_kind, scope_id, subject_uri, relation_id, object_uri),
  FOREIGN KEY(subject_uri) REFERENCES continuity_concepts(uri) ON DELETE RESTRICT,
  FOREIGN KEY(object_uri) REFERENCES continuity_concepts(uri) ON DELETE RESTRICT,
  FOREIGN KEY(superseded_by) REFERENCES continuity_concept_relations(uri) ON DELETE SET NULL
);

CREATE TABLE continuity_concept_relation_evidence (
  relation_uri TEXT NOT NULL,
  evidence_key TEXT NOT NULL,
  source_refs_json TEXT NOT NULL CHECK(json_valid(source_refs_json)),
  authority TEXT NOT NULL CHECK(authority IN ('user_explicit', 'tool_verified', 'system_observed', 'model_inferred')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  observed_at TEXT NOT NULL,
  PRIMARY KEY(relation_uri, evidence_key),
  FOREIGN KEY(relation_uri) REFERENCES continuity_concept_relations(uri) ON DELETE CASCADE
);

CREATE TABLE continuity_concept_relation_history (
  id TEXT PRIMARY KEY,
  relation_uri TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('created', 'reinforced', 'superseded', 'retracted')),
  source_refs_json TEXT NOT NULL CHECK(json_valid(source_refs_json)),
  authority TEXT NOT NULL CHECK(authority IN ('user_explicit', 'tool_verified', 'system_observed', 'model_inferred')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY(relation_uri) REFERENCES continuity_concept_relations(uri) ON DELETE CASCADE
);

CREATE INDEX idx_continuity_concept_relations_scope
  ON continuity_concept_relations(scope_kind, scope_id, status, updated_at DESC);

CREATE INDEX idx_continuity_concept_relations_subject
  ON continuity_concept_relations(scope_kind, scope_id, subject_uri, status, relation_id);

CREATE INDEX idx_continuity_concept_relations_object
  ON continuity_concept_relations(scope_kind, scope_id, object_uri, status, relation_id);

CREATE INDEX idx_continuity_concept_relation_evidence_source
  ON continuity_concept_relation_evidence(evidence_key);

CREATE INDEX idx_continuity_concept_relation_history_relation
  ON continuity_concept_relation_history(relation_uri, occurred_at DESC);
