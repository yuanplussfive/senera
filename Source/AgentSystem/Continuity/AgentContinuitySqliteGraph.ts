import type Database from "better-sqlite3";
import {
  normalizeAgentContinuityScope,
  type AgentContinuityAuthority,
  type AgentContinuityScopeRef,
  type AgentContinuityTemporalWindow,
} from "./AgentContinuityDomain.js";
import { groupAgentContinuityEvidenceByEpisode } from "./AgentContinuityEvidenceIdentity.js";
import { pruneAgentContinuitySourceReferences } from "./AgentContinuitySourceReferences.js";
import {
  agentContinuityRelationMaturityRank,
  assertAgentContinuityRelationEndpoints,
  getAgentContinuityRelationDefinition,
  resolveAgentContinuityRelationMaturity,
  type AgentContinuityEntityKind,
  type AgentContinuityRelationDefinition,
} from "./AgentContinuityRelationCatalog.js";
import {
  AgentContinuityRuleConsolidationDefaults,
  type AgentContinuityRuleConsolidationPolicy,
} from "./AgentContinuityRuleConsolidationPolicy.js";
import type {
  AgentContinuityGraphEntity,
  AgentContinuityGraphRelation,
  AgentContinuityGraphRelationDraft,
  AgentContinuityGraphRelationQuery,
  AgentContinuityGraphSnapshot,
} from "./AgentContinuityGraphTypes.js";
import {
  compareAgentContinuityAuthorities,
  strongestAgentContinuityAuthority,
} from "./AgentContinuityAuthorityPolicy.js";
import {
  createId,
  json,
  normalizeScopes,
  normalizeTimestamp,
  stringArray,
  uniqueStrings,
} from "./AgentContinuitySqliteUtils.js";

export const AgentContinuityGraphCatalogName = "continuity_graph";

export function continuityGraphCatalogRevision(db: Database.Database): number {
  const row = db
    .prepare<[string], { revision: number }>("SELECT revision FROM memory_catalog_state WHERE catalog = ?")
    .get(AgentContinuityGraphCatalogName);
  if (!row) throw new Error("Continuity graph catalog revision is not initialized.");
  return row.revision;
}

interface GraphEntityRow {
  readonly uri: string;
  readonly canonical_label: string;
  readonly entity_kind: AgentContinuityEntityKind;
  readonly scope_kind: AgentContinuityScopeRef["kind"];
  readonly scope_id: string;
  readonly status: "active" | "merged" | "retired";
  readonly merged_into_uri: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface RelationRow {
  readonly id: string;
  readonly uri: string;
  readonly scope_kind: AgentContinuityScopeRef["kind"];
  readonly scope_id: string;
  readonly subject_uri: string;
  readonly relation_id: string;
  readonly object_uri: string;
  readonly temporal_kind: AgentContinuityTemporalWindow["kind"];
  readonly valid_from: string | null;
  readonly valid_until: string | null;
  readonly time_zone: string;
  readonly status: "active" | "superseded" | "retracted";
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
  readonly source_refs_json: string;
  readonly support_count: number;
  readonly support_mass: number;
  readonly maturity: "candidate" | "active" | "established";
  readonly superseded_by: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface RelationEvidenceRow {
  readonly relation_uri: string;
  readonly evidence_key: string;
  readonly source_refs_json: string;
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
  readonly observed_at: string;
}

interface RelationHistoryRow {
  readonly id: string;
  readonly relation_uri: string;
  readonly operation: "created" | "reinforced" | "superseded" | "retracted";
  readonly source_refs_json: string;
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
  readonly occurred_at: string;
}

export function recordAgentContinuityGraphRelation(
  db: Database.Database,
  input: AgentContinuityGraphRelationDraft,
  policy: AgentContinuityRuleConsolidationPolicy = AgentContinuityRuleConsolidationDefaults,
): AgentContinuityGraphRelation {
  const scope = normalizeAgentContinuityScope(input.scope);
  const sourceRefs = uniqueStrings(input.sourceRefs);
  if (sourceRefs.length === 0) throw new Error("Continuity relation requires at least one physical source reference.");
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new Error("Continuity relation confidence must be between 0 and 1.");
  }
  const observedAt = normalizeTimestamp(input.observedAt, "Continuity relation observation time");
  const temporal = normalizeTemporal(input.temporal);
  const endpoints = readRelationEndpoints(db, scope, input.subjectUri, input.objectUri);
  const definition = assertAgentContinuityRelationEndpoints({
    relationId: input.relationId,
    subject: { uri: endpoints.subject.uri, kind: endpoints.subject.entity_kind },
    object: { uri: endpoints.object.uri, kind: endpoints.object.entity_kind },
  });
  const identity = createRelationIdentity(scope, endpoints.subject.uri, definition.id, endpoints.object.uri);

  const transaction = db.transaction(() => {
    const existed = Boolean(
      db
        .prepare<[string], { uri: string }>("SELECT uri FROM continuity_concept_relations WHERE uri = ?")
        .get(identity.uri),
    );
    upsertRelationHead(
      db,
      identity,
      scope,
      endpoints,
      definition,
      temporal,
      input.authority,
      input.confidence,
      sourceRefs,
      observedAt,
      policy,
    );
    const addedEvidence = appendRelationEvidence(
      db,
      identity.uri,
      sourceRefs,
      input.authority,
      input.confidence,
      observedAt,
    );
    rebuildAgentContinuityGraphRelationSupport(db, identity.uri, policy);
    recordRelationHistory(
      db,
      identity.uri,
      existed || addedEvidence === 0 ? "reinforced" : "created",
      sourceRefs,
      input.authority,
      input.confidence,
      observedAt,
    );
    if (definition.cardinality === "single_subject") {
      reconcileSingleSubjectRelations(db, scope, endpoints.subject.uri, definition.id, observedAt);
    }
  });
  transaction();

  const stored = db
    .prepare<[string], RelationRow>("SELECT * FROM continuity_concept_relations WHERE uri = ?")
    .get(identity.uri);
  if (!stored) throw new Error(`Continuity relation was not persisted: ${identity.uri}`);
  return relationFromRow(stored);
}

export function listAgentContinuityGraphRelations(
  db: Database.Database,
  scopes: readonly AgentContinuityScopeRef[],
  query: AgentContinuityGraphRelationQuery = {},
): AgentContinuityGraphRelation[] {
  const normalizedScopes = normalizeScopes(scopes);
  if (normalizedScopes.length === 0) return [];
  const scopeWhere = normalizedScopes.map(() => "(scope_kind = ? AND scope_id = ?)").join(" OR ");
  const entityUris = uniqueStrings(query.entityUris ?? []);
  const entityWhere =
    entityUris.length === 0
      ? ""
      : ` AND (subject_uri IN (${placeholders(entityUris)}) OR object_uri IN (${placeholders(entityUris)}))`;
  const params: unknown[] = [...normalizedScopes.flatMap((scope) => [scope.kind, scope.id])];
  if (entityUris.length > 0) params.push(...entityUris, ...entityUris);
  const rows = db
    .prepare<unknown[], RelationRow>(
      `SELECT * FROM continuity_concept_relations
       WHERE (${scopeWhere})${query.includeInactive ? "" : " AND status = 'active'"}${entityWhere}
       ORDER BY updated_at DESC, uri ASC`,
    )
    .all(...params);
  return rows.map(relationFromRow);
}

export function listAgentContinuityGraphNeighbors(
  db: Database.Database,
  scopes: readonly AgentContinuityScopeRef[],
  entityUris: readonly string[],
): AgentContinuityGraphRelation[] {
  return listAgentContinuityGraphRelations(db, scopes, { entityUris });
}

export function snapshotAgentContinuityGraph(
  db: Database.Database,
  scopes: readonly AgentContinuityScopeRef[],
): AgentContinuityGraphSnapshot {
  const normalizedScopes = normalizeScopes(scopes);
  const relations = listAgentContinuityGraphRelations(db, normalizedScopes);
  return { scope: normalizedScopes, entities: readGraphEntities(db, relations), relations };
}

/** Repoints active graph edges before a source entity is marked merged. */
export function repointAgentContinuityGraphEntity(
  db: Database.Database,
  input: { readonly sourceUri: string; readonly targetUri: string; readonly observedAt: string },
  policy: AgentContinuityRuleConsolidationPolicy = AgentContinuityRuleConsolidationDefaults,
): void {
  if (input.sourceUri === input.targetUri) return;
  const rows = db
    .prepare<[string, string], RelationRow>(
      `SELECT * FROM continuity_concept_relations
       WHERE status = 'active' AND (subject_uri = ? OR object_uri = ?)
       ORDER BY created_at ASC, uri ASC`,
    )
    .all(input.sourceUri, input.sourceUri);
  for (const row of rows) {
    const subjectUri = row.subject_uri === input.sourceUri ? input.targetUri : row.subject_uri;
    const objectUri = row.object_uri === input.sourceUri ? input.targetUri : row.object_uri;
    const scope = { kind: row.scope_kind, id: row.scope_id } as const;
    const definition = getAgentContinuityRelationDefinition(row.relation_id);
    const endpoints = readRelationEndpoints(db, scope, subjectUri, objectUri);
    assertAgentContinuityRelationEndpoints({
      relationId: definition.id,
      subject: { uri: subjectUri, kind: endpoints.subject.entity_kind },
      object: { uri: objectUri, kind: endpoints.object.entity_kind },
    });
    const identity = createRelationIdentity(scope, subjectUri, definition.id, objectUri);
    upsertRelationHead(
      db,
      identity,
      scope,
      endpoints,
      definition,
      temporalFromRow(row),
      row.authority,
      row.confidence,
      stringArray(row.source_refs_json),
      input.observedAt,
      policy,
    );
    transferRelationEvidence(db, row.uri, identity.uri);
    rebuildAgentContinuityGraphRelationSupport(db, identity.uri, policy);
    db.prepare(
      "UPDATE continuity_concept_relations SET status = 'superseded', superseded_by = ?, updated_at = ? WHERE uri = ?",
    ).run(identity.uri, input.observedAt, row.uri);
    recordRelationHistory(
      db,
      row.uri,
      "superseded",
      stringArray(row.source_refs_json),
      row.authority,
      row.confidence,
      input.observedAt,
    );
  }
}

export function pruneAgentContinuityGraphSources(
  db: Database.Database,
  deletedSourceUris: ReadonlySet<string>,
  policy: AgentContinuityRuleConsolidationPolicy = AgentContinuityRuleConsolidationDefaults,
): void {
  const affected = pruneRelationEvidenceSources(db, deletedSourceUris);
  pruneRelationHistorySources(db, deletedSourceUris);
  for (const relationUri of affected) {
    if (
      db
        .prepare<[string], { uri: string }>("SELECT uri FROM continuity_concept_relations WHERE uri = ?")
        .get(relationUri)
    ) {
      rebuildAgentContinuityGraphRelationSupport(db, relationUri, policy);
    }
  }
}

export function deleteAgentContinuityGraphSession(db: Database.Database, sessionId: string): void {
  db.prepare("DELETE FROM continuity_concept_relations WHERE scope_kind = 'session' AND scope_id = ?").run(sessionId);
}

export function rebuildAgentContinuityGraphRelationSupport(
  db: Database.Database,
  relationUri: string,
  policy: AgentContinuityRuleConsolidationPolicy = AgentContinuityRuleConsolidationDefaults,
): void {
  const evidence = db
    .prepare<[string], RelationEvidenceRow>(
      `SELECT relation_uri, evidence_key, source_refs_json, authority, confidence, observed_at
       FROM continuity_concept_relation_evidence WHERE relation_uri = ?`,
    )
    .all(relationUri);
  if (evidence.length === 0) {
    db.prepare("DELETE FROM continuity_concept_relations WHERE uri = ?").run(relationUri);
    return;
  }
  const strongestAuthority = evidence.reduce(
    (strongest, entry) => strongestAgentContinuityAuthority(strongest, entry.authority),
    evidence[0].authority,
  );
  const supportCount = evidence.length;
  const supportMass = 1 - evidence.reduce((remaining, entry) => remaining * (1 - entry.confidence), 1);
  const confidence = Math.max(...evidence.map((entry) => entry.confidence));
  const sourceRefs = uniqueStrings(evidence.flatMap((entry) => stringArray(entry.source_refs_json)));
  const updatedAt = evidence.reduce(
    (latest, entry) => (entry.observed_at > latest ? entry.observed_at : latest),
    evidence[0].observed_at,
  );
  db.prepare(
    `UPDATE continuity_concept_relations
     SET authority = ?, confidence = ?, source_refs_json = ?, support_count = ?, support_mass = ?, maturity = ?,
         status = 'active', superseded_by = NULL, updated_at = ?
     WHERE uri = ?`,
  ).run(
    strongestAuthority,
    confidence,
    json(sourceRefs),
    supportCount,
    supportMass,
    resolveAgentContinuityRelationMaturity(strongestAuthority, supportCount, policy),
    updatedAt,
    relationUri,
  );
}

function createRelationIdentity(
  scope: AgentContinuityScopeRef,
  subjectUri: string,
  relationId: string,
  objectUri: string,
): { readonly id: string; readonly uri: string } {
  const id = createId("relation", [scope.kind, scope.id, subjectUri, relationId, objectUri]);
  return { id, uri: `senera://continuity-relation/${id}` };
}

function upsertRelationHead(
  db: Database.Database,
  identity: { readonly id: string; readonly uri: string },
  scope: AgentContinuityScopeRef,
  endpoints: { readonly subject: GraphEntityRow; readonly object: GraphEntityRow },
  definition: AgentContinuityRelationDefinition,
  temporal: AgentContinuityTemporalWindow,
  authority: AgentContinuityAuthority,
  confidence: number,
  sourceRefs: readonly string[],
  observedAt: string,
  policy: AgentContinuityRuleConsolidationPolicy,
): void {
  db.prepare(
    `INSERT INTO continuity_concept_relations (
       id, uri, scope_kind, scope_id, subject_uri, relation_id, object_uri,
       temporal_kind, valid_from, valid_until, time_zone, status, authority, confidence,
       source_refs_json, support_count, support_mass, maturity, superseded_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 0, 0, ?, NULL, ?, ?)
     ON CONFLICT(scope_kind, scope_id, subject_uri, relation_id, object_uri) DO UPDATE SET
       temporal_kind = excluded.temporal_kind,
       valid_from = excluded.valid_from,
       valid_until = excluded.valid_until,
       time_zone = excluded.time_zone,
       status = 'active',
       superseded_by = NULL,
       updated_at = excluded.updated_at`,
  ).run(
    identity.id,
    identity.uri,
    scope.kind,
    scope.id,
    endpoints.subject.uri,
    definition.id,
    endpoints.object.uri,
    temporal.kind,
    temporal.startsAt ?? null,
    temporal.endsAt ?? null,
    temporal.timeZone,
    authority,
    confidence,
    json(sourceRefs),
    resolveAgentContinuityRelationMaturity(authority, 0, policy),
    observedAt,
    observedAt,
  );
}

function appendRelationEvidence(
  db: Database.Database,
  relationUri: string,
  sourceRefs: readonly string[],
  authority: AgentContinuityAuthority,
  confidence: number,
  observedAt: string,
): number {
  const read = db.prepare<[string, string], RelationEvidenceRow>(
    `SELECT relation_uri, evidence_key, source_refs_json, authority, confidence, observed_at
     FROM continuity_concept_relation_evidence WHERE relation_uri = ? AND evidence_key = ?`,
  );
  const upsert = db.prepare(
    `INSERT INTO continuity_concept_relation_evidence
       (relation_uri, evidence_key, source_refs_json, authority, confidence, observed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(relation_uri, evidence_key) DO UPDATE SET
       source_refs_json = excluded.source_refs_json,
       authority = excluded.authority,
       confidence = MAX(continuity_concept_relation_evidence.confidence, excluded.confidence),
       observed_at = MAX(continuity_concept_relation_evidence.observed_at, excluded.observed_at)`,
  );
  let added = 0;
  for (const group of groupAgentContinuityEvidenceByEpisode(db, sourceRefs)) {
    const existing = read.get(relationUri, group.key);
    if (!existing) added += 1;
    upsert.run(
      relationUri,
      group.key,
      json(uniqueStrings([...(existing ? stringArray(existing.source_refs_json) : []), ...group.sourceRefs])),
      existing ? strongestAgentContinuityAuthority(existing.authority, authority) : authority,
      Math.max(existing?.confidence ?? 0, confidence),
      existing && existing.observed_at > observedAt ? existing.observed_at : observedAt,
    );
  }
  return added;
}

function transferRelationEvidence(db: Database.Database, sourceRelationUri: string, targetRelationUri: string): void {
  const evidence = db
    .prepare<[string], RelationEvidenceRow>(
      `SELECT relation_uri, evidence_key, source_refs_json, authority, confidence, observed_at
       FROM continuity_concept_relation_evidence WHERE relation_uri = ?`,
    )
    .all(sourceRelationUri);
  for (const entry of evidence) {
    const existing = db
      .prepare<[string, string], RelationEvidenceRow>(
        `SELECT relation_uri, evidence_key, source_refs_json, authority, confidence, observed_at
         FROM continuity_concept_relation_evidence WHERE relation_uri = ? AND evidence_key = ?`,
      )
      .get(targetRelationUri, entry.evidence_key);
    db.prepare(
      `INSERT INTO continuity_concept_relation_evidence
         (relation_uri, evidence_key, source_refs_json, authority, confidence, observed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(relation_uri, evidence_key) DO UPDATE SET
         source_refs_json = excluded.source_refs_json,
         authority = excluded.authority,
         confidence = MAX(continuity_concept_relation_evidence.confidence, excluded.confidence),
         observed_at = MAX(continuity_concept_relation_evidence.observed_at, excluded.observed_at)`,
    ).run(
      targetRelationUri,
      entry.evidence_key,
      json(
        uniqueStrings([
          ...(existing ? stringArray(existing.source_refs_json) : []),
          ...stringArray(entry.source_refs_json),
        ]),
      ),
      existing ? strongestAgentContinuityAuthority(existing.authority, entry.authority) : entry.authority,
      Math.max(existing?.confidence ?? 0, entry.confidence),
      existing && existing.observed_at > entry.observed_at ? existing.observed_at : entry.observed_at,
    );
  }
}

/**
 * Cardinality is a truth constraint, not a last-write-wins shortcut. A
 * lower-authority inference may be retained as evidence, but cannot displace
 * an explicit user or verified observation. Equal authority updates follow
 * the most recent physical evidence.
 */
function reconcileSingleSubjectRelations(
  db: Database.Database,
  scope: AgentContinuityScopeRef,
  subjectUri: string,
  relationId: string,
  observedAt: string,
): void {
  const candidates = db
    .prepare<[string, string, string, string], RelationRow>(
      `SELECT * FROM continuity_concept_relations
       WHERE scope_kind = ? AND scope_id = ? AND subject_uri = ? AND relation_id = ?
         AND status = 'active'`,
    )
    .all(scope.kind, scope.id, subjectUri, relationId);
  const winner = [...candidates].sort(compareSingleSubjectRelationAuthority)[0];
  if (!winner) return;
  for (const candidate of candidates) {
    if (candidate.uri === winner.uri) continue;
    db.prepare(
      "UPDATE continuity_concept_relations SET status = 'superseded', superseded_by = ?, updated_at = ? WHERE uri = ?",
    ).run(winner.uri, observedAt, candidate.uri);
    recordRelationHistory(
      db,
      candidate.uri,
      "superseded",
      stringArray(candidate.source_refs_json),
      candidate.authority,
      candidate.confidence,
      observedAt,
    );
  }
}

function compareSingleSubjectRelationAuthority(left: RelationRow, right: RelationRow): number {
  return (
    compareAgentContinuityAuthorities(right.authority, left.authority) ||
    agentContinuityRelationMaturityRank(right.maturity) - agentContinuityRelationMaturityRank(left.maturity) ||
    right.updated_at.localeCompare(left.updated_at) ||
    right.support_mass - left.support_mass ||
    right.confidence - left.confidence ||
    left.uri.localeCompare(right.uri)
  );
}

function recordRelationHistory(
  db: Database.Database,
  relationUri: string,
  operation: RelationHistoryRow["operation"],
  sourceRefs: readonly string[],
  authority: AgentContinuityAuthority,
  confidence: number,
  occurredAt: string,
): void {
  const id = createId("relation_history", [relationUri, operation, occurredAt, ...sourceRefs]);
  db.prepare(
    `INSERT INTO continuity_concept_relation_history
       (id, relation_uri, operation, source_refs_json, authority, confidence, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(id, relationUri, operation, json(uniqueStrings(sourceRefs)), authority, confidence, occurredAt);
}

function relationFromRow(row: RelationRow): AgentContinuityGraphRelation {
  const definition = getAgentContinuityRelationDefinition(row.relation_id);
  return {
    id: row.id,
    uri: row.uri,
    subjectUri: row.subject_uri,
    relationId: row.relation_id,
    relationLabel: definition.label,
    objectUri: row.object_uri,
    scope: { kind: row.scope_kind, id: row.scope_id },
    cardinality: definition.cardinality,
    temporal: temporalFromRow(row),
    authority: row.authority,
    confidence: row.confidence,
    sourceRefs: stringArray(row.source_refs_json),
    supportCount: row.support_count,
    supportMass: row.support_mass,
    maturity: row.maturity,
    status: row.status,
    supersededBy: row.superseded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readRelationEndpoints(
  db: Database.Database,
  scope: AgentContinuityScopeRef,
  subjectUri: string,
  objectUri: string,
): { readonly subject: GraphEntityRow; readonly object: GraphEntityRow } {
  const read = db.prepare<[string, string, string], GraphEntityRow>(
    `SELECT uri, canonical_label, entity_kind, scope_kind, scope_id, status, merged_into_uri, created_at, updated_at
     FROM continuity_concepts
     WHERE uri = ? AND scope_kind = ? AND scope_id = ? AND status = 'active'`,
  );
  const subject = read.get(subjectUri.trim(), scope.kind, scope.id);
  const object = read.get(objectUri.trim(), scope.kind, scope.id);
  if (!subject) throw new Error(`Continuity graph subject is not an active entity in scope: ${subjectUri}`);
  if (!object) throw new Error(`Continuity graph object is not an active entity in scope: ${objectUri}`);
  return { subject, object };
}

function readGraphEntities(
  db: Database.Database,
  relations: readonly AgentContinuityGraphRelation[],
): AgentContinuityGraphEntity[] {
  const uris = uniqueStrings(relations.flatMap((relation) => [relation.subjectUri, relation.objectUri]));
  if (uris.length === 0) return [];
  const rows = db
    .prepare<unknown[], GraphEntityRow>(
      `SELECT uri, canonical_label, entity_kind, scope_kind, scope_id, status, merged_into_uri, created_at, updated_at
       FROM continuity_concepts WHERE uri IN (${placeholders(uris)}) ORDER BY uri ASC`,
    )
    .all(...uris);
  const aliases = db.prepare<[string], { alias: string }>(
    "SELECT alias FROM continuity_concept_aliases WHERE concept_uri = ? ORDER BY created_at ASC, alias ASC",
  );
  return rows.map((row) => ({
    uri: row.uri,
    label: row.canonical_label,
    aliases: aliases.all(row.uri).map(({ alias }) => alias),
    kind: row.entity_kind,
    scope: { kind: row.scope_kind, id: row.scope_id },
    status: row.status,
    mergedIntoUri: row.merged_into_uri,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function normalizeTemporal(temporal: AgentContinuityTemporalWindow): AgentContinuityTemporalWindow {
  const startsAt = temporal.startsAt
    ? normalizeTimestamp(temporal.startsAt, "Continuity relation start time")
    : undefined;
  const endsAt = temporal.endsAt ? normalizeTimestamp(temporal.endsAt, "Continuity relation end time") : undefined;
  if (startsAt && endsAt && startsAt > endsAt)
    throw new Error("Continuity relation start time must not be after its end time.");
  const timeZone = temporal.timeZone.trim();
  if (!timeZone) throw new Error("Continuity relation time zone must not be empty.");
  return { kind: temporal.kind, ...(startsAt ? { startsAt } : {}), ...(endsAt ? { endsAt } : {}), timeZone };
}

function temporalFromRow(row: RelationRow): AgentContinuityTemporalWindow {
  return {
    kind: row.temporal_kind,
    ...(row.valid_from ? { startsAt: row.valid_from } : {}),
    ...(row.valid_until ? { endsAt: row.valid_until } : {}),
    timeZone: row.time_zone,
  };
}

function placeholders(values: readonly unknown[]): string {
  if (values.length === 0) throw new Error("SQL placeholder list must not be empty.");
  return values.map(() => "?").join(", ");
}

function pruneRelationEvidenceSources(db: Database.Database, deletedSourceUris: ReadonlySet<string>): Set<string> {
  const rows = db
    .prepare<[], RelationEvidenceRow>(
      `SELECT relation_uri, evidence_key, source_refs_json, authority, confidence, observed_at
       FROM continuity_concept_relation_evidence`,
    )
    .all();
  const update = db.prepare(
    "UPDATE continuity_concept_relation_evidence SET source_refs_json = ? WHERE relation_uri = ? AND evidence_key = ?",
  );
  const remove = db.prepare(
    "DELETE FROM continuity_concept_relation_evidence WHERE relation_uri = ? AND evidence_key = ?",
  );
  const affected = new Set<string>();
  for (const row of rows) {
    const current = stringArray(row.source_refs_json);
    const remaining = pruneAgentContinuitySourceReferences(current, deletedSourceUris);
    if (remaining === undefined) remove.run(row.relation_uri, row.evidence_key);
    else if (remaining.length !== current.length) update.run(json(remaining), row.relation_uri, row.evidence_key);
    if (remaining === undefined || remaining.length !== current.length) affected.add(row.relation_uri);
  }
  return affected;
}

function pruneRelationHistorySources(db: Database.Database, deletedSourceUris: ReadonlySet<string>): void {
  const rows = db
    .prepare<[], Pick<RelationHistoryRow, "id" | "source_refs_json">>(
      "SELECT id, source_refs_json FROM continuity_concept_relation_history",
    )
    .all();
  const update = db.prepare("UPDATE continuity_concept_relation_history SET source_refs_json = ? WHERE id = ?");
  const remove = db.prepare("DELETE FROM continuity_concept_relation_history WHERE id = ?");
  for (const row of rows) {
    const current = stringArray(row.source_refs_json);
    const remaining = pruneAgentContinuitySourceReferences(current, deletedSourceUris);
    if (remaining === undefined) remove.run(row.id);
    else if (remaining.length !== current.length) update.run(json(remaining), row.id);
  }
}
