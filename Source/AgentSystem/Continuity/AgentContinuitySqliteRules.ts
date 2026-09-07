import type Database from "better-sqlite3";
import {
  serializeAgentContinuityCondition,
  normalizeAgentContinuityScope,
  type AgentContinuityRule,
  type AgentContinuityRuleStatus,
  type AgentContinuityScopeRef,
} from "./AgentContinuityDomain.js";
import { ruleFingerprint, ruleFromRow, ruleToRow, type RuleRow } from "./AgentContinuitySqliteRows.js";
import { createId, json, normalizeScopes, normalizeTimestamp, uniqueStrings } from "./AgentContinuitySqliteUtils.js";
import type { AgentContinuityRuleDraft } from "./AgentContinuitySqliteTypes.js";
import { createAgentContinuityRuleIdentity } from "./AgentContinuityRuleIdentity.js";
import { AgentContinuityRuleConsolidator } from "./AgentContinuityRuleConsolidator.js";
import { AgentContinuityTextSimilarity } from "./AgentContinuityTextSimilarity.js";
import {
  AgentContinuityRuleConsolidationDefaults,
  resolveAgentContinuityRuleMaturity,
  type AgentContinuityRuleConsolidationPolicy,
} from "./AgentContinuityRuleConsolidationPolicy.js";
import { strongestAgentContinuityAuthority } from "./AgentContinuityAuthorityPolicy.js";
import {
  appendAgentContinuityRuleEvidence,
  recordAgentContinuityRuleHistory,
  updateAgentContinuityRuleSupport,
} from "./AgentContinuitySqliteRuleEvidence.js";
import { registerAgentContinuityConcept } from "./AgentContinuityConceptCatalog.js";

export function recordAgentContinuityRule(
  db: Database.Database,
  draft: AgentContinuityRuleDraft,
  now = new Date().toISOString(),
  policy: AgentContinuityRuleConsolidationPolicy = AgentContinuityRuleConsolidationDefaults,
  similarity: AgentContinuityTextSimilarity = new AgentContinuityTextSimilarity(),
): AgentContinuityRule {
  const scope = normalizeAgentContinuityScope(draft.scope);
  const normalizedDraft = { ...draft, scope, sourceRefs: uniqueStrings(draft.sourceRefs) };
  const candidates = db
    .prepare<[AgentContinuityScopeRef["kind"], string], RuleRow>(
      `SELECT * FROM continuity_rules
       WHERE scope_kind = ? AND scope_id = ?
         AND status NOT IN ('resolved', 'cancelled', 'expired') AND superseded_by IS NULL`,
    )
    .all(scope.kind, scope.id)
    .map(ruleFromRow);
  const match = new AgentContinuityRuleConsolidator(policy, similarity).match(normalizedDraft, candidates);
  if (match.relation === "equivalent" && match.rule) {
    return reinforceRule(db, match.rule, normalizedDraft, match.similarity, now, policy);
  }
  if (normalizedDraft.targetRuleUri && !match.rule) {
    throw new Error(
      `Continuity rule target is unavailable or structurally incompatible: ${normalizedDraft.targetRuleUri}`,
    );
  }

  const id = createId("rule", [
    scope.kind,
    scope.id,
    normalizedDraft.title,
    serializeAgentContinuityCondition(normalizedDraft.condition),
    now,
  ]);
  const identity = createAgentContinuityRuleIdentity(normalizedDraft);
  const rule: AgentContinuityRule = {
    id,
    uri: `senera://continuity-rule/${id}`,
    title: normalizedDraft.title.trim(),
    condition: normalizedDraft.condition,
    action: normalizedDraft.action,
    scope,
    authority: normalizedDraft.authority,
    confidence: normalizedDraft.confidence,
    temporal: normalizedDraft.temporal,
    sourceRefs: normalizedDraft.sourceRefs,
    ...identity,
    supportCount: 0,
    supportMass: 0,
    maturity: resolveAgentContinuityRuleMaturity(normalizedDraft.authority, 0, policy),
    status: "armed" as const,
    createdAt: now,
    updatedAt: now,
  };
  const fingerprint = `${ruleFingerprint(rule)}:${id}`;
  db.prepare(
    `INSERT INTO continuity_rules (
        id, uri, title, condition_json, action_json, scope_kind, scope_id, authority, confidence,
        temporal_kind, valid_from, valid_until, time_zone, source_refs_json, status,
        last_evaluated_at, last_triggered_at, created_at, updated_at, fingerprint,
        semantic_key, condition_key, effect_key, support_count, support_mass, maturity, superseded_by
      ) VALUES (
        @id, @uri, @title, @condition_json, @action_json, @scope_kind, @scope_id, @authority, @confidence,
        @temporal_kind, @valid_from, @valid_until, @time_zone, @source_refs_json, @status,
        NULL, NULL, @created_at, @updated_at, @fingerprint,
        @semantic_key, @condition_key, @effect_key, @support_count, @support_mass, @maturity, @superseded_by
      )`,
  ).run({ ...ruleToRow(rule), fingerprint });
  appendAgentContinuityRuleEvidence(
    db,
    rule.uri,
    normalizedDraft.sourceRefs,
    normalizedDraft.authority,
    normalizedDraft.confidence,
    now,
  );
  updateAgentContinuityRuleSupport(db, rule.uri, normalizedDraft.authority, now, policy);
  recordAgentContinuityRuleHistory(
    db,
    rule.uri,
    match.relation === "revises" ? "revised" : "created",
    normalizedDraft,
    1,
    now,
  );
  if (match.relation === "revises" && match.rule) {
    db.prepare(
      `UPDATE continuity_rules
       SET status = 'cancelled', superseded_by = ?, updated_at = ?
       WHERE uri = ? AND superseded_by IS NULL`,
    ).run(rule.uri, now, match.rule.uri);
    recordAgentContinuityRuleHistory(db, match.rule.uri, "superseded", normalizedDraft, 1, now);
  }
  const stored = db.prepare<[string], RuleRow>("SELECT * FROM continuity_rules WHERE uri = ?").get(rule.uri);
  if (!stored) throw new Error("Continuity rule was not persisted.");
  const persisted = ruleFromRow(stored);
  registerRuleConcept(db, persisted, now);
  return persisted;
}

/** One-time reconciliation for rules created before canonical identities and evidence heads existed. */
export function reconcileLegacyAgentContinuityRules(
  db: Database.Database,
  now = new Date().toISOString(),
  policy: AgentContinuityRuleConsolidationPolicy = AgentContinuityRuleConsolidationDefaults,
  similarity: AgentContinuityTextSimilarity = new AgentContinuityTextSimilarity(),
): number {
  const legacyCount =
    db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM continuity_rules WHERE semantic_key = ''").get()
      ?.count ?? 0;
  if (legacyCount === 0) return 0;
  const transaction = db.transaction(() => {
    const rules = db
      .prepare<[], RuleRow>(
        `SELECT * FROM continuity_rules
         WHERE semantic_key = '' AND status NOT IN ('resolved', 'cancelled', 'expired') AND superseded_by IS NULL
         ORDER BY created_at ASC, uri ASC`,
      )
      .all()
      .map(ruleFromRow);
    const canonical: AgentContinuityRule[] = [];
    let consolidated = 0;
    for (const rule of rules) {
      const identity = createAgentContinuityRuleIdentity(rule);
      db.prepare("UPDATE continuity_rules SET semantic_key = ?, condition_key = ?, effect_key = ? WHERE uri = ?").run(
        identity.semanticKey,
        identity.conditionKey,
        identity.effectKey,
        rule.uri,
      );
      appendAgentContinuityRuleEvidence(db, rule.uri, rule.sourceRefs, rule.authority, rule.confidence, rule.createdAt);
      updateAgentContinuityRuleSupport(db, rule.uri, rule.authority, now, policy);
      recordAgentContinuityRuleHistory(db, rule.uri, "created", rule, 1, rule.createdAt);
      const match = new AgentContinuityRuleConsolidator(policy, similarity).match(rule, canonical);
      if (match.relation !== "equivalent" || !match.rule) {
        canonical.push({ ...rule, ...identity });
        continue;
      }
      const winner = reinforceRule(db, match.rule, rule, match.similarity, now, policy);
      db.prepare(
        "UPDATE continuity_rules SET status = 'cancelled', superseded_by = ?, updated_at = ? WHERE uri = ?",
      ).run(winner.uri, now, rule.uri);
      recordAgentContinuityRuleHistory(db, rule.uri, "superseded", rule, match.similarity, now);
      const winnerIndex = canonical.findIndex((entry) => entry.uri === winner.uri);
      canonical[winnerIndex] = winner;
      consolidated += 1;
    }
    db.prepare(
      `UPDATE continuity_rules SET semantic_key = fingerprint
       WHERE semantic_key = ''`,
    ).run();
    return consolidated;
  });
  return transaction();
}

function reinforceRule(
  db: Database.Database,
  existing: AgentContinuityRule,
  draft: AgentContinuityRuleDraft,
  similarity: number,
  now: string,
  policy: AgentContinuityRuleConsolidationPolicy,
): AgentContinuityRule {
  appendAgentContinuityRuleEvidence(
    db,
    existing.uri,
    existing.sourceRefs,
    existing.authority,
    existing.confidence,
    existing.createdAt,
  );
  appendAgentContinuityRuleEvidence(db, existing.uri, draft.sourceRefs, draft.authority, draft.confidence, now);
  const authority = strongestAgentContinuityAuthority(existing.authority, draft.authority);
  const sourceRefs = uniqueStrings([...existing.sourceRefs, ...draft.sourceRefs]);
  const identity = createAgentContinuityRuleIdentity(existing);
  db.prepare(
    `UPDATE continuity_rules SET
       authority = ?, confidence = ?, source_refs_json = ?, semantic_key = ?, condition_key = ?, effect_key = ?, updated_at = ?
     WHERE uri = ?`,
  ).run(
    authority,
    Math.max(existing.confidence, draft.confidence),
    json(sourceRefs),
    identity.semanticKey,
    identity.conditionKey,
    identity.effectKey,
    now,
    existing.uri,
  );
  updateAgentContinuityRuleSupport(db, existing.uri, authority, now, policy);
  recordAgentContinuityRuleHistory(db, existing.uri, "reinforced", draft, similarity, now);
  const stored = db.prepare<[string], RuleRow>("SELECT * FROM continuity_rules WHERE uri = ?").get(existing.uri);
  if (!stored) throw new Error("Consolidated continuity rule is unavailable.");
  const persisted = ruleFromRow(stored);
  registerRuleConcept(db, persisted, now);
  return persisted;
}

function registerRuleConcept(db: Database.Database, rule: AgentContinuityRule, observedAt: string): void {
  registerAgentContinuityConcept(db, {
    recordUri: rule.uri,
    recordKind: "rule",
    scope: rule.scope,
    label: rule.action.summary,
    aliases: [rule.title],
    observedAt,
  });
}

export function listAgentContinuityLiveRules(
  db: Database.Database,
  scopes: readonly AgentContinuityScopeRef[],
): AgentContinuityRule[] {
  const normalized = normalizeScopes(scopes);
  if (normalized.length === 0) return [];
  const where = normalized.map(() => "(scope_kind = ? AND scope_id = ?)").join(" OR ");
  return db
    .prepare<unknown[], RuleRow>(
      `SELECT * FROM continuity_rules
       WHERE status NOT IN ('resolved', 'cancelled', 'expired') AND (${where})
       ORDER BY created_at ASC, uri ASC`,
    )
    .all(...normalized.flatMap((scope) => [scope.kind, scope.id]))
    .map(ruleFromRow);
}

export function listAgentContinuityRules(
  db: Database.Database,
  scopes: readonly AgentContinuityScopeRef[],
): AgentContinuityRule[] {
  const normalized = normalizeScopes(scopes);
  if (normalized.length === 0) return [];
  const where = normalized.map(() => "(scope_kind = ? AND scope_id = ?)").join(" OR ");
  return db
    .prepare<unknown[], RuleRow>(
      `SELECT * FROM continuity_rules
       WHERE superseded_by IS NULL AND (${where})
       ORDER BY created_at DESC, uri ASC`,
    )
    .all(...normalized.flatMap((scope) => [scope.kind, scope.id]))
    .map(ruleFromRow);
}

export function updateAgentContinuityRuleEvaluation(
  db: Database.Database,
  rule: AgentContinuityRule,
  status: AgentContinuityRuleStatus,
  evaluatedAt: string,
): AgentContinuityRule {
  db.prepare(
    `UPDATE continuity_rules
     SET status = ?, last_evaluated_at = ?, updated_at = ?
     WHERE uri = ?`,
  ).run(status, evaluatedAt, evaluatedAt, rule.uri);
  return { ...rule, status, lastEvaluatedAt: evaluatedAt, updatedAt: evaluatedAt };
}

export function acknowledgeAgentContinuityRuleDeliveries(
  db: Database.Database,
  ruleUris: readonly string[],
  deliveredAt: string,
): number {
  const uris = uniqueStrings(ruleUris);
  if (uris.length === 0) return 0;
  const normalizedDeliveredAt = normalizeTimestamp(deliveredAt, "Continuity rule delivery time");
  const transaction = db.transaction(() => {
    const readRule = db.prepare<[string], RuleRow>("SELECT * FROM continuity_rules WHERE uri = ?");
    const statement = db.prepare(
      `UPDATE continuity_rules
       SET status = 'resolved', last_triggered_at = ?, updated_at = ?
       WHERE uri = ? AND status NOT IN ('resolved', 'cancelled', 'expired') AND last_triggered_at IS NULL`,
    );
    return uris.reduce((changes, uri) => {
      const row = readRule.get(uri);
      if (!row || ruleFromRow(row).action.activation !== "once") return changes;
      return changes + statement.run(normalizedDeliveredAt, normalizedDeliveredAt, uri).changes;
    }, 0);
  });
  return transaction();
}
