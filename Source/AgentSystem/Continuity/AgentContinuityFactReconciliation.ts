import type Database from "better-sqlite3";
import { normalizeAgentContinuityScope, type AgentContinuityScopeRef } from "./AgentContinuityDomain.js";
import {
  isAgentContinuityEquivalentClaim,
  type AgentContinuityFactIdentityCandidate,
} from "./AgentContinuityFactIdentity.js";
import { AgentContinuityRecallRankingDefaults } from "./AgentContinuityRecallDefaults.js";
import { strongestAgentContinuityAuthority } from "./AgentContinuityAuthorityPolicy.js";
import type { FactHeadRow } from "./AgentContinuitySqliteRows.js";
import {
  createId,
  json,
  normalizeScopes,
  objectValue,
  parseJson,
  stringArray,
  uniqueStrings,
} from "./AgentContinuitySqliteUtils.js";
import { AgentContinuityTextSimilarity } from "./AgentContinuityTextSimilarity.js";
import type { ResolvedAgentContinuityRecallRankingConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import {
  resolveAgentContinuityRuleConsolidationPolicy,
  type AgentContinuityRuleConsolidationPolicy,
} from "./AgentContinuityRuleConsolidationPolicy.js";
import {
  mergeAgentContinuityFactEvidence,
  updateAgentContinuityFactSupport,
} from "./AgentContinuitySqliteFactEvidence.js";

export interface AgentContinuityFactReconciliationPolicy {
  readonly similarity: AgentContinuityTextSimilarity;
  readonly fuzzyThreshold: number;
  readonly consolidation: AgentContinuityRuleConsolidationPolicy;
}

export function createAgentContinuityFactReconciliationPolicy(
  ranking: ResolvedAgentContinuityRecallRankingConfig = AgentContinuityRecallRankingDefaults,
): AgentContinuityFactReconciliationPolicy {
  return {
    similarity: new AgentContinuityTextSimilarity(ranking.Similarity),
    fuzzyThreshold: ranking.FactIdentityFuzzyScore,
    consolidation: resolveAgentContinuityRuleConsolidationPolicy(ranking.Consolidation),
  };
}

export interface AgentContinuityFactWriteRouting {
  readonly canonicalKey: string;
  readonly canonical: FactHeadRow | undefined;
  /** Legacy equivalent heads to fold after a new explicit canonical is created. */
  readonly foldAfterCreate?: readonly FactHeadRow[];
}

/**
 * Routes a fact write onto the canonical head for its claim. Paraphrased
 * duplicates converge onto the oldest active identity instead of piling up
 * under independent fact keys; losers keep their history and lineage via
 * superseded_by.
 */
export function routeAgentContinuityFactWrite(
  db: Database.Database,
  scope: AgentContinuityScopeRef,
  claim: string,
  requestedKey: string,
  observedAt: string,
  policy?: AgentContinuityFactReconciliationPolicy,
  options: { readonly preserveRequestedKey?: boolean } = {},
): AgentContinuityFactWriteRouting {
  const own = readActiveFactHead(db, scope, requestedKey);
  if (!policy) return { canonicalKey: requestedKey, canonical: own };

  const candidates = listActiveFactHeadCandidates(db, scope, requestedKey);
  if (candidates.length === 0) return { canonicalKey: requestedKey, canonical: own };
  const equivalent = candidates.filter((candidate) =>
    isAgentContinuityEquivalentClaim(policy.similarity, claim, candidate.claim, policy.fuzzyThreshold),
  );
  // An explicit key whose current claim is unrelated remains its own version;
  // it must not be pulled into another slot merely because that slot exists.
  if (own && !isAgentContinuityEquivalentClaim(policy.similarity, claim, own.claim, policy.fuzzyThreshold)) {
    return { canonicalKey: requestedKey, canonical: own };
  }
  const matchedRows = equivalent.flatMap((candidate) => {
    const row = readActiveFactHead(db, scope, candidate.factKey);
    return row ? [row] : [];
  });
  const rows = own ? [own, ...matchedRows] : matchedRows;
  if (rows.length === 0) return { canonicalKey: requestedKey, canonical: own };
  if (options.preserveRequestedKey && !own) {
    // The explicit key is a host-owned identity. Create it first, then let
    // the caller fold legacy rows into it in the same write transaction.
    return { canonicalKey: requestedKey, canonical: undefined, foldAfterCreate: matchedRows };
  }
  const canonical =
    options.preserveRequestedKey && own
      ? own
      : rows.reduce((oldest, row) => (isOlderFactHead(row, oldest) ? row : oldest));
  for (const row of rows) {
    if (row.fact_key !== canonical.fact_key)
      supersedeAgentContinuityFactHead(db, scope, row, canonical.fact_key, observedAt);
  }
  return { canonicalKey: canonical.fact_key, canonical: readActiveFactHead(db, scope, canonical.fact_key) };
}

export function supersedeAgentContinuityFactHead(
  db: Database.Database,
  scope: AgentContinuityScopeRef,
  loser: FactHeadRow,
  canonicalKey: string,
  observedAt: string,
): void {
  const canonical = readActiveFactHead(db, scope, canonicalKey);
  if (canonical) {
    const authority = strongestAgentContinuityAuthority(canonical.authority, loser.authority);
    const confidence = Math.max(canonical.confidence, loser.confidence);
    mergeAgentContinuityFactEvidence(db, { from: loser, to: canonical, observedAt });
    if (authority !== canonical.authority || confidence !== canonical.confidence) {
      db.prepare(
        `UPDATE continuity_fact_heads
         SET authority = ?, confidence = ?, updated_at = ?
         WHERE scope_kind = ? AND scope_id = ? AND fact_key = ? AND status = 'active'`,
      ).run(authority, confidence, observedAt, canonical.scope_kind, canonical.scope_id, canonical.fact_key);
    }
    updateAgentContinuityFactSupport(db, canonical, authority, observedAt);
  }
  foldFactHeadSourceRefs(db, scope, canonicalKey, stringArray(loser.source_refs_json), observedAt);
  db.prepare(
    `UPDATE continuity_fact_heads
     SET status = 'superseded', superseded_by = ?, updated_at = ?
     WHERE scope_kind = ? AND scope_id = ? AND fact_key = ? AND status = 'active'`,
  ).run(canonicalKey, observedAt, scope.kind, scope.id, loser.fact_key);
  recordFactHeadHistoryEntry(db, scope, loser, "superseded", observedAt, canonicalKey);
}

/**
 * Reopens a historical host-owned slot before routing a new observation.  A
 * fact head uses a stable primary key, so inserting a fresh row after a sweep
 * would violate the key constraint.  Reusing the row preserves its lineage
 * and lets the normal version/evidence path decide what the new claim means.
 */
export function reactivateAgentContinuityFactHead(
  db: Database.Database,
  scope: AgentContinuityScopeRef,
  factKey: string,
  observedAt: string,
): FactHeadRow | undefined {
  const historical = readAnyFactHead(db, scope, factKey);
  if (!historical || historical.status === "active") return historical;
  db.prepare(
    `UPDATE continuity_fact_heads
     SET status = 'active', superseded_by = NULL, updated_at = ?
     WHERE scope_kind = ? AND scope_id = ? AND fact_key = ? AND status <> 'active'`,
  ).run(observedAt, scope.kind, scope.id, factKey);
  return readActiveFactHead(db, scope, factKey);
}

export interface AgentContinuityFactReconciliationResult {
  readonly scopes: number;
  readonly supersededFacts: number;
}

/** One-shot pairwise sweep that folds paraphrase duplicates onto the oldest identity. */
export function reconcileAgentContinuityFacts(
  db: Database.Database,
  scopes: readonly AgentContinuityScopeRef[],
  policy: AgentContinuityFactReconciliationPolicy,
  observedAt: string,
): AgentContinuityFactReconciliationResult {
  const normalized = normalizeScopes(scopes);
  let supersededFacts = 0;
  const sweep = db.transaction(() => {
    for (const scope of normalized) {
      const survivors: FactHeadRow[] = [];
      for (const head of listActiveFactHeads(db, scope)) {
        const survivor = survivors.find((candidate) =>
          isAgentContinuityEquivalentClaim(policy.similarity, head.claim, candidate.claim, policy.fuzzyThreshold),
        );
        if (survivor) {
          supersedeAgentContinuityFactHead(db, scope, head, survivor.fact_key, observedAt);
          supersededFacts += 1;
        } else {
          survivors.push(head);
        }
      }
    }
  });
  sweep();
  return { scopes: normalized.length, supersededFacts };
}

export function listAgentContinuityFactHeadScopes(db: Database.Database): AgentContinuityScopeRef[] {
  return db
    .prepare<unknown[], { scope_kind: AgentContinuityScopeRef["kind"]; scope_id: string }>(
      "SELECT DISTINCT scope_kind, scope_id FROM continuity_fact_heads WHERE status = 'active'",
    )
    .all()
    .map((row) => ({ kind: row.scope_kind, id: row.scope_id }));
}

export function reconcileAllAgentContinuityFacts(
  db: Database.Database,
  policy: AgentContinuityFactReconciliationPolicy,
  observedAt: string,
): AgentContinuityFactReconciliationResult {
  return reconcileAgentContinuityFacts(db, listAgentContinuityFactHeadScopes(db), policy, observedAt);
}

function readActiveFactHead(
  db: Database.Database,
  scope: AgentContinuityScopeRef,
  factKey: string,
): FactHeadRow | undefined {
  return db
    .prepare<unknown[], FactHeadRow>(
      `SELECT * FROM continuity_fact_heads
       WHERE scope_kind = ? AND scope_id = ? AND fact_key = ? AND status = 'active'`,
    )
    .get(scope.kind, scope.id, factKey);
}

function listActiveFactHeads(db: Database.Database, scope: AgentContinuityScopeRef): FactHeadRow[] {
  const rows = db
    .prepare<unknown[], FactHeadRow>(
      `SELECT head.* FROM continuity_fact_heads head
       JOIN continuity_observations observation ON observation.uri = head.observation_uri
       WHERE head.scope_kind = ? AND head.scope_id = ? AND head.status = 'active'
       ORDER BY head.created_at ASC, head.fact_key ASC`,
    )
    .all(scope.kind, scope.id);
  // Explicit keys are host-owned identities.  Prefer them as sweep survivors
  // when equivalent legacy hashes coexist; ownership is read from the source
  // payload rather than inferred from a key naming convention.
  return rows.sort(
    (left, right) =>
      Number(isExplicitFactHead(db, right)) - Number(isExplicitFactHead(db, left)) ||
      (isOlderFactHead(left, right) ? -1 : isOlderFactHead(right, left) ? 1 : 0),
  );
}

function readAnyFactHead(
  db: Database.Database,
  scope: AgentContinuityScopeRef,
  factKey: string,
): FactHeadRow | undefined {
  return db
    .prepare<unknown[], FactHeadRow>(
      `SELECT * FROM continuity_fact_heads
       WHERE scope_kind = ? AND scope_id = ? AND fact_key = ?`,
    )
    .get(scope.kind, scope.id, factKey);
}

function isExplicitFactHead(db: Database.Database, row: FactHeadRow): boolean {
  const observation = db
    .prepare<[string], { payload_json: string }>("SELECT payload_json FROM continuity_observations WHERE uri = ?")
    .get(row.observation_uri);
  if (!observation) return false;
  const payload = objectValue(parseJson(observation.payload_json));
  return typeof payload.factKey === "string" && payload.factKey.trim() === row.fact_key;
}

function listActiveFactHeadCandidates(
  db: Database.Database,
  scope: AgentContinuityScopeRef,
  excludeKey: string,
): AgentContinuityFactIdentityCandidate[] {
  return listActiveFactHeads(db, scope)
    .filter((row) => row.fact_key !== excludeKey)
    .map((row) => ({
      factKey: row.fact_key,
      claim: row.claim,
      scope: { kind: row.scope_kind, id: row.scope_id },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
}

function isOlderFactHead(candidate: FactHeadRow, reference: FactHeadRow): boolean {
  return (
    candidate.created_at.localeCompare(reference.created_at) < 0 ||
    (candidate.created_at === reference.created_at && candidate.fact_key.localeCompare(reference.fact_key) < 0)
  );
}

function foldFactHeadSourceRefs(
  db: Database.Database,
  scope: AgentContinuityScopeRef,
  factKey: string,
  addedRefs: readonly string[],
  observedAt: string,
): void {
  if (addedRefs.length === 0) return;
  const current = readActiveFactHead(db, scope, factKey);
  if (!current) return;
  const merged = uniqueStrings([...stringArray(current.source_refs_json), ...addedRefs]);
  db.prepare(
    `UPDATE continuity_fact_heads
     SET source_refs_json = ?, updated_at = ?
     WHERE scope_kind = ? AND scope_id = ? AND fact_key = ?`,
  ).run(json(merged), observedAt, scope.kind, scope.id, factKey);
}

function recordFactHeadHistoryEntry(
  db: Database.Database,
  scopeRef: AgentContinuityScopeRef,
  row: FactHeadRow,
  operation: "superseded",
  occurredAt: string,
  supersededBy: string,
): void {
  const scope = normalizeAgentContinuityScope(scopeRef);
  const id = createId("fact_event", [scope.kind, scope.id, row.fact_key, row.observation_uri, operation]);
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
    row.fact_key,
    row.observation_uri,
    operation,
    row.claim,
    row.authority,
    row.confidence,
    occurredAt,
    supersededBy,
    row.source_refs_json,
  );
}
