import type Database from "better-sqlite3";
import type { AgentContinuityScopeRef, AgentContinuitySignal } from "./AgentContinuityDomain.js";
import {
  compareAgentContinuityAuthorities,
  strongestAgentContinuityAuthority,
} from "./AgentContinuityAuthorityPolicy.js";
import { groupAgentContinuityEvidenceByEpisode } from "./AgentContinuityEvidenceIdentity.js";
import { signalFromRow, type SignalRow } from "./AgentContinuitySqliteRows.js";
import { json, normalizeScopes, normalizeTimestamp, stringArray, uniqueStrings } from "./AgentContinuitySqliteUtils.js";
import { normalizeAgentContinuityScope } from "./AgentContinuityDomain.js";

interface SignalEvidenceRow extends SignalRow {
  evidence_key: string;
}

interface SignalIdentity {
  readonly scopeKind: AgentContinuityScopeRef["kind"];
  readonly scopeId: string;
  readonly namespace: string;
  readonly key: string;
}

export function upsertAgentContinuitySignal(db: Database.Database, signal: AgentContinuitySignal): void {
  const scope = normalizeAgentContinuityScope(signal.scope);
  const normalized: AgentContinuitySignal = {
    ...signal,
    scope,
    namespace: requiredIdentityPart(signal.namespace, "namespace"),
    key: requiredIdentityPart(signal.key, "key"),
    observedAt: normalizeTimestamp(signal.observedAt, "Continuity signal observation time"),
    ...(signal.expiresAt
      ? { expiresAt: normalizeTimestamp(signal.expiresAt, "Continuity signal expiration time") }
      : {}),
    sourceRefs: uniqueStrings(signal.sourceRefs),
  };
  const identity = signalIdentity(normalized);
  const transaction = db.transaction(() => {
    for (const group of groupAgentContinuityEvidenceByEpisode(db, normalized.sourceRefs)) {
      upsertSignalEvidence(db, normalized, group.key, group.sourceRefs);
    }
    rebuildAgentContinuitySignalHead(db, identity, normalized.observedAt);
  });
  transaction();
}

export function listAgentContinuitySignals(
  db: Database.Database,
  scopes: readonly AgentContinuityScopeRef[],
  now = new Date(),
): AgentContinuitySignal[] {
  const normalized = normalizeScopes(scopes);
  if (normalized.length === 0) return [];
  const nowIso = now.toISOString();
  rebuildExpiredSignalHeads(db, normalized, nowIso);
  const where = normalized.map(() => "(scope_kind = ? AND scope_id = ?)").join(" OR ");
  return db
    .prepare<unknown[], SignalRow>(
      `SELECT * FROM continuity_signals
       WHERE (${where}) AND (expires_at IS NULL OR expires_at >= ?)
       ORDER BY observed_at DESC, namespace ASC, signal_key ASC`,
    )
    .all(...normalized.flatMap((scope) => [scope.kind, scope.id]), nowIso)
    .map(signalFromRow);
}

export function rebuildAgentContinuitySignalHead(db: Database.Database, identity: SignalIdentity, now: string): void {
  const evidence = readLiveSignalEvidence(db, identity, now);
  const remove = db.prepare(
    "DELETE FROM continuity_signals WHERE scope_kind = ? AND scope_id = ? AND namespace = ? AND signal_key = ?",
  );
  if (evidence.length === 0) {
    remove.run(identity.scopeKind, identity.scopeId, identity.namespace, identity.key);
    return;
  }
  const winner = evidence.reduce((selected, candidate) =>
    compareSignalEvidence(candidate, selected) > 0 ? candidate : selected,
  );
  const supporting = evidence.filter(
    (candidate) => candidate.value_type === winner.value_type && candidate.value_json === winner.value_json,
  );
  const authority = supporting.reduce(
    (strongest, candidate) => strongestAgentContinuityAuthority(strongest, candidate.authority),
    winner.authority,
  );
  const sourceRefs = uniqueStrings(supporting.flatMap((candidate) => stringArray(candidate.source_refs_json)));
  db.prepare(
    `INSERT INTO continuity_signals (
       scope_kind, scope_id, namespace, signal_key, value_json, value_type, authority, confidence,
       observed_at, expires_at, source_refs_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope_kind, scope_id, namespace, signal_key) DO UPDATE SET
       value_json = excluded.value_json,
       value_type = excluded.value_type,
       authority = excluded.authority,
       confidence = excluded.confidence,
       observed_at = excluded.observed_at,
       expires_at = excluded.expires_at,
       source_refs_json = excluded.source_refs_json`,
  ).run(
    identity.scopeKind,
    identity.scopeId,
    identity.namespace,
    identity.key,
    winner.value_json,
    winner.value_type,
    authority,
    Math.max(...supporting.map((candidate) => candidate.confidence)),
    winner.observed_at,
    winner.expires_at,
    json(sourceRefs),
  );
}

function upsertSignalEvidence(
  db: Database.Database,
  signal: AgentContinuitySignal,
  evidenceKey: string,
  sourceRefs: readonly string[],
): void {
  const identity = signalIdentity(signal);
  const existing = db
    .prepare<unknown[], SignalEvidenceRow>(
      `SELECT * FROM continuity_signal_evidence
       WHERE scope_kind = ? AND scope_id = ? AND namespace = ? AND signal_key = ? AND evidence_key = ?`,
    )
    .get(identity.scopeKind, identity.scopeId, identity.namespace, identity.key, evidenceKey);
  const incoming: SignalEvidenceRow = {
    scope_kind: identity.scopeKind,
    scope_id: identity.scopeId,
    namespace: identity.namespace,
    signal_key: identity.key,
    evidence_key: evidenceKey,
    value_json: json(signal.value),
    value_type: signal.valueType,
    authority: signal.authority,
    confidence: signal.confidence,
    observed_at: signal.observedAt,
    expires_at: signal.expiresAt ?? null,
    source_refs_json: json(sourceRefs),
  };
  const selected = existing && compareSignalEvidence(existing, incoming) > 0 ? existing : incoming;
  const mergedRefs = uniqueStrings([...(existing ? stringArray(existing.source_refs_json) : []), ...sourceRefs]);
  db.prepare(
    `INSERT INTO continuity_signal_evidence (
       scope_kind, scope_id, namespace, signal_key, evidence_key, value_json, value_type,
       authority, confidence, observed_at, expires_at, source_refs_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope_kind, scope_id, namespace, signal_key, evidence_key) DO UPDATE SET
       value_json = excluded.value_json,
       value_type = excluded.value_type,
       authority = excluded.authority,
       confidence = excluded.confidence,
       observed_at = excluded.observed_at,
       expires_at = excluded.expires_at,
       source_refs_json = excluded.source_refs_json`,
  ).run(
    identity.scopeKind,
    identity.scopeId,
    identity.namespace,
    identity.key,
    evidenceKey,
    selected.value_json,
    selected.value_type,
    selected.authority,
    selected.confidence,
    selected.observed_at,
    selected.expires_at,
    json(mergedRefs),
  );
}

function readLiveSignalEvidence(db: Database.Database, identity: SignalIdentity, now: string): SignalEvidenceRow[] {
  return db
    .prepare<unknown[], SignalEvidenceRow>(
      `SELECT * FROM continuity_signal_evidence
       WHERE scope_kind = ? AND scope_id = ? AND namespace = ? AND signal_key = ?
         AND (expires_at IS NULL OR expires_at >= ?)`,
    )
    .all(identity.scopeKind, identity.scopeId, identity.namespace, identity.key, now);
}

function rebuildExpiredSignalHeads(
  db: Database.Database,
  scopes: readonly AgentContinuityScopeRef[],
  now: string,
): void {
  const where = scopes.map(() => "(scope_kind = ? AND scope_id = ?)").join(" OR ");
  const expired = db
    .prepare<unknown[], Pick<SignalRow, "scope_kind" | "scope_id" | "namespace" | "signal_key">>(
      `SELECT scope_kind, scope_id, namespace, signal_key FROM continuity_signals
       WHERE expires_at < ? AND (${where})`,
    )
    .all(now, ...scopes.flatMap((scope) => [scope.kind, scope.id]));
  if (expired.length === 0) return;
  const transaction = db.transaction(() => {
    for (const row of expired) {
      rebuildAgentContinuitySignalHead(
        db,
        { scopeKind: row.scope_kind, scopeId: row.scope_id, namespace: row.namespace, key: row.signal_key },
        now,
      );
    }
  });
  transaction();
}

function signalIdentity(signal: Pick<AgentContinuitySignal, "scope" | "namespace" | "key">): SignalIdentity {
  return {
    scopeKind: signal.scope.kind,
    scopeId: signal.scope.id,
    namespace: signal.namespace,
    key: signal.key,
  };
}

function compareSignalEvidence(left: SignalEvidenceRow, right: SignalEvidenceRow): number {
  const authority = compareAgentContinuityAuthorities(left.authority, right.authority);
  if (authority !== 0) return authority;
  const observedAt = Date.parse(left.observed_at) - Date.parse(right.observed_at);
  if (observedAt !== 0) return observedAt;
  const confidence = left.confidence - right.confidence;
  if (confidence !== 0) return confidence;
  return left.evidence_key.localeCompare(right.evidence_key);
}

function requiredIdentityPart(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Continuity signal ${label} must not be empty.`);
  return normalized;
}
