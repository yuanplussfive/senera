import type Database from "better-sqlite3";
import { normalizeAgentContinuityScope, type AgentContinuityScopeRef } from "./AgentContinuityDomain.js";
import { createId, normalizeScopes, uniqueStrings } from "./AgentContinuitySqliteUtils.js";
import { repointAgentContinuityGraphEntity } from "./AgentContinuitySqliteGraph.js";
import { AgentContinuityEntityKinds, type AgentContinuityEntityKind } from "./AgentContinuityRelationCatalog.js";

export const AgentContinuityConceptRecordKinds = ["fact", "profile", "signal", "rule"] as const;
export type AgentContinuityConceptRecordKind = (typeof AgentContinuityConceptRecordKinds)[number];

export interface AgentContinuityConceptRecord {
  readonly uri: string;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly entityKind: AgentContinuityEntityKind;
  readonly scope: AgentContinuityScopeRef;
  readonly recordKinds: readonly AgentContinuityConceptRecordKind[];
  readonly recordCount: number;
  readonly mergedIntoUri: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentContinuityConceptRegistration {
  readonly recordUri: string;
  readonly recordKind: AgentContinuityConceptRecordKind;
  readonly scope: AgentContinuityScopeRef;
  readonly label: string;
  readonly aliases?: readonly string[];
  /** Generic is the compatibility default; graph writers should provide a precise kind. */
  readonly entityKind?: AgentContinuityEntityKind;
  readonly observedAt: string;
}

export interface AgentContinuityConceptEnsureInput {
  readonly scope: AgentContinuityScopeRef;
  readonly label: string;
  readonly aliases?: readonly string[];
  readonly entityKind?: AgentContinuityEntityKind;
  readonly observedAt: string;
}

export interface AgentContinuityConceptMergeInput {
  readonly scope: AgentContinuityScopeRef;
  readonly sourceUris: readonly string[];
  readonly targetUri: string;
  readonly observedAt: string;
}

export interface AgentContinuityConceptSplitInput {
  readonly scope: AgentContinuityScopeRef;
  readonly sourceUri: string;
  readonly targetLabel: string;
  readonly moveAliases: readonly string[];
  readonly moveRecordUris: readonly string[];
  readonly observedAt: string;
}

export interface AgentContinuityConceptRenameInput {
  readonly scope: AgentContinuityScopeRef;
  readonly uri: string;
  readonly label: string;
  readonly observedAt: string;
}

export interface AgentContinuityConceptCorrectionInput {
  readonly scope: AgentContinuityScopeRef;
  readonly uri: string;
  readonly addAliases?: readonly string[];
  readonly removeAliases?: readonly string[];
  readonly observedAt: string;
}

interface ConceptRow {
  uri: string;
  canonical_label: string;
  normalized_label: string;
  entity_kind: AgentContinuityEntityKind;
  scope_kind: AgentContinuityScopeRef["kind"];
  scope_id: string;
  status: "active" | "merged" | "retired";
  merged_into_uri: string | null;
  created_at: string;
  updated_at: string;
}

interface AliasRow {
  alias: string;
  normalized_alias: string;
}

/**
 * Links a record to the concept owning its aliases. When the alias set spans several
 * active concepts, those concepts describe the same entity and are merged into the
 * oldest one instead of failing the write.
 */
export function registerAgentContinuityConcept(
  db: Database.Database,
  input: AgentContinuityConceptRegistration,
): string {
  const register = db.transaction((): string => {
    const scope = normalizeAgentContinuityScope(input.scope);
    const recordUri = input.recordUri.trim();
    if (!recordUri) throw new Error("Continuity concept registration requires a record URI.");
    const label = normalizeConceptLabel(input.label);
    const entityKind = normalizeEntityKind(input.entityKind);
    const aliases = uniqueStrings([label, ...(input.aliases ?? [])]);
    const conceptUri = ensureConcept(db, { ...input, label, aliases, entityKind, scope, observedAt: input.observedAt });
    db.prepare(
      `INSERT INTO continuity_record_concepts (record_uri, record_kind, concept_uri, linked_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(record_uri, record_kind, concept_uri) DO UPDATE SET linked_at = excluded.linked_at`,
    ).run(recordUri, input.recordKind, conceptUri, input.observedAt);
    db.prepare("UPDATE continuity_concepts SET updated_at = ? WHERE uri = ?").run(input.observedAt, conceptUri);
    return conceptUri;
  });
  return register();
}

export function ensureAgentContinuityConcept(db: Database.Database, input: AgentContinuityConceptEnsureInput): string {
  const ensure = db.transaction((): string => {
    const scope = normalizeAgentContinuityScope(input.scope);
    const label = normalizeConceptLabel(input.label);
    const entityKind = normalizeEntityKind(input.entityKind);
    const aliases = uniqueStrings([label, ...(input.aliases ?? [])]);
    const normalizedAliases = uniqueStrings(aliases.map(normalizeConceptAlias));
    return ensureConcept(db, { scope, label, aliases, normalizedAliases, entityKind, observedAt: input.observedAt });
  });
  return ensure();
}

export function mergeAgentContinuityConcepts(
  db: Database.Database,
  input: AgentContinuityConceptMergeInput,
): AgentContinuityConceptRecord {
  const merge = db.transaction((): AgentContinuityConceptRecord => {
    const scope = normalizeAgentContinuityScope(input.scope);
    const sourceUris = uniqueStrings(input.sourceUris);
    if (sourceUris.length === 0) {
      throw new Error("Continuity concept merge requires at least one source concept.");
    }
    if (sourceUris.includes(input.targetUri)) {
      throw new Error(`Continuity concept merge target must not be a source: ${input.targetUri}`);
    }
    const target = requireActiveConcept(db, scope, input.targetUri);
    mergeConceptRows(
      db,
      target.uri,
      sourceUris.map((uri) => requireActiveConcept(db, scope, uri)),
      input.observedAt,
    );
    return readConceptRecord(db, scope, target.uri);
  });
  return merge();
}

export function splitAgentContinuityConcept(
  db: Database.Database,
  input: AgentContinuityConceptSplitInput,
): AgentContinuityConceptRecord {
  const split = db.transaction((): AgentContinuityConceptRecord => {
    const scope = normalizeAgentContinuityScope(input.scope);
    const source = requireActiveConcept(db, scope, input.sourceUri);
    const label = normalizeConceptLabel(input.targetLabel);
    const normalizedLabel = normalizeConceptAlias(label);
    const moveAliases = uniqueStrings(input.moveAliases);
    const moveRecordUris = uniqueStrings(input.moveRecordUris);
    if (moveAliases.length === 0 && moveRecordUris.length === 0) {
      throw new Error("Continuity concept split requires aliases or records to move.");
    }
    const sourceAliases = readAliasRows(db, source.uri);
    const movedNormalized = moveAliases.map(normalizeConceptAlias);
    const unknownAliases = movedNormalized.filter(
      (normalized) => !sourceAliases.some((row) => row.normalized_alias === normalized),
    );
    if (unknownAliases.length > 0) {
      throw new Error(`Aliases are not linked to the source concept: ${unknownAliases.join(", ")}`);
    }
    const remainingAliases = sourceAliases.filter((row) => !movedNormalized.includes(row.normalized_alias));
    if (remainingAliases.length === 0) {
      throw new Error("Continuity concept split must leave at least one alias on the source concept.");
    }
    if (remainingAliases.some((row) => row.normalized_alias === normalizedLabel)) {
      throw new Error(`Split label remains linked to the source concept: ${label}`);
    }
    assertLabelAvailable(db, scope, normalizedLabel, source.uri, label);

    const targetUri = createConcept(db, scope, label, normalizedLabel, source.entity_kind, input.observedAt);
    const insertAlias = db.prepare(
      `INSERT INTO continuity_concept_aliases (concept_uri, alias, normalized_alias, created_at)
       VALUES (?, ?, ?, ?) ON CONFLICT(concept_uri, normalized_alias) DO NOTHING`,
    );
    for (const alias of uniqueStrings([label, ...moveAliases])) {
      insertAlias.run(targetUri, alias, normalizeConceptAlias(alias), input.observedAt);
    }
    if (movedNormalized.length > 0) {
      db.prepare(
        `DELETE FROM continuity_concept_aliases
         WHERE concept_uri = ? AND normalized_alias IN (${movedNormalized.map(() => "?").join(", ")})`,
      ).run(source.uri, ...movedNormalized);
    }
    if (moveRecordUris.length > 0) {
      moveRecordLinks(db, source.uri, targetUri, moveRecordUris, input.observedAt);
    }
    db.prepare("UPDATE continuity_concepts SET updated_at = ? WHERE uri = ?").run(input.observedAt, source.uri);
    return readConceptRecord(db, scope, targetUri);
  });
  return split();
}

export function renameAgentContinuityConcept(
  db: Database.Database,
  input: AgentContinuityConceptRenameInput,
): AgentContinuityConceptRecord {
  const rename = db.transaction((): AgentContinuityConceptRecord => {
    const scope = normalizeAgentContinuityScope(input.scope);
    const concept = requireActiveConcept(db, scope, input.uri);
    const label = normalizeConceptLabel(input.label);
    const normalizedLabel = normalizeConceptAlias(label);
    if (normalizedLabel !== concept.normalized_label) {
      assertLabelAvailable(db, scope, normalizedLabel, concept.uri, label);
    }
    db.prepare(
      "UPDATE continuity_concepts SET canonical_label = ?, normalized_label = ?, updated_at = ? WHERE uri = ?",
    ).run(label, normalizedLabel, input.observedAt, concept.uri);
    db.prepare(
      `INSERT INTO continuity_concept_aliases (concept_uri, alias, normalized_alias, created_at)
       VALUES (?, ?, ?, ?) ON CONFLICT(concept_uri, normalized_alias) DO NOTHING`,
    ).run(concept.uri, label, normalizedLabel, input.observedAt);
    return readConceptRecord(db, scope, concept.uri);
  });
  return rename();
}

export function correctAgentContinuityConcept(
  db: Database.Database,
  input: AgentContinuityConceptCorrectionInput,
): AgentContinuityConceptRecord {
  const correct = db.transaction((): AgentContinuityConceptRecord => {
    const scope = normalizeAgentContinuityScope(input.scope);
    const concept = requireActiveConcept(db, scope, input.uri);
    const addAliases = uniqueStrings(input.addAliases ?? []);
    const removeAliases = uniqueStrings(input.removeAliases ?? []);
    if (addAliases.length === 0 && removeAliases.length === 0) {
      throw new Error("Continuity concept correction requires aliases to add or remove.");
    }
    const existingAliases = readAliasRows(db, concept.uri);
    for (const alias of removeAliases) {
      const normalized = normalizeConceptAlias(alias);
      const row = existingAliases.find((entry) => entry.normalized_alias === normalized);
      if (!row) throw new Error(`Alias is not linked to this concept: ${alias}`);
      if (normalized === concept.normalized_label) {
        throw new Error(`The canonical label alias cannot be removed; rename the concept instead: ${alias}`);
      }
      db.prepare("DELETE FROM continuity_concept_aliases WHERE concept_uri = ? AND normalized_alias = ?").run(
        concept.uri,
        normalized,
      );
    }
    for (const alias of addAliases) {
      const normalized = normalizeConceptAlias(alias);
      const collisions = findConceptCandidates(db, scope, [normalized]).filter(({ uri }) => uri !== concept.uri);
      if (collisions.length > 0) {
        throw new Error(
          `Alias is already linked to another active concept; merge them instead: ${collisions.map(({ uri }) => uri).join(", ")}`,
        );
      }
      db.prepare(
        `INSERT INTO continuity_concept_aliases (concept_uri, alias, normalized_alias, created_at)
         VALUES (?, ?, ?, ?) ON CONFLICT(concept_uri, normalized_alias) DO NOTHING`,
      ).run(concept.uri, alias, normalized, input.observedAt);
    }
    db.prepare("UPDATE continuity_concepts SET updated_at = ? WHERE uri = ?").run(input.observedAt, concept.uri);
    return readConceptRecord(db, scope, concept.uri);
  });
  return correct();
}

/**
 * One-time purge of signal-derived concept links. Signals are rule-engine
 * inputs, not user-domain concepts; legacy links left by older runtimes are
 * removed and orphaned concepts retired. Idempotent; runs at store init.
 */
export function purgeAgentContinuitySignalConcepts(db: Database.Database): number {
  const purge = db.transaction((): number => {
    const removed = db.prepare("DELETE FROM continuity_record_concepts WHERE record_kind = 'signal'").run().changes;
    const orphaned = db
      .prepare(
        `DELETE FROM continuity_concepts
         WHERE uri NOT IN (SELECT DISTINCT concept_uri FROM continuity_record_concepts)
           AND uri NOT IN (SELECT subject_uri FROM continuity_concept_relations)
           AND uri NOT IN (SELECT object_uri FROM continuity_concept_relations)`,
      )
      .run().changes;
    db.prepare(
      `DELETE FROM continuity_concept_aliases
       WHERE concept_uri NOT IN (SELECT uri FROM continuity_concepts)`,
    ).run();
    return removed + orphaned;
  });
  return purge();
}

export function listAgentContinuityConcepts(
  db: Database.Database,
  scopes: readonly AgentContinuityScopeRef[],
): AgentContinuityConceptRecord[] {
  const normalized = normalizeScopes(scopes);
  if (normalized.length === 0) return [];
  const where = normalized.map(() => "(scope_kind = ? AND scope_id = ?)").join(" OR ");
  const rows = db
    .prepare<unknown[], ConceptRow>(
      `SELECT * FROM continuity_concepts WHERE status = 'active' AND (${where})
       ORDER BY updated_at DESC, uri ASC`,
    )
    .all(...normalized.flatMap((scope) => [scope.kind, scope.id]));
  return rows.map((row) => projectConceptRecord(db, row));
}

function mergeIntoOldestConcept(db: Database.Database, candidates: readonly ConceptRow[], observedAt: string): string {
  const survivor = [...candidates].sort(compareConceptAge)[0]!;
  const sources = candidates.filter(({ uri }) => uri !== survivor.uri);
  if (sources.length > 0) mergeConceptRows(db, survivor.uri, sources, observedAt);
  return survivor.uri;
}

function ensureConcept(
  db: Database.Database,
  input: {
    readonly scope: AgentContinuityScopeRef;
    readonly label: string;
    readonly aliases: readonly string[];
    readonly normalizedAliases?: readonly string[];
    readonly entityKind: AgentContinuityEntityKind;
    readonly observedAt: string;
  },
): string {
  const normalizedAliases = input.normalizedAliases ?? uniqueStrings(input.aliases.map(normalizeConceptAlias));
  const candidates = findConceptCandidates(db, input.scope, normalizedAliases);
  const conceptUri =
    candidates.length > 0
      ? mergeIntoOldestConcept(db, candidates, input.observedAt)
      : createConcept(db, input.scope, input.label, normalizedAliases[0]!, input.entityKind, input.observedAt);
  ensureConceptEntityKind(db, input.scope, conceptUri, input.entityKind, input.observedAt);
  const insertAlias = db.prepare(
    `INSERT INTO continuity_concept_aliases (concept_uri, alias, normalized_alias, created_at)
     VALUES (?, ?, ?, ?) ON CONFLICT(concept_uri, normalized_alias) DO NOTHING`,
  );
  for (const alias of input.aliases) insertAlias.run(conceptUri, alias, normalizeConceptAlias(alias), input.observedAt);
  db.prepare("UPDATE continuity_concepts SET updated_at = ? WHERE uri = ?").run(input.observedAt, conceptUri);
  return conceptUri;
}

function compareConceptAge(left: ConceptRow, right: ConceptRow): number {
  return left.created_at.localeCompare(right.created_at) || left.uri.localeCompare(right.uri);
}

function mergeConceptRows(
  db: Database.Database,
  targetUri: string,
  sources: readonly ConceptRow[],
  observedAt: string,
): void {
  const moveAliases = db.prepare(
    `INSERT INTO continuity_concept_aliases (concept_uri, alias, normalized_alias, created_at)
     SELECT ?, alias, normalized_alias, created_at FROM continuity_concept_aliases WHERE concept_uri = ?
     ON CONFLICT(concept_uri, normalized_alias) DO NOTHING`,
  );
  const moveRecords = db.prepare(
    `INSERT INTO continuity_record_concepts (record_uri, record_kind, concept_uri, linked_at)
     SELECT record_uri, record_kind, ?, linked_at FROM continuity_record_concepts WHERE concept_uri = ?
     ON CONFLICT(record_uri, record_kind, concept_uri) DO UPDATE SET linked_at = excluded.linked_at`,
  );
  const deleteAliases = db.prepare("DELETE FROM continuity_concept_aliases WHERE concept_uri = ?");
  const deleteRecords = db.prepare("DELETE FROM continuity_record_concepts WHERE concept_uri = ?");
  const markMerged = db.prepare(
    "UPDATE continuity_concepts SET status = 'merged', merged_into_uri = ?, updated_at = ? WHERE uri = ?",
  );
  for (const source of sources) {
    repointAgentContinuityGraphEntity(db, { sourceUri: source.uri, targetUri, observedAt });
    moveAliases.run(targetUri, source.uri);
    moveRecords.run(targetUri, source.uri);
    deleteAliases.run(source.uri);
    deleteRecords.run(source.uri);
    markMerged.run(targetUri, observedAt, source.uri);
  }
  db.prepare("UPDATE continuity_concepts SET updated_at = ? WHERE uri = ?").run(observedAt, targetUri);
}

function moveRecordLinks(
  db: Database.Database,
  sourceUri: string,
  targetUri: string,
  recordUris: readonly string[],
  observedAt: string,
): void {
  const placeholders = recordUris.map(() => "?").join(", ");
  const linkedCount =
    db
      .prepare<[string, ...string[]], { count: number }>(
        `SELECT COUNT(DISTINCT record_uri) AS count FROM continuity_record_concepts WHERE concept_uri = ? AND record_uri IN (${placeholders})`,
      )
      .get(sourceUri, ...recordUris)?.count ?? 0;
  if (linkedCount !== recordUris.length) {
    throw new Error(`Records are not linked to the source concept: ${sourceUri}`);
  }
  db.prepare(
    `INSERT INTO continuity_record_concepts (record_uri, record_kind, concept_uri, linked_at)
     SELECT record_uri, record_kind, ?, ?
     FROM continuity_record_concepts
     WHERE concept_uri = ? AND record_uri IN (${placeholders})
     ON CONFLICT(record_uri, record_kind, concept_uri) DO UPDATE SET linked_at = excluded.linked_at`,
  ).run(targetUri, observedAt, sourceUri, ...recordUris);
  db.prepare(
    `DELETE FROM continuity_record_concepts
     WHERE concept_uri = ? AND record_uri IN (${placeholders})`,
  ).run(sourceUri, ...recordUris);
}

function assertLabelAvailable(
  db: Database.Database,
  scope: AgentContinuityScopeRef,
  normalizedLabel: string,
  excludeUri: string,
  label: string,
): void {
  const collisions = findConceptCandidates(db, scope, [normalizedLabel]).filter(({ uri }) => uri !== excludeUri);
  if (collisions.length > 0) {
    throw new Error(
      `Continuity concept label is already linked to another active concept: ${label} (${collisions
        .map(({ uri }) => uri)
        .join(", ")})`,
    );
  }
}

function requireActiveConcept(db: Database.Database, scope: AgentContinuityScopeRef, uri: string): ConceptRow {
  const row = db
    .prepare<[string, string, string], ConceptRow>(
      `SELECT * FROM continuity_concepts
       WHERE uri = ? AND scope_kind = ? AND scope_id = ? AND status = 'active'`,
    )
    .get(uri, scope.kind, scope.id);
  if (!row) throw new Error(`Active continuity concept not found in scope: ${uri}`);
  return row;
}

function readConceptRecord(
  db: Database.Database,
  scope: AgentContinuityScopeRef,
  uri: string,
): AgentContinuityConceptRecord {
  const row = requireActiveConcept(db, scope, uri);
  return projectConceptRecord(db, row);
}

function projectConceptRecord(db: Database.Database, row: ConceptRow): AgentContinuityConceptRecord {
  const readLinks = db.prepare<[string], { record_kind: AgentContinuityConceptRecordKind }>(
    "SELECT record_kind FROM continuity_record_concepts WHERE concept_uri = ? ORDER BY record_kind ASC, record_uri ASC",
  );
  const links = readLinks.all(row.uri);
  return {
    uri: row.uri,
    label: row.canonical_label,
    aliases: readAliasRows(db, row.uri).map(({ alias }) => alias),
    entityKind: row.entity_kind,
    scope: { kind: row.scope_kind, id: row.scope_id },
    recordKinds: uniqueStrings(links.map(({ record_kind }) => record_kind)) as AgentContinuityConceptRecordKind[],
    recordCount: links.length,
    mergedIntoUri: row.merged_into_uri ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readAliasRows(db: Database.Database, uri: string): AliasRow[] {
  return db
    .prepare<[string], AliasRow>(
      "SELECT alias, normalized_alias FROM continuity_concept_aliases WHERE concept_uri = ? ORDER BY created_at ASC, alias ASC",
    )
    .all(uri);
}

function findConceptCandidates(
  db: Database.Database,
  scope: AgentContinuityScopeRef,
  normalizedAliases: readonly string[],
): ConceptRow[] {
  const placeholders = normalizedAliases.map(() => "?").join(", ");
  return db
    .prepare<unknown[], ConceptRow>(
      `SELECT DISTINCT concept.* FROM continuity_concepts AS concept
       JOIN continuity_concept_aliases AS alias ON alias.concept_uri = concept.uri
       WHERE concept.scope_kind = ? AND concept.scope_id = ? AND concept.status = 'active'
         AND alias.normalized_alias IN (${placeholders})
       ORDER BY concept.uri ASC`,
    )
    .all(scope.kind, scope.id, ...normalizedAliases);
}

function createConcept(
  db: Database.Database,
  scope: AgentContinuityScopeRef,
  label: string,
  normalizedLabel: string,
  entityKind: AgentContinuityEntityKind,
  observedAt: string,
): string {
  const id = createId("concept", [scope.kind, scope.id, normalizedLabel]);
  const uri = `senera://continuity-concept/${id}`;
  const existing = db.prepare<[string], ConceptRow>("SELECT * FROM continuity_concepts WHERE uri = ?").get(uri);
  if (existing) {
    if (existing.status === "active") {
      throw new Error(`Continuity concept label is already active in this scope: ${label}`);
    }
    // A previously merged or retired concept re-emerges under its original identity.
    db.prepare(
      `UPDATE continuity_concepts
       SET status = 'active', merged_into_uri = NULL, canonical_label = ?, updated_at = ?
       WHERE uri = ?`,
    ).run(label, observedAt, uri);
    return uri;
  }
  db.prepare(
    `INSERT INTO continuity_concepts
       (id, uri, canonical_label, normalized_label, entity_kind, scope_kind, scope_id, status, merged_into_uri, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)`,
  ).run(id, uri, label, normalizedLabel, entityKind, scope.kind, scope.id, observedAt, observedAt);
  return uri;
}

function ensureConceptEntityKind(
  db: Database.Database,
  scope: AgentContinuityScopeRef,
  uri: string,
  requestedKind: AgentContinuityEntityKind,
  observedAt: string,
): void {
  const concept = requireActiveConcept(db, scope, uri);
  if (concept.entity_kind === requestedKind || requestedKind === "concept") return;
  if (concept.entity_kind !== "concept") {
    throw new Error(
      `Continuity entity kind conflict for ${uri}: existing=${concept.entity_kind}, requested=${requestedKind}.`,
    );
  }
  db.prepare("UPDATE continuity_concepts SET entity_kind = ?, updated_at = ? WHERE uri = ?").run(
    requestedKind,
    observedAt,
    uri,
  );
}

function normalizeEntityKind(value: AgentContinuityEntityKind | undefined): AgentContinuityEntityKind {
  const kind = value ?? "concept";
  if (!(AgentContinuityEntityKinds as readonly string[]).includes(kind)) {
    throw new Error(`Unsupported continuity entity kind: ${String(kind)}`);
  }
  return kind;
}

function normalizeConceptLabel(value: string): string {
  const normalized = value.trim().normalize("NFKC").replace(/\s+/gu, " ");
  if (!normalized) throw new Error("Continuity concept label must not be empty.");
  return normalized;
}

/** Canonical alias identity shared by concept writes and local entity linking. */
export function normalizeAgentContinuityConceptAlias(value: string): string {
  return normalizeConceptAlias(value);
}

function normalizeConceptAlias(value: string): string {
  return normalizeConceptLabel(value)
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}
