import type Database from "better-sqlite3";
import {
  AgentContinuityEventObservationKinds,
  normalizeAgentContinuityScope,
  type AgentContinuityObservation,
  type AgentContinuityScopeRef,
} from "./AgentContinuityDomain.js";
import { createAgentContinuityFactIdentity, isAgentContinuityEquivalentClaim } from "./AgentContinuityFactIdentity.js";
import { agentContinuityScopeKey } from "./AgentContinuityScopes.js";
import {
  factHeadFromRow,
  factHistoryFromRow,
  observationFromRow,
  type FactHeadRow,
  type FactHistoryRow,
  type ObservationRow,
} from "./AgentContinuitySqliteRows.js";
import {
  createId,
  json,
  normalizeScopes,
  objectValue,
  parseJson,
  stringArray,
  uniqueStrings,
} from "./AgentContinuitySqliteUtils.js";
import {
  compareAgentContinuityAuthorities,
  strongestAgentContinuityAuthority,
} from "./AgentContinuityAuthorityPolicy.js";
import type { AgentContinuityFactHead, AgentContinuityFactHistoryEntry } from "./AgentContinuitySqliteTypes.js";
import { registerAgentContinuityConcept } from "./AgentContinuityConceptCatalog.js";
import {
  routeAgentContinuityFactWrite,
  reactivateAgentContinuityFactHead,
  supersedeAgentContinuityFactHead,
  type AgentContinuityFactReconciliationPolicy,
} from "./AgentContinuityFactReconciliation.js";
import {
  appendAgentContinuityFactEvidence,
  listAgentContinuityFactEvidence,
  updateAgentContinuityFactSupport,
} from "./AgentContinuitySqliteFactEvidence.js";
import {
  mergeAgentContinuityFactLifetime,
  resolveAgentContinuityFactLifetime,
  resolveAgentContinuityFactVersionLifetime,
  resolveAgentContinuityFactVersionStart,
} from "./AgentContinuityFactLifetime.js";

export function recordAgentContinuityObservation(
  db: Database.Database,
  input: AgentContinuityObservation,
  policy?: AgentContinuityFactReconciliationPolicy,
): AgentContinuityObservation {
  const scope = normalizeAgentContinuityScope(input.scope);
  const transaction = db.transaction(() => {
    const inserted = db
      .prepare(
        `INSERT INTO continuity_observations (
          id, uri, kind, summary, payload_json, source_refs_json, watermark,
          scope_kind, scope_id, authority, confidence, occurred_at, observed_at, created_at_ms
        ) VALUES (
          @id, @uri, @kind, @summary, @payload_json, @source_refs_json, @watermark,
          @scope_kind, @scope_id, @authority, @confidence, @occurred_at, @observed_at, @created_at_ms
        ) ON CONFLICT(uri) DO NOTHING`,
      )
      .run({
        id: input.id,
        uri: input.uri,
        kind: input.kind,
        summary: input.summary,
        payload_json: json(input.payload),
        source_refs_json: json(input.sourceRefs),
        watermark: input.watermark,
        scope_kind: scope.kind,
        scope_id: scope.id,
        authority: input.authority,
        confidence: input.confidence,
        occurred_at: input.occurredAt,
        observed_at: input.observedAt,
        created_at_ms: input.createdAtMs,
      });
    if (inserted.changes === 1 && input.kind === "learning.record" && input.payload.kind === "fact") {
      updateFactHead(db, input, scope, policy);
    }
  });
  transaction();
  return input;
}

export function listAgentContinuityLearningObservations(
  db: Database.Database,
  scopes: readonly AgentContinuityScopeRef[],
): AgentContinuityObservation[] {
  const normalized = normalizeScopes(scopes);
  if (normalized.length === 0) return [];
  const where = normalized.map(() => "(scope_kind = ? AND scope_id = ?)").join(" OR ");
  return db
    .prepare<unknown[], ObservationRow>(
      `SELECT * FROM continuity_observations
       WHERE kind = 'learning.record' AND (${where})
         AND (
           NOT EXISTS (
             SELECT 1 FROM continuity_fact_history history
             WHERE history.observation_uri = continuity_observations.uri
           )
           OR EXISTS (
             SELECT 1 FROM continuity_fact_heads head
             WHERE head.observation_uri = continuity_observations.uri AND head.status = 'active'
           )
         )
       ORDER BY created_at_ms DESC, uri ASC`,
    )
    .all(...normalized.flatMap((scope) => [scope.kind, scope.id]))
    .map(observationFromRow);
}

export function listAgentContinuityFactHeads(
  db: Database.Database,
  scopes: readonly AgentContinuityScopeRef[],
  now = new Date(),
): AgentContinuityFactHead[] {
  const normalized = normalizeScopes(scopes);
  if (normalized.length === 0) return [];
  const where = normalized.map(() => "(scope_kind = ? AND scope_id = ?)").join(" OR ");
  return db
    .prepare<unknown[], FactHeadRow>(
      `SELECT * FROM continuity_fact_heads
       WHERE status = 'active' AND (${where})
         AND (valid_until IS NULL OR valid_until >= ?)
       ORDER BY updated_at DESC, fact_key ASC`,
    )
    .all(...normalized.flatMap((scope) => [scope.kind, scope.id]), now.toISOString())
    .map(factHeadFromRow);
}

export function listAgentContinuityFactHistory(
  db: Database.Database,
  scope: AgentContinuityScopeRef,
  factKey?: string,
): AgentContinuityFactHistoryEntry[] {
  const normalized = normalizeAgentContinuityScope(scope);
  const rows = factKey
    ? db
        .prepare<unknown[], FactHistoryRow>(
          `SELECT * FROM continuity_fact_history
           WHERE scope_kind = ? AND scope_id = ? AND fact_key = ?
           ORDER BY occurred_at DESC, id ASC`,
        )
        .all(normalized.kind, normalized.id, factKey)
    : db
        .prepare<unknown[], FactHistoryRow>(
          `SELECT * FROM continuity_fact_history
           WHERE scope_kind = ? AND scope_id = ?
           ORDER BY occurred_at DESC, id ASC`,
        )
        .all(normalized.kind, normalized.id);
  return rows.map(factHistoryFromRow);
}

export function listAgentContinuityEventObservations(
  db: Database.Database,
  scopes: readonly AgentContinuityScopeRef[],
): AgentContinuityObservation[] {
  const normalized = normalizeScopes(scopes);
  if (normalized.length === 0) return [];
  const where = normalized.map(() => "(scope_kind = ? AND scope_id = ?)").join(" OR ");
  const kinds = AgentContinuityEventObservationKinds.map(() => "?").join(", ");
  return db
    .prepare<unknown[], ObservationRow>(
      `SELECT * FROM continuity_observations
       WHERE kind IN (${kinds}) AND (${where})
       ORDER BY created_at_ms DESC, uri ASC`,
    )
    .all(...AgentContinuityEventObservationKinds, ...normalized.flatMap((scope) => [scope.kind, scope.id]))
    .map(observationFromRow);
}

export function continuityObservationCatalogRevision(
  db: Database.Database,
  scopes: readonly AgentContinuityScopeRef[],
): string {
  const normalized = normalizeScopes(scopes);
  const scopeKey = agentContinuityScopeKey(normalized);
  if (normalized.length === 0) return `${scopeKey}:empty`;
  const where = normalized.map(() => "(scope_kind = ? AND scope_id = ?)").join(" OR ");
  const row = db
    .prepare<
      unknown[],
      {
        count: number;
        oldest: number | null;
        newest: number | null;
        observed: string | null;
        rowId: number | null;
        rowIdSum: number | null;
      }
    >(
      `SELECT COUNT(*) AS count,
              MIN(created_at_ms) AS oldest,
              MAX(created_at_ms) AS newest,
              MAX(observed_at) AS observed,
              MAX(rowid) AS rowId,
              COALESCE(SUM(rowid), 0) AS rowIdSum
       FROM continuity_observations
       WHERE ${where}`,
    )
    .get(...normalized.flatMap((scope) => [scope.kind, scope.id]));
  return [
    scopeKey,
    row?.count ?? 0,
    row?.oldest ?? 0,
    row?.newest ?? 0,
    row?.observed ?? "",
    row?.rowId ?? 0,
    row?.rowIdSum ?? 0,
  ].join(":");
}

export function rebuildAgentContinuityFactHeads(
  db: Database.Database,
  policy: AgentContinuityFactReconciliationPolicy,
): void {
  const previousHeads = db.prepare<[], FactHeadRow>("SELECT * FROM continuity_fact_heads").all();
  const previousByKey = new Map(
    previousHeads.map((row) => [`${row.scope_kind}\u0000${row.scope_id}\u0000${row.fact_key}`, row]),
  );
  db.prepare("DELETE FROM continuity_fact_heads").run();
  const rows = db
    .prepare<[], FactHistoryRow & { payload_json: string }>(
      `SELECT history.*, observation.payload_json
       FROM continuity_fact_history history
       JOIN continuity_observations observation ON observation.uri = history.observation_uri
       ORDER BY history.scope_kind, history.scope_id, history.fact_key,
                history.occurred_at DESC, history.id DESC`,
    )
    .all();
  const grouped = new Map<string, (FactHistoryRow & { payload_json: string })[]>();
  for (const row of rows) {
    const key = `${row.scope_kind}\u0000${row.scope_id}\u0000${row.fact_key}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const insert = db.prepare(
    `INSERT INTO continuity_fact_heads (
       scope_kind, scope_id, fact_key, observation_uri, claim, normalized_claim,
       authority, confidence, valid_from, valid_until, source_refs_json,
       status, support_count, support_mass, maturity, superseded_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, 0, 'active', NULL, ?, ?)`,
  );
  for (const [key, history] of grouped) {
    const previous = previousByKey.get(key);
    const row = history.find((entry) => entry.operation !== "retracted" && entry.superseded_by === null);
    if (!row || (previous?.status === "superseded" && previous.superseded_by)) continue;
    const lifetimeEvents = history.map((entry) => ({
      operation: entry.operation,
      occurredAt: entry.occurred_at,
      until: objectValue(parseJson(entry.payload_json)).until,
      supersededBy: entry.superseded_by,
    }));
    const validFrom = resolveAgentContinuityFactVersionStart(lifetimeEvents);
    const validUntil = resolveAgentContinuityFactVersionLifetime(lifetimeEvents);
    const identity = createAgentContinuityFactIdentity(row.claim, row.fact_key);
    const normalizedClaim = previous?.normalized_claim ?? identity.normalizedClaim;
    const evidence = listAgentContinuityFactEvidence(db, {
      scope_kind: row.scope_kind,
      scope_id: row.scope_id,
      fact_key: row.fact_key,
      normalized_claim: normalizedClaim,
    });
    const evidenceRefs = evidence.flatMap((entry) => stringArray(entry.source_refs_json));
    insert.run(
      row.scope_kind,
      row.scope_id,
      row.fact_key,
      row.observation_uri,
      row.claim,
      normalizedClaim,
      row.authority,
      row.confidence,
      validFrom,
      validUntil,
      json(uniqueStrings(evidenceRefs.length > 0 ? evidenceRefs : stringArray(row.source_refs_json))),
      validFrom,
      row.occurred_at,
    );
    updateAgentContinuityFactSupport(
      db,
      {
        scope_kind: row.scope_kind,
        scope_id: row.scope_id,
        fact_key: row.fact_key,
        normalized_claim: normalizedClaim,
      },
      row.authority,
      row.occurred_at,
      policy.consolidation,
    );
  }
}

function updateFactHead(
  db: Database.Database,
  input: AgentContinuityObservation,
  scope: AgentContinuityScopeRef,
  policy?: AgentContinuityFactReconciliationPolicy,
): void {
  const identity = createAgentContinuityFactIdentity(input.summary, input.payload.factKey);
  const explicitKey = typeof input.payload.factKey === "string" ? input.payload.factKey.trim() : "";
  if (explicitKey) {
    // The row can have been superseded by a later reconciliation sweep while
    // its host-owned key remains the requested identity.  Reactivate it before
    // routing so the primary-key row is updated instead of reinserted.
    reactivateAgentContinuityFactHead(db, scope, explicitKey, input.observedAt);
  }
  const routing = routeAgentContinuityFactWrite(db, scope, input.summary, identity.factKey, input.observedAt, policy, {
    preserveRequestedKey: explicitKey.length > 0,
  });
  const factKey = routing.canonicalKey;
  const current = routing.canonical;
  if (!current) {
    const validUntil = resolveAgentContinuityFactLifetime(input.payload.until).validUntil;
    db.prepare(
      `INSERT INTO continuity_fact_heads (
           scope_kind, scope_id, fact_key, observation_uri, claim, normalized_claim,
           authority, confidence, valid_from, valid_until, source_refs_json,
           status, support_count, support_mass, maturity, superseded_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, 0, 'active', NULL, ?, ?)`,
    ).run(
      scope.kind,
      scope.id,
      factKey,
      input.uri,
      input.summary,
      identity.normalizedClaim,
      input.authority,
      input.confidence,
      input.observedAt,
      validUntil,
      json(uniqueStrings(input.sourceRefs)),
      input.observedAt,
      input.observedAt,
    );
    const evidence = appendAgentContinuityFactEvidence(db, {
      scope,
      factKey,
      claimKey: identity.normalizedClaim,
      sourceRefs: input.sourceRefs,
      authority: input.authority,
      confidence: input.confidence,
      observedAt: input.observedAt,
    });
    updateAgentContinuityFactSupport(
      db,
      { scope_kind: scope.kind, scope_id: scope.id, fact_key: factKey, normalized_claim: identity.normalizedClaim },
      input.authority,
      input.observedAt,
      policy?.consolidation,
    );
    if (evidence.added > 0) recordFactHistory(db, input, scope, factKey, "created", input.observedAt);
    registerFactConcept(db, input, scope, factKey);
    for (const legacy of routing.foldAfterCreate ?? []) {
      supersedeAgentContinuityFactHead(db, scope, legacy, factKey, input.observedAt);
    }
    return;
  }

  const sameClaim = current.normalized_claim === identity.normalizedClaim;
  const equivalentClaim = sameClaim || isEquivalentFactVersion(current.claim, input.summary, policy);
  if (!equivalentClaim && compareAgentContinuityAuthorities(current.authority, input.authority) > 0) {
    recordFactHistory(db, input, scope, factKey, "retracted", input.observedAt);
    return;
  }
  const normalizedClaim = equivalentClaim ? current.normalized_claim : identity.normalizedClaim;
  const mergedRefs = equivalentClaim
    ? uniqueStrings([...stringArray(current.source_refs_json), ...input.sourceRefs])
    : uniqueStrings(input.sourceRefs);
  const evidence = appendAgentContinuityFactEvidence(db, {
    scope,
    factKey,
    claimKey: normalizedClaim,
    sourceRefs: input.sourceRefs,
    authority: input.authority,
    confidence: input.confidence,
    observedAt: input.observedAt,
  });
  const authority = strongestAgentContinuityAuthority(current.authority, input.authority);
  const confidence = Math.max(current.confidence, input.confidence);
  const validFrom = equivalentClaim ? current.valid_from : input.observedAt;
  const validUntil = equivalentClaim
    ? mergeAgentContinuityFactLifetime(current.valid_until, input.payload.until)
    : resolveAgentContinuityFactLifetime(input.payload.until).validUntil;
  const mergedSourceRefsJson = json(mergedRefs);
  const changed =
    evidence.changed ||
    current.observation_uri !== input.uri ||
    current.claim !== input.summary ||
    current.normalized_claim !== normalizedClaim ||
    current.authority !== authority ||
    current.confidence !== confidence ||
    current.valid_from !== validFrom ||
    current.valid_until !== validUntil ||
    current.source_refs_json !== mergedSourceRefsJson;
  if (!changed) return;
  db.prepare(
    `UPDATE continuity_fact_heads
       SET observation_uri = ?, claim = ?, normalized_claim = ?, authority = ?, confidence = ?,
           valid_from = ?, valid_until = ?, source_refs_json = ?, status = 'active',
           superseded_by = NULL, updated_at = ?
       WHERE scope_kind = ? AND scope_id = ? AND fact_key = ?`,
  ).run(
    input.uri,
    input.summary,
    normalizedClaim,
    authority,
    confidence,
    validFrom,
    validUntil,
    mergedSourceRefsJson,
    input.observedAt,
    scope.kind,
    scope.id,
    factKey,
  );
  updateAgentContinuityFactSupport(
    db,
    { scope_kind: scope.kind, scope_id: scope.id, fact_key: factKey, normalized_claim: normalizedClaim },
    authority,
    input.observedAt,
    policy?.consolidation,
  );
  if (evidence.added > 0) {
    recordFactHistory(db, input, scope, factKey, equivalentClaim ? "reinforced" : "superseded", input.observedAt);
  }
  registerFactConcept(db, input, scope, factKey);
}

function registerFactConcept(
  db: Database.Database,
  input: AgentContinuityObservation,
  scope: AgentContinuityScopeRef,
  factKey: string,
): void {
  registerAgentContinuityConcept(db, {
    recordUri: input.uri,
    recordKind: "fact",
    scope,
    label: input.summary,
    aliases: [factKey],
    observedAt: input.observedAt,
  });
}

function recordFactHistory(
  db: Database.Database,
  input: AgentContinuityObservation,
  scope: AgentContinuityScopeRef,
  factKey: string,
  operation: AgentContinuityFactHistoryEntry["operation"],
  occurredAt: string,
  supersededBy: string | null = null,
): void {
  const id = createId("fact_event", [scope.kind, scope.id, factKey, input.uri, operation]);
  db.prepare(
    `INSERT INTO continuity_fact_history (
         id, scope_kind, scope_id, fact_key, observation_uri, operation, claim,
         authority, confidence, occurred_at, superseded_by, source_refs_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
  ).run(
    id,
    scope.kind,
    scope.id,
    factKey,
    input.uri,
    operation,
    input.summary,
    input.authority,
    input.confidence,
    occurredAt,
    supersededBy,
    json(uniqueStrings(input.sourceRefs)),
  );
}

function isEquivalentFactVersion(
  currentClaim: string,
  incomingClaim: string,
  policy?: AgentContinuityFactReconciliationPolicy,
): boolean {
  if (!policy) return false;
  return isAgentContinuityEquivalentClaim(policy.similarity, currentClaim, incomingClaim, policy.fuzzyThreshold);
}
