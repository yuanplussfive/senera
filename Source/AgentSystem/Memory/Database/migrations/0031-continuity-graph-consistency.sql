-- Keep graph snapshots coherent across all repositories sharing the memory database.

INSERT INTO memory_catalog_state (catalog, revision)
VALUES ('continuity_graph', 0)
ON CONFLICT(catalog) DO NOTHING;

-- The association table cannot declare foreign keys to every record ledger. Remove
-- links left by older runtimes before the delete triggers take over.
DELETE FROM continuity_record_concepts
WHERE (record_kind = 'fact' AND NOT EXISTS (
  SELECT 1 FROM continuity_observations WHERE continuity_observations.uri = continuity_record_concepts.record_uri
))
   OR (record_kind = 'profile' AND NOT EXISTS (
  SELECT 1 FROM resident_profile_records WHERE resident_profile_records.uri = continuity_record_concepts.record_uri
))
   OR record_kind = 'signal'
   OR (record_kind = 'rule' AND NOT EXISTS (
  SELECT 1 FROM continuity_rules WHERE continuity_rules.uri = continuity_record_concepts.record_uri
));

DELETE FROM continuity_concepts
WHERE status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM continuity_record_concepts
    WHERE continuity_record_concepts.concept_uri = continuity_concepts.uri
  )
  AND NOT EXISTS (
    SELECT 1 FROM continuity_concept_relations
    WHERE continuity_concept_relations.subject_uri = continuity_concepts.uri
       OR continuity_concept_relations.object_uri = continuity_concepts.uri
  );

CREATE TRIGGER continuity_concept_graph_revision_insert
AFTER INSERT ON continuity_concepts
BEGIN
  UPDATE memory_catalog_state SET revision = revision + 1 WHERE catalog = 'continuity_graph';
END;

CREATE TRIGGER continuity_concept_graph_revision_update
AFTER UPDATE ON continuity_concepts
BEGIN
  UPDATE memory_catalog_state SET revision = revision + 1 WHERE catalog = 'continuity_graph';
END;

CREATE TRIGGER continuity_concept_graph_revision_delete
AFTER DELETE ON continuity_concepts
BEGIN
  UPDATE memory_catalog_state SET revision = revision + 1 WHERE catalog = 'continuity_graph';
END;

CREATE TRIGGER continuity_concept_alias_graph_revision_insert
AFTER INSERT ON continuity_concept_aliases
BEGIN
  UPDATE memory_catalog_state SET revision = revision + 1 WHERE catalog = 'continuity_graph';
END;

CREATE TRIGGER continuity_concept_alias_graph_revision_update
AFTER UPDATE ON continuity_concept_aliases
BEGIN
  UPDATE memory_catalog_state SET revision = revision + 1 WHERE catalog = 'continuity_graph';
END;

CREATE TRIGGER continuity_concept_alias_graph_revision_delete
AFTER DELETE ON continuity_concept_aliases
BEGIN
  UPDATE memory_catalog_state SET revision = revision + 1 WHERE catalog = 'continuity_graph';
END;

CREATE TRIGGER continuity_record_concept_graph_revision_insert
AFTER INSERT ON continuity_record_concepts
BEGIN
  UPDATE memory_catalog_state SET revision = revision + 1 WHERE catalog = 'continuity_graph';
END;

CREATE TRIGGER continuity_record_concept_graph_revision_update
AFTER UPDATE ON continuity_record_concepts
BEGIN
  UPDATE memory_catalog_state SET revision = revision + 1 WHERE catalog = 'continuity_graph';
END;

CREATE TRIGGER continuity_record_concept_graph_revision_delete
AFTER DELETE ON continuity_record_concepts
BEGIN
  UPDATE memory_catalog_state SET revision = revision + 1 WHERE catalog = 'continuity_graph';
END;

CREATE TRIGGER continuity_relation_graph_revision_insert
AFTER INSERT ON continuity_concept_relations
BEGIN
  UPDATE memory_catalog_state SET revision = revision + 1 WHERE catalog = 'continuity_graph';
END;

CREATE TRIGGER continuity_relation_graph_revision_update
AFTER UPDATE ON continuity_concept_relations
BEGIN
  UPDATE memory_catalog_state SET revision = revision + 1 WHERE catalog = 'continuity_graph';
END;

CREATE TRIGGER continuity_relation_graph_revision_delete
AFTER DELETE ON continuity_concept_relations
BEGIN
  UPDATE memory_catalog_state SET revision = revision + 1 WHERE catalog = 'continuity_graph';
END;

CREATE TRIGGER continuity_relation_evidence_graph_revision_insert
AFTER INSERT ON continuity_concept_relation_evidence
BEGIN
  UPDATE memory_catalog_state SET revision = revision + 1 WHERE catalog = 'continuity_graph';
END;

CREATE TRIGGER continuity_relation_evidence_graph_revision_update
AFTER UPDATE ON continuity_concept_relation_evidence
BEGIN
  UPDATE memory_catalog_state SET revision = revision + 1 WHERE catalog = 'continuity_graph';
END;

CREATE TRIGGER continuity_relation_evidence_graph_revision_delete
AFTER DELETE ON continuity_concept_relation_evidence
BEGIN
  UPDATE memory_catalog_state SET revision = revision + 1 WHERE catalog = 'continuity_graph';
END;

CREATE TRIGGER continuity_observation_concept_links_delete
AFTER DELETE ON continuity_observations
BEGIN
  DELETE FROM continuity_record_concepts
  WHERE record_kind = 'fact' AND record_uri = OLD.uri;
  DELETE FROM continuity_concepts
  WHERE status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM continuity_record_concepts
      WHERE continuity_record_concepts.concept_uri = continuity_concepts.uri
    )
    AND NOT EXISTS (
      SELECT 1 FROM continuity_concept_relations
      WHERE continuity_concept_relations.subject_uri = continuity_concepts.uri
         OR continuity_concept_relations.object_uri = continuity_concepts.uri
    );
END;

CREATE TRIGGER resident_profile_concept_links_delete
AFTER DELETE ON resident_profile_records
BEGIN
  DELETE FROM continuity_record_concepts
  WHERE record_kind = 'profile' AND record_uri = OLD.uri;
  DELETE FROM continuity_concepts
  WHERE status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM continuity_record_concepts
      WHERE continuity_record_concepts.concept_uri = continuity_concepts.uri
    )
    AND NOT EXISTS (
      SELECT 1 FROM continuity_concept_relations
      WHERE continuity_concept_relations.subject_uri = continuity_concepts.uri
         OR continuity_concept_relations.object_uri = continuity_concepts.uri
    );
END;

CREATE TRIGGER continuity_signal_concept_links_delete
AFTER DELETE ON continuity_signals
BEGIN
  DELETE FROM continuity_record_concepts
  WHERE record_kind = 'signal';
  DELETE FROM continuity_concepts
  WHERE status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM continuity_record_concepts
      WHERE continuity_record_concepts.concept_uri = continuity_concepts.uri
    )
    AND NOT EXISTS (
      SELECT 1 FROM continuity_concept_relations
      WHERE continuity_concept_relations.subject_uri = continuity_concepts.uri
         OR continuity_concept_relations.object_uri = continuity_concepts.uri
    );
END;

CREATE TRIGGER continuity_rule_concept_links_delete
AFTER DELETE ON continuity_rules
BEGIN
  DELETE FROM continuity_record_concepts
  WHERE record_kind = 'rule' AND record_uri = OLD.uri;
  DELETE FROM continuity_concepts
  WHERE status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM continuity_record_concepts
      WHERE continuity_record_concepts.concept_uri = continuity_concepts.uri
    )
    AND NOT EXISTS (
      SELECT 1 FROM continuity_concept_relations
      WHERE continuity_concept_relations.subject_uri = continuity_concepts.uri
         OR continuity_concept_relations.object_uri = continuity_concepts.uri
    );
END;
