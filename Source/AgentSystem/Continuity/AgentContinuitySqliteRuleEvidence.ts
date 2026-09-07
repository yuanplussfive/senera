import type Database from "better-sqlite3";
import type { AgentContinuityRule } from "./AgentContinuityDomain.js";
import { groupAgentContinuityEvidenceByEpisode } from "./AgentContinuityEvidenceIdentity.js";
import { strongestAgentContinuityAuthority } from "./AgentContinuityAuthorityPolicy.js";
import {
  AgentContinuityRuleConsolidationDefaults,
  resolveAgentContinuityRuleMaturity,
  type AgentContinuityRuleConsolidationPolicy,
} from "./AgentContinuityRuleConsolidationPolicy.js";
import type { AgentContinuityRuleDraft } from "./AgentContinuitySqliteTypes.js";
import { createId, json, stringArray, uniqueStrings } from "./AgentContinuitySqliteUtils.js";

interface RuleEvidenceRow {
  authority: AgentContinuityRule["authority"];
  confidence: number;
}

export function appendAgentContinuityRuleEvidence(
  db: Database.Database,
  ruleUri: string,
  sourceRefs: readonly string[],
  authority: AgentContinuityRule["authority"],
  confidence: number,
  observedAt: string,
): void {
  const groups = groupAgentContinuityEvidenceByEpisode(db, sourceRefs);
  const readExisting = db.prepare<
    [string, string],
    { source_refs_json: string; authority: AgentContinuityRule["authority"]; confidence: number }
  >(
    "SELECT source_refs_json, authority, confidence FROM continuity_rule_evidence WHERE rule_uri = ? AND evidence_key = ?",
  );
  const insert = db.prepare(
    `INSERT INTO continuity_rule_evidence
       (rule_uri, evidence_key, source_refs_json, authority, confidence, observed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(rule_uri, evidence_key) DO UPDATE SET
       source_refs_json = excluded.source_refs_json,
       authority = excluded.authority,
       confidence = MAX(continuity_rule_evidence.confidence, excluded.confidence),
       observed_at = MAX(continuity_rule_evidence.observed_at, excluded.observed_at)`,
  );
  for (const group of groups) {
    const existing = readExisting.get(ruleUri, group.key);
    insert.run(
      ruleUri,
      group.key,
      json(uniqueStrings([...(existing ? stringArray(existing.source_refs_json) : []), ...group.sourceRefs])),
      existing ? strongestAgentContinuityAuthority(existing.authority, authority) : authority,
      Math.max(existing?.confidence ?? 0, confidence),
      observedAt,
    );
  }
}

export function updateAgentContinuityRuleSupport(
  db: Database.Database,
  ruleUri: string,
  authority: AgentContinuityRule["authority"],
  now: string,
  policy: AgentContinuityRuleConsolidationPolicy = AgentContinuityRuleConsolidationDefaults,
): void {
  const evidence = readRuleEvidence(db, ruleUri);
  const supportMass = 1 - evidence.reduce((remaining, item) => remaining * (1 - item.confidence), 1);
  const maturity = resolveAgentContinuityRuleMaturity(authority, evidence.length, policy);
  db.prepare(
    "UPDATE continuity_rules SET support_count = ?, support_mass = ?, maturity = ?, updated_at = ? WHERE uri = ?",
  ).run(evidence.length, supportMass, maturity, now, ruleUri);
}

export function rebuildAgentContinuityRuleSupport(
  db: Database.Database,
  ruleUri: string,
  now: string,
  policy: AgentContinuityRuleConsolidationPolicy = AgentContinuityRuleConsolidationDefaults,
): void {
  const evidence = readRuleEvidence(db, ruleUri);
  if (evidence.length === 0) return;
  const authority = evidence.reduce(
    (strongest, item) => strongestAgentContinuityAuthority(strongest, item.authority),
    evidence[0].authority,
  );
  db.prepare("UPDATE continuity_rules SET authority = ? WHERE uri = ?").run(authority, ruleUri);
  updateAgentContinuityRuleSupport(db, ruleUri, authority, now, policy);
}

export function recordAgentContinuityRuleHistory(
  db: Database.Database,
  ruleUri: string,
  operation: "created" | "reinforced" | "revised" | "superseded",
  draft: AgentContinuityRuleDraft,
  similarity: number,
  now: string,
): void {
  const id = createId("rule_history", [ruleUri, operation, now, ...draft.sourceRefs]);
  db.prepare(
    `INSERT OR IGNORE INTO continuity_rule_history
       (id, rule_uri, operation, source_refs_json, authority, confidence, similarity, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    ruleUri,
    operation,
    json(uniqueStrings(draft.sourceRefs)),
    draft.authority,
    draft.confidence,
    similarity,
    now,
  );
}

function readRuleEvidence(db: Database.Database, ruleUri: string): RuleEvidenceRow[] {
  return db
    .prepare<[string], RuleEvidenceRow>("SELECT authority, confidence FROM continuity_rule_evidence WHERE rule_uri = ?")
    .all(ruleUri);
}
