import type Database from "better-sqlite3";
import { pruneAgentContinuitySourceReferences } from "./AgentContinuitySourceReferences.js";
import type { AgentMemoryDeletionImpact } from "../Memory/AgentMemorySourceRepository.js";
import { rebuildAgentContinuityFactHeads } from "./AgentContinuitySqliteFacts.js";
import { json, stringArray } from "./AgentContinuitySqliteUtils.js";
import { rebuildAgentContinuityRuleSupport } from "./AgentContinuitySqliteRuleEvidence.js";
import { rebuildAgentContinuitySignalHead } from "./AgentContinuitySqliteSignals.js";
import type { AgentContinuityScopeRef } from "./AgentContinuityDomain.js";
import { rebuildAgentContinuityFactEvidence, type FactEvidenceIdentity } from "./AgentContinuitySqliteFactEvidence.js";
import { deleteAgentContinuityGraphSession, pruneAgentContinuityGraphSources } from "./AgentContinuitySqliteGraph.js";
import { agentContinuityObservationUri } from "./AgentContinuityObservationProjection.js";
import { deleteAgentContinuityObservationEmbeddings } from "./AgentContinuitySqliteEmbeddings.js";
import type { AgentContinuityFactReconciliationPolicy } from "./AgentContinuityFactReconciliation.js";
import type { AgentContinuityRuleConsolidationPolicy } from "./AgentContinuityRuleConsolidationPolicy.js";

export function deleteAgentContinuitySources(
  db: Database.Database,
  impact: AgentMemoryDeletionImpact,
  policies: {
    readonly factReconciliation: AgentContinuityFactReconciliationPolicy;
    readonly consolidation: AgentContinuityRuleConsolidationPolicy;
  },
): void {
  const deletedSourceUris = new Set(impact.sourceUris.map((uri) => uri.trim()).filter(Boolean));
  if (deletedSourceUris.size === 0) return;

  const transaction = db.transaction(() => {
    deleteAgentContinuitySourceEmbeddings(db, deletedSourceUris);
    pruneObservationSources(db, deletedSourceUris);
    pruneFactHistorySources(db, deletedSourceUris);
    pruneFactEvidenceSources(db, deletedSourceUris, policies.consolidation);
    pruneSignalSources(db, deletedSourceUris);
    pruneRuleSources(db, deletedSourceUris, policies.consolidation);
    pruneAgentContinuityGraphSources(db, deletedSourceUris, policies.consolidation);
    rebuildAgentContinuityFactHeads(db, policies.factReconciliation);
  });
  transaction();
}

function deleteAgentContinuitySourceEmbeddings(db: Database.Database, deletedSourceUris: ReadonlySet<string>): void {
  const observationUris = [...deletedSourceUris].map(agentContinuityObservationUri);
  deleteAgentContinuityObservationEmbeddings(db, observationUris);
}

export function deleteAgentContinuitySession(db: Database.Database, sessionId: string): void {
  const transaction = db.transaction(() => {
    const observationUris = db
      .prepare<[string], { uri: string }>(
        "SELECT uri FROM continuity_observations WHERE scope_kind = 'session' AND scope_id = ?",
      )
      .all(sessionId)
      .map((row) => row.uri);
    db.prepare("DELETE FROM continuity_fact_history WHERE scope_kind = 'session' AND scope_id = ?").run(sessionId);
    db.prepare("DELETE FROM continuity_fact_evidence WHERE scope_kind = 'session' AND scope_id = ?").run(sessionId);
    db.prepare("DELETE FROM continuity_fact_heads WHERE scope_kind = 'session' AND scope_id = ?").run(sessionId);
    db.prepare("DELETE FROM continuity_observations WHERE scope_kind = 'session' AND scope_id = ?").run(sessionId);
    db.prepare("DELETE FROM continuity_signal_evidence WHERE scope_kind = 'session' AND scope_id = ?").run(sessionId);
    db.prepare("DELETE FROM continuity_signals WHERE scope_kind = 'session' AND scope_id = ?").run(sessionId);
    db.prepare("DELETE FROM continuity_rules WHERE scope_kind = 'session' AND scope_id = ?").run(sessionId);
    deleteAgentContinuityObservationEmbeddings(db, observationUris);
    deleteAgentContinuityGraphSession(db, sessionId);
  });
  transaction();
}

function pruneObservationSources(db: Database.Database, deletedSourceUris: ReadonlySet<string>): void {
  const rows = db
    .prepare<[], { uri: string; source_refs_json: string }>("SELECT uri, source_refs_json FROM continuity_observations")
    .all();
  const update = db.prepare("UPDATE continuity_observations SET source_refs_json = ? WHERE uri = ?");
  const remove = db.prepare("DELETE FROM continuity_observations WHERE uri = ?");
  const removedObservationUris: string[] = [];
  for (const row of rows) {
    const current = stringArray(row.source_refs_json);
    const remaining = pruneAgentContinuitySourceReferences(current, deletedSourceUris);
    if (remaining === undefined) {
      remove.run(row.uri);
      removedObservationUris.push(row.uri);
    } else if (remaining.length !== current.length) update.run(json(remaining), row.uri);
  }
  deleteAgentContinuityObservationEmbeddings(db, removedObservationUris);
}

function pruneFactHistorySources(db: Database.Database, deletedSourceUris: ReadonlySet<string>): void {
  const rows = db
    .prepare<[], { id: string; source_refs_json: string }>("SELECT id, source_refs_json FROM continuity_fact_history")
    .all();
  const update = db.prepare("UPDATE continuity_fact_history SET source_refs_json = ? WHERE id = ?");
  const remove = db.prepare("DELETE FROM continuity_fact_history WHERE id = ?");
  for (const row of rows) {
    const current = stringArray(row.source_refs_json);
    const remaining = pruneAgentContinuitySourceReferences(current, deletedSourceUris);
    if (remaining === undefined) remove.run(row.id);
    else if (remaining.length !== current.length) update.run(json(remaining), row.id);
  }
}

function pruneFactEvidenceSources(
  db: Database.Database,
  deletedSourceUris: ReadonlySet<string>,
  policy: AgentContinuityRuleConsolidationPolicy,
): void {
  const rows = db
    .prepare<
      [],
      {
        scope_kind: AgentContinuityScopeRef["kind"];
        scope_id: string;
        fact_key: string;
        claim_key: string;
        evidence_key: string;
        source_refs_json: string;
      }
    >("SELECT scope_kind, scope_id, fact_key, claim_key, evidence_key, source_refs_json FROM continuity_fact_evidence")
    .all();
  const update = db.prepare(
    `UPDATE continuity_fact_evidence SET source_refs_json = ?
     WHERE scope_kind = ? AND scope_id = ? AND fact_key = ? AND claim_key = ? AND evidence_key = ?`,
  );
  const remove = db.prepare(
    `DELETE FROM continuity_fact_evidence
     WHERE scope_kind = ? AND scope_id = ? AND fact_key = ? AND claim_key = ? AND evidence_key = ?`,
  );
  const affected = new Map<string, FactEvidenceIdentity>();
  for (const row of rows) {
    const current = stringArray(row.source_refs_json);
    const remaining = pruneAgentContinuitySourceReferences(current, deletedSourceUris);
    const identity = {
      scope: { kind: row.scope_kind, id: row.scope_id },
      factKey: row.fact_key,
      claimKey: row.claim_key,
      evidenceKey: row.evidence_key,
    } satisfies FactEvidenceIdentity;
    if (remaining === undefined)
      remove.run(row.scope_kind, row.scope_id, row.fact_key, row.claim_key, row.evidence_key);
    else if (remaining.length !== current.length)
      update.run(json(remaining), row.scope_kind, row.scope_id, row.fact_key, row.claim_key, row.evidence_key);
    if (remaining === undefined || remaining.length !== current.length)
      affected.set(factEvidenceKey(identity), identity);
  }
  for (const identity of affected.values()) {
    rebuildAgentContinuityFactEvidence(db, identity, new Date().toISOString(), policy);
  }
}

function factEvidenceKey(identity: FactEvidenceIdentity): string {
  return [identity.scope.kind, identity.scope.id, identity.factKey, identity.claimKey, identity.evidenceKey].join(
    "\u0000",
  );
}

function pruneSignalSources(db: Database.Database, deletedSourceUris: ReadonlySet<string>): void {
  const rows = db
    .prepare<
      [],
      {
        scope_kind: AgentContinuityScopeRef["kind"];
        scope_id: string;
        namespace: string;
        signal_key: string;
        evidence_key: string;
        source_refs_json: string;
      }
    >(
      `SELECT scope_kind, scope_id, namespace, signal_key, evidence_key, source_refs_json
       FROM continuity_signal_evidence`,
    )
    .all();
  const update = db.prepare(
    `UPDATE continuity_signal_evidence SET source_refs_json = ?
     WHERE scope_kind = ? AND scope_id = ? AND namespace = ? AND signal_key = ? AND evidence_key = ?`,
  );
  const remove = db.prepare(
    `DELETE FROM continuity_signal_evidence
     WHERE scope_kind = ? AND scope_id = ? AND namespace = ? AND signal_key = ? AND evidence_key = ?`,
  );
  const affected = new Map<
    string,
    { scopeKind: AgentContinuityScopeRef["kind"]; scopeId: string; namespace: string; key: string }
  >();
  for (const row of rows) {
    const current = stringArray(row.source_refs_json);
    const remaining = pruneAgentContinuitySourceReferences(current, deletedSourceUris);
    if (remaining === undefined)
      remove.run(row.scope_kind, row.scope_id, row.namespace, row.signal_key, row.evidence_key);
    else if (remaining.length !== current.length)
      update.run(json(remaining), row.scope_kind, row.scope_id, row.namespace, row.signal_key, row.evidence_key);
    if (remaining === undefined || remaining.length !== current.length) {
      affected.set([row.scope_kind, row.scope_id, row.namespace, row.signal_key].join("\u0000"), {
        scopeKind: row.scope_kind,
        scopeId: row.scope_id,
        namespace: row.namespace,
        key: row.signal_key,
      });
    }
  }
  const now = new Date().toISOString();
  for (const identity of affected.values()) {
    rebuildAgentContinuitySignalHead(db, identity, now);
  }
}

function pruneRuleSources(
  db: Database.Database,
  deletedSourceUris: ReadonlySet<string>,
  policy: AgentContinuityRuleConsolidationPolicy,
): void {
  pruneRuleEvidenceSources(db, deletedSourceUris);
  pruneRuleHistorySources(db, deletedSourceUris);
  const rows = db
    .prepare<[], { uri: string; source_refs_json: string }>("SELECT uri, source_refs_json FROM continuity_rules")
    .all();
  const update = db.prepare("UPDATE continuity_rules SET source_refs_json = ? WHERE uri = ?");
  const remove = db.prepare("DELETE FROM continuity_rules WHERE uri = ?");
  for (const row of rows) {
    const current = stringArray(row.source_refs_json);
    const remaining = pruneAgentContinuitySourceReferences(current, deletedSourceUris);
    if (remaining === undefined) remove.run(row.uri);
    else if (remaining.length !== current.length) update.run(json(remaining), row.uri);
    if (remaining !== undefined) rebuildAgentContinuityRuleSupport(db, row.uri, new Date().toISOString(), policy);
  }
}

function pruneRuleEvidenceSources(db: Database.Database, deletedSourceUris: ReadonlySet<string>): void {
  const rows = db
    .prepare<[], { rule_uri: string; evidence_key: string; source_refs_json: string }>(
      "SELECT rule_uri, evidence_key, source_refs_json FROM continuity_rule_evidence",
    )
    .all();
  const update = db.prepare(
    "UPDATE continuity_rule_evidence SET source_refs_json = ? WHERE rule_uri = ? AND evidence_key = ?",
  );
  const remove = db.prepare("DELETE FROM continuity_rule_evidence WHERE rule_uri = ? AND evidence_key = ?");
  for (const row of rows) {
    const current = stringArray(row.source_refs_json);
    const remaining = pruneAgentContinuitySourceReferences(current, deletedSourceUris);
    if (remaining === undefined) remove.run(row.rule_uri, row.evidence_key);
    else if (remaining.length !== current.length) update.run(json(remaining), row.rule_uri, row.evidence_key);
  }
}

function pruneRuleHistorySources(db: Database.Database, deletedSourceUris: ReadonlySet<string>): void {
  const rows = db
    .prepare<[], { id: string; source_refs_json: string }>("SELECT id, source_refs_json FROM continuity_rule_history")
    .all();
  const update = db.prepare("UPDATE continuity_rule_history SET source_refs_json = ? WHERE id = ?");
  const remove = db.prepare("DELETE FROM continuity_rule_history WHERE id = ?");
  for (const row of rows) {
    const current = stringArray(row.source_refs_json);
    const remaining = pruneAgentContinuitySourceReferences(current, deletedSourceUris);
    if (remaining === undefined) remove.run(row.id);
    else if (remaining.length !== current.length) update.run(json(remaining), row.id);
  }
}
