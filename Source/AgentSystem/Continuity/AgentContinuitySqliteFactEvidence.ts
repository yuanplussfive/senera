import type Database from "better-sqlite3";
import { groupAgentContinuityEvidenceByEpisode } from "./AgentContinuityEvidenceIdentity.js";
import { strongestAgentContinuityAuthority } from "./AgentContinuityAuthorityPolicy.js";
import {
  AgentContinuityRuleConsolidationDefaults,
  resolveAgentContinuityRuleMaturity,
  type AgentContinuityRuleConsolidationPolicy,
} from "./AgentContinuityRuleConsolidationPolicy.js";
import type { AgentContinuityAuthority, AgentContinuityScopeRef } from "./AgentContinuityDomain.js";
import type { FactHeadRow } from "./AgentContinuitySqliteRows.js";
import { json, stringArray, uniqueStrings } from "./AgentContinuitySqliteUtils.js";

export interface FactEvidenceRow {
  readonly scope_kind: AgentContinuityScopeRef["kind"];
  readonly scope_id: string;
  readonly fact_key: string;
  readonly claim_key: string;
  readonly evidence_key: string;
  readonly source_refs_json: string;
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
  readonly observed_at: string;
}

export interface FactEvidenceIdentity {
  readonly scope: AgentContinuityScopeRef;
  readonly factKey: string;
  readonly claimKey: string;
  readonly evidenceKey: string;
}

export interface AgentContinuityFactEvidenceAppendResult {
  readonly added: number;
  readonly changed: boolean;
}

export function appendAgentContinuityFactEvidence(
  db: Database.Database,
  input: {
    readonly scope: AgentContinuityScopeRef;
    readonly factKey: string;
    readonly claimKey: string;
    readonly sourceRefs: readonly string[];
    readonly authority: AgentContinuityAuthority;
    readonly confidence: number;
    readonly observedAt: string;
  },
): AgentContinuityFactEvidenceAppendResult {
  const groups = groupAgentContinuityEvidenceByEpisode(db, input.sourceRefs);
  const readExisting = db.prepare<[string, string, string, string, string], FactEvidenceRow>(
    `SELECT * FROM continuity_fact_evidence
     WHERE scope_kind = ? AND scope_id = ? AND fact_key = ? AND claim_key = ? AND evidence_key = ?`,
  );
  const insert = db.prepare(
    `INSERT INTO continuity_fact_evidence (
       scope_kind, scope_id, fact_key, claim_key, evidence_key,
       source_refs_json, authority, confidence, observed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope_kind, scope_id, fact_key, claim_key, evidence_key) DO UPDATE SET
       source_refs_json = excluded.source_refs_json,
       authority = excluded.authority,
       confidence = MAX(continuity_fact_evidence.confidence, excluded.confidence),
       observed_at = MAX(continuity_fact_evidence.observed_at, excluded.observed_at)`,
  );
  let added = 0;
  let changed = false;
  for (const group of groups) {
    const existing = readExisting.get(input.scope.kind, input.scope.id, input.factKey, input.claimKey, group.key);
    const refs = uniqueStrings([...(existing ? stringArray(existing.source_refs_json) : []), ...group.sourceRefs]);
    const authority = existing
      ? strongestAgentContinuityAuthority(existing.authority, input.authority)
      : input.authority;
    const confidence = Math.max(existing?.confidence ?? 0, input.confidence);
    const observedAt = existing && existing.observed_at > input.observedAt ? existing.observed_at : input.observedAt;
    changed ||=
      !existing ||
      JSON.stringify(refs) !== existing.source_refs_json ||
      authority !== existing.authority ||
      confidence !== existing.confidence ||
      observedAt !== existing.observed_at;
    if (!existing) added += 1;
    insert.run(
      input.scope.kind,
      input.scope.id,
      input.factKey,
      input.claimKey,
      group.key,
      json(refs),
      authority,
      confidence,
      observedAt,
    );
  }
  return { added, changed };
}

export function mergeAgentContinuityFactEvidence(
  db: Database.Database,
  input: {
    readonly from: FactHeadRow;
    readonly to: FactHeadRow;
    readonly observedAt: string;
  },
): AgentContinuityFactEvidenceAppendResult {
  const rows = db
    .prepare<[string, string, string, string], FactEvidenceRow>(
      `SELECT * FROM continuity_fact_evidence
       WHERE scope_kind = ? AND scope_id = ? AND fact_key = ? AND claim_key = ?`,
    )
    .all(input.from.scope_kind, input.from.scope_id, input.from.fact_key, input.from.normalized_claim);
  let added = 0;
  let changed = false;
  for (const row of rows) {
    const result = appendAgentContinuityFactEvidence(db, {
      scope: { kind: input.to.scope_kind, id: input.to.scope_id },
      factKey: input.to.fact_key,
      claimKey: input.to.normalized_claim,
      sourceRefs: stringArray(row.source_refs_json),
      authority: row.authority,
      confidence: row.confidence,
      observedAt: row.observed_at > input.observedAt ? row.observed_at : input.observedAt,
    });
    added += result.added;
    changed ||= result.changed;
  }
  return { added, changed };
}

export function updateAgentContinuityFactSupport(
  db: Database.Database,
  head: Pick<FactHeadRow, "scope_kind" | "scope_id" | "fact_key" | "normalized_claim">,
  authority: AgentContinuityAuthority,
  now: string,
  policy: AgentContinuityRuleConsolidationPolicy = AgentContinuityRuleConsolidationDefaults,
): { readonly supportCount: number; readonly supportMass: number; readonly maturity: FactHeadRow["maturity"] } {
  const evidence = db
    .prepare<[string, string, string, string], Pick<FactEvidenceRow, "confidence">>(
      `SELECT confidence FROM continuity_fact_evidence
       WHERE scope_kind = ? AND scope_id = ? AND fact_key = ? AND claim_key = ?`,
    )
    .all(head.scope_kind, head.scope_id, head.fact_key, head.normalized_claim);
  const supportCount = evidence.length;
  const supportMass = 1 - evidence.reduce((remaining, item) => remaining * (1 - item.confidence), 1);
  const maturity = resolveAgentContinuityRuleMaturity(authority, supportCount, policy);
  db.prepare(
    `UPDATE continuity_fact_heads
     SET support_count = ?, support_mass = ?, maturity = ?, updated_at = ?
     WHERE scope_kind = ? AND scope_id = ? AND fact_key = ?`,
  ).run(supportCount, supportMass, maturity, now, head.scope_kind, head.scope_id, head.fact_key);
  return { supportCount, supportMass, maturity };
}

export function rebuildAgentContinuityFactSupport(
  db: Database.Database,
  head: Pick<FactHeadRow, "scope_kind" | "scope_id" | "fact_key" | "normalized_claim" | "authority">,
  now: string,
  policy: AgentContinuityRuleConsolidationPolicy = AgentContinuityRuleConsolidationDefaults,
): void {
  updateAgentContinuityFactSupport(db, head, head.authority, now, policy);
}

export function listAgentContinuityFactEvidence(
  db: Database.Database,
  head: Pick<FactHeadRow, "scope_kind" | "scope_id" | "fact_key" | "normalized_claim">,
): FactEvidenceRow[] {
  return db
    .prepare<[string, string, string, string], FactEvidenceRow>(
      `SELECT * FROM continuity_fact_evidence
       WHERE scope_kind = ? AND scope_id = ? AND fact_key = ? AND claim_key = ?
       ORDER BY observed_at DESC, evidence_key ASC`,
    )
    .all(head.scope_kind, head.scope_id, head.fact_key, head.normalized_claim);
}

export function rebuildAgentContinuityFactEvidence(
  db: Database.Database,
  identity: FactEvidenceIdentity,
  now: string,
  policy: AgentContinuityRuleConsolidationPolicy = AgentContinuityRuleConsolidationDefaults,
): void {
  const head = db
    .prepare<unknown[], FactHeadRow>(
      `SELECT * FROM continuity_fact_heads
       WHERE scope_kind = ? AND scope_id = ? AND fact_key = ? AND status = 'active'`,
    )
    .get(identity.scope.kind, identity.scope.id, identity.factKey);
  if (!head || head.normalized_claim !== identity.claimKey) return;
  const evidence = listAgentContinuityFactEvidence(db, head);
  const sourceRefs = uniqueStrings(evidence.flatMap((entry) => stringArray(entry.source_refs_json)));
  const authority = evidence.reduce(
    (strongest, entry) => strongestAgentContinuityAuthority(strongest, entry.authority),
    head.authority,
  );
  const confidence = evidence.reduce((highest, entry) => Math.max(highest, entry.confidence), 0);
  db.prepare(
    `UPDATE continuity_fact_heads
     SET source_refs_json = ?, authority = ?, confidence = ?
     WHERE scope_kind = ? AND scope_id = ? AND fact_key = ?`,
  ).run(json(sourceRefs), authority, confidence, identity.scope.kind, identity.scope.id, identity.factKey);
  updateAgentContinuityFactSupport(db, head, authority, now, policy);
}
