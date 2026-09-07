import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { uniqueStrings } from "../Core/AgentCollections.js";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../Memory/AgentMemorySqlSchema.js";
import { normalizeAgentContinuityScope, type AgentContinuityScopeRef } from "../Continuity/AgentContinuityDomain.js";
import {
  normalizeAgentResidentProfileKey,
  normalizeAgentResidentProfileUntil,
  AgentResidentProfileDraftSchema,
  resolveAgentResidentProfileMaturity,
  type AgentResidentProfileDraft,
  type AgentResidentProfileHistoryEntry,
  type AgentResidentProfileHistoryOperation,
  type AgentResidentProfileRecord,
  type AgentResidentProfileStatus,
} from "./AgentResidentProfileTypes.js";
import type { AgentUpgradeSession } from "../Upgrade/AgentUpgradeSession.js";
import type { AgentMemoryDeletionImpact } from "../Memory/AgentMemorySourceRepository.js";
import { pruneAgentContinuitySourceReferences } from "../Continuity/AgentContinuitySourceReferences.js";
import { groupAgentContinuityEvidenceByEpisode } from "../Continuity/AgentContinuityEvidenceIdentity.js";
import {
  agentContinuityAuthorityRank,
  strongestAgentContinuityAuthority,
} from "../Continuity/AgentContinuityAuthorityPolicy.js";
import {
  AgentContinuityRuleConsolidationDefaults,
  type AgentContinuityRuleConsolidationPolicy,
} from "../Continuity/AgentContinuityRuleConsolidationPolicy.js";
import { registerAgentContinuityConcept } from "../Continuity/AgentContinuityConceptCatalog.js";
import { residentProfileClaim } from "./AgentResidentProfileTypes.js";

interface ProfileRow {
  id: string;
  uri: string;
  subject: AgentResidentProfileRecord["subject"];
  profile_key: string;
  value_json: string;
  value_type: "boolean" | "number" | "string";
  scope_kind: AgentContinuityScopeRef["kind"];
  scope_id: string;
  authority: AgentResidentProfileRecord["authority"];
  confidence: number;
  valid_until: string;
  time_zone: string;
  source_refs_json: string;
  status: AgentResidentProfileStatus;
  maturity: AgentResidentProfileRecord["maturity"];
  superseded_by: string | null;
  support_count: number;
  created_at: string;
  updated_at: string;
}

interface ProfileEvidenceRow {
  profile_id: string;
  evidence_key: string;
  source_refs_json: string;
  authority: AgentResidentProfileRecord["authority"];
  confidence: number;
  observed_at: string;
}

interface ProfileHistoryRow {
  id: string;
  profile_id: string;
  operation: AgentResidentProfileHistoryOperation;
  source_refs_json: string;
  authority: AgentResidentProfileRecord["authority"];
  confidence: number;
  occurred_at: string;
}

export interface AgentResidentProfileSqliteStoreOptions {
  /** Resolves the shared evidence-consolidation thresholds for each write. */
  readonly consolidationPolicy?: () => AgentContinuityRuleConsolidationPolicy;
}

export class AgentResidentProfileSqliteStore {
  private readonly kernel: AgentSqliteDatabaseKernel;
  private readonly ownsKernel: boolean;
  private readonly db: Database.Database;
  private readonly consolidationPolicy?: () => AgentContinuityRuleConsolidationPolicy;

  constructor(
    database: string | AgentSqliteDatabaseKernel,
    upgradeSession?: AgentUpgradeSession,
    options?: AgentResidentProfileSqliteStoreOptions,
  ) {
    this.ownsKernel = typeof database === "string";
    this.kernel =
      typeof database === "string"
        ? new AgentSqliteDatabaseKernel({
            databasePath: database,
            contract: AgentMemoryDatabaseContract,
            upgradeSession,
          })
        : database;
    this.db = this.kernel.connection;
    this.consolidationPolicy = options?.consolidationPolicy;
  }

  private consolidation(): AgentContinuityRuleConsolidationPolicy {
    return this.consolidationPolicy?.() ?? AgentContinuityRuleConsolidationDefaults;
  }

  upsert(draft: AgentResidentProfileDraft, now = new Date().toISOString()): AgentResidentProfileRecord {
    return this.db.transaction(() => this.upsertWithinTransaction(draft, now))();
  }

  upsertMany(
    drafts: readonly AgentResidentProfileDraft[],
    now = new Date().toISOString(),
  ): AgentResidentProfileRecord[] {
    if (drafts.length === 0) return [];
    return this.db.transaction(() => drafts.map((draft) => this.upsertWithinTransaction(draft, now)))();
  }

  private upsertWithinTransaction(draft: AgentResidentProfileDraft, now: string): AgentResidentProfileRecord {
    AgentResidentProfileDraftSchema.parse(draft);
    const scope = normalizeAgentContinuityScope(draft.scope);
    const key = normalizeAgentResidentProfileKey(draft.key);
    const until = normalizeAgentResidentProfileUntil(draft.temporal.until);
    const sourceRefs = uniqueStrings(draft.sourceRefs);
    const fingerprint = profileFingerprint({
      subject: draft.subject,
      key,
      value: draft.value,
      scope,
      until,
    });
    const current = this.db
      .prepare<unknown[], ProfileRow>(
        `SELECT * FROM resident_profile_records
         WHERE scope_kind = ? AND scope_id = ? AND subject = ? AND profile_key = ? AND status = 'active'
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(scope.kind, scope.id, draft.subject, key);
    const currentFingerprint = current ? profileFingerprintFromRow(current) : undefined;
    if (
      current &&
      isEffectiveProfile(current.valid_until, now) &&
      currentFingerprint !== fingerprint &&
      agentContinuityAuthorityRank(current.authority) > agentContinuityAuthorityRank(draft.authority)
    ) {
      return profileFromRow(current);
    }
    if (current && isEffectiveProfile(current.valid_until, now) && currentFingerprint === fingerprint) {
      const mergedRefs = uniqueStrings([...parseStringArray(current.source_refs_json), ...sourceRefs]);
      const authority = strongestAgentContinuityAuthority(current.authority, draft.authority);
      const confidence = Math.max(current.confidence, draft.confidence);
      const evidenceAdded = this.recordEvidence(current.id, sourceRefs, draft.authority, draft.confidence, now);
      const supportCount = this.countEvidence(current.id);
      const maturity = resolveAgentResidentProfileMaturity(authority, supportCount, this.consolidation());
      this.db
        .prepare(
          `UPDATE resident_profile_records
           SET source_refs_json = ?, authority = ?, confidence = ?, support_count = ?, maturity = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(JSON.stringify(mergedRefs), authority, confidence, supportCount, maturity, now, current.id);
      const merged = profileFromRow({
        ...current,
        source_refs_json: JSON.stringify(mergedRefs),
        authority,
        confidence,
        support_count: supportCount,
        maturity,
        updated_at: now,
      });
      if (evidenceAdded) {
        this.recordHistory(current.id, "reinforced", sourceRefs, draft.authority, draft.confidence, now);
      }
      this.registerConcept(merged);
      return merged;
    }

    const id = `profile_${fingerprint}`;
    const existing = this.db
      .prepare<unknown[], ProfileRow>("SELECT * FROM resident_profile_records WHERE id = ?")
      .get(id);
    const existingRefs = existing ? parseStringArray(existing.source_refs_json) : [];
    const authority = existing
      ? strongestAgentContinuityAuthority(existing.authority, draft.authority)
      : draft.authority;
    const confidence = Math.max(existing?.confidence ?? 0, draft.confidence);
    const recordSourceRefs = uniqueStrings([...existingRefs, ...sourceRefs]);
    const record = {
      id,
      uri: `senera://resident-profile/${id}`,
      subject: draft.subject,
      key,
      value: draft.value,
      scope,
      authority,
      confidence,
      temporal: { until, timeZone: draft.temporal.timeZone },
      sourceRefs: recordSourceRefs,
      status: "active" as const,
      supersededBy: null,
      supportCount: existing?.support_count ?? 1,
      maturity: resolveAgentResidentProfileMaturity(authority, existing?.support_count ?? 1, this.consolidation()),
      createdAt: now,
      updatedAt: now,
    } satisfies AgentResidentProfileRecord;
    if (current && current.id !== record.id) {
      this.db
        .prepare(
          `UPDATE resident_profile_records
           SET status = 'superseded', superseded_by = ?, updated_at = ?
           WHERE id = ? AND status = 'active'`,
        )
        .run(record.id, now, current.id);
      this.recordHistory(current.id, "superseded", sourceRefs, draft.authority, draft.confidence, now);
    }
    this.db
      .prepare(
        `INSERT INTO resident_profile_records (
          id, uri, subject, profile_key, value_json, value_type,
          scope_kind, scope_id, authority, confidence, valid_until, time_zone,
          source_refs_json, status, superseded_by, support_count, maturity, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          source_refs_json = excluded.source_refs_json,
          authority = excluded.authority,
          confidence = excluded.confidence,
          status = excluded.status,
          superseded_by = NULL,
          support_count = excluded.support_count,
          maturity = excluded.maturity,
          valid_until = excluded.valid_until,
          time_zone = excluded.time_zone,
          updated_at = excluded.updated_at`,
      )
      .run(
        record.id,
        record.uri,
        record.subject,
        record.key,
        JSON.stringify(record.value),
        valueType(record.value),
        record.scope.kind,
        record.scope.id,
        record.authority,
        record.confidence,
        record.temporal.until,
        record.temporal.timeZone,
        JSON.stringify(record.sourceRefs),
        record.status,
        record.supportCount,
        record.maturity,
        record.createdAt,
        record.updatedAt,
      );
    const evidenceAdded = this.recordEvidence(record.id, sourceRefs, draft.authority, draft.confidence, now);
    const supportCount = this.countEvidence(record.id);
    const maturity = resolveAgentResidentProfileMaturity(record.authority, supportCount, this.consolidation());
    this.db
      .prepare("UPDATE resident_profile_records SET support_count = ?, maturity = ? WHERE id = ?")
      .run(supportCount, maturity, record.id);
    if (!existing || evidenceAdded) {
      this.recordHistory(
        record.id,
        existing ? "reinforced" : "created",
        sourceRefs,
        draft.authority,
        draft.confidence,
        now,
      );
    }
    const stored = this.db
      .prepare<[string], ProfileRow>("SELECT * FROM resident_profile_records WHERE id = ?")
      .get(record.id);
    if (!stored) throw new Error("Resident profile was not persisted.");
    const persisted = profileFromRow(stored);
    this.registerConcept(persisted);
    return persisted;
  }

  private recordEvidence(
    profileId: string,
    sourceRefs: readonly string[],
    authority: AgentResidentProfileRecord["authority"],
    confidence: number,
    observedAt: string,
  ): boolean {
    const groups = groupAgentContinuityEvidenceByEpisode(this.db, sourceRefs);
    let added = false;
    for (const group of groups) {
      const canonicalKey = profileEvidenceKey(profileId, group.key);
      const existing = this.findEvidence(profileId, group.key, canonicalKey);
      if (existing) {
        const mergedRefs = uniqueStrings([...parseStringArray(existing.source_refs_json), ...group.sourceRefs]);
        this.db
          .prepare(
            `UPDATE resident_profile_evidence
             SET evidence_key = ?, source_refs_json = ?, authority = ?, confidence = ?, observed_at = ?
             WHERE profile_id = ? AND evidence_key = ?`,
          )
          .run(
            canonicalKey,
            JSON.stringify(mergedRefs),
            strongestAgentContinuityAuthority(existing.authority, authority),
            Math.max(existing.confidence, confidence),
            observedAt > existing.observed_at ? observedAt : existing.observed_at,
            profileId,
            existing.evidence_key,
          );
        continue;
      }
      const inserted = this.db
        .prepare(
          `INSERT INTO resident_profile_evidence (
            profile_id, evidence_key, source_refs_json, authority, confidence, observed_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(profile_id, evidence_key) DO NOTHING`,
        )
        .run(profileId, canonicalKey, JSON.stringify(group.sourceRefs), authority, confidence, observedAt);
      added ||= inserted.changes > 0;
    }
    return added;
  }

  private findEvidence(profileId: string, groupKey: string, canonicalKey: string): ProfileEvidenceRow | undefined {
    const direct = this.db
      .prepare<[string, string], ProfileEvidenceRow>(
        "SELECT * FROM resident_profile_evidence WHERE profile_id = ? AND evidence_key = ?",
      )
      .get(profileId, canonicalKey);
    if (direct) return direct;
    return this.listEvidence(profileId).find((row) =>
      groupAgentContinuityEvidenceByEpisode(this.db, parseStringArray(row.source_refs_json)).some(
        (group) => group.key === groupKey,
      ),
    );
  }

  private countEvidence(profileId: string): number {
    return (
      this.db
        .prepare<[string], { count: number }>(
          "SELECT COUNT(*) AS count FROM resident_profile_evidence WHERE profile_id = ?",
        )
        .get(profileId)?.count ?? 0
    );
  }

  private recordHistory(
    profileId: string,
    operation: AgentResidentProfileHistoryOperation,
    sourceRefs: readonly string[],
    authority: AgentResidentProfileRecord["authority"],
    confidence: number,
    occurredAt: string,
  ): void {
    const normalizedRefs = uniqueStrings(sourceRefs);
    if (normalizedRefs.length === 0) throw new Error("Resident profile history requires a physical source.");
    const id = crypto
      .createHash("sha256")
      .update(JSON.stringify([profileId, operation, normalizedRefs.slice().sort()]))
      .digest("hex")
      .slice(0, 24);
    this.db
      .prepare(
        `INSERT INTO resident_profile_history (
          id, profile_id, operation, source_refs_json, authority, confidence, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        `profile_history_${id}`,
        profileId,
        operation,
        JSON.stringify(normalizedRefs),
        authority,
        confidence,
        occurredAt,
      );
  }

  private registerConcept(record: AgentResidentProfileRecord): void {
    registerAgentContinuityConcept(this.db, {
      recordUri: record.uri,
      recordKind: "profile",
      scope: record.scope,
      label: record.key,
      aliases: [residentProfileClaim(record.key, record.value)],
      observedAt: record.updatedAt,
    });
  }

  listActive(scopes: readonly AgentContinuityScopeRef[], now = new Date()): AgentResidentProfileRecord[] {
    const normalized = scopes.map(normalizeAgentContinuityScope);
    if (normalized.length === 0) return [];
    const where = normalized.map(() => "(scope_kind = ? AND scope_id = ?)").join(" OR ");
    return this.db
      .prepare<unknown[], ProfileRow>(
        `SELECT * FROM resident_profile_records
         WHERE status = 'active' AND (${where})
           AND (valid_until IN ('session', 'permanent') OR valid_until >= ?)
         ORDER BY subject ASC, profile_key ASC, updated_at DESC`,
      )
      .all(...normalized.flatMap((scope) => [scope.kind, scope.id]), now.toISOString())
      .map(profileFromRow);
  }

  listHistory(scope: AgentContinuityScopeRef, key?: string): AgentResidentProfileHistoryEntry[] {
    const normalizedScope = normalizeAgentContinuityScope(scope);
    const rows = key
      ? this.db
          .prepare<unknown[], ProfileHistoryRow>(
            `SELECT history.* FROM resident_profile_history history
             JOIN resident_profile_records profile ON profile.id = history.profile_id
             WHERE profile.scope_kind = ? AND profile.scope_id = ? AND profile.profile_key = ?
             ORDER BY history.occurred_at DESC, history.id ASC`,
          )
          .all(normalizedScope.kind, normalizedScope.id, normalizeAgentResidentProfileKey(key))
      : this.db
          .prepare<unknown[], ProfileHistoryRow>(
            `SELECT history.* FROM resident_profile_history history
             JOIN resident_profile_records profile ON profile.id = history.profile_id
             WHERE profile.scope_kind = ? AND profile.scope_id = ?
             ORDER BY history.occurred_at DESC, history.id ASC`,
          )
          .all(normalizedScope.kind, normalizedScope.id);
    return rows.map(profileHistoryFromRow);
  }

  /**
   * Regroups pre-migration source references into per-episode evidence rows and
   * re-scores support and maturity through the shared consolidation policy.
   * Idempotent: records without the migration placeholder row are untouched.
   */
  reconcileLegacyLedger(): { regrouped: number; rescored: number } {
    const legacyEvidence = this.db
      .prepare<[], ProfileEvidenceRow>(
        `SELECT * FROM resident_profile_evidence
         WHERE evidence_key LIKE 'legacy\\_%' ESCAPE '\\'`,
      )
      .all();
    let regrouped = 0;
    let rescored = 0;
    const transaction = this.db.transaction(() => {
      const deleteLegacy = this.db.prepare(
        "DELETE FROM resident_profile_evidence WHERE profile_id = ? AND evidence_key = ?",
      );
      for (const legacy of legacyEvidence) {
        const record = this.db
          .prepare<[string], ProfileRow>("SELECT * FROM resident_profile_records WHERE id = ?")
          .get(legacy.profile_id);
        const refs = record ? parseStringArray(legacy.source_refs_json) : [];
        deleteLegacy.run(legacy.profile_id, legacy.evidence_key);
        if (!record || refs.length === 0) continue;
        for (const group of groupAgentContinuityEvidenceByEpisode(this.db, refs)) {
          const evidenceKey = profileEvidenceKey(legacy.profile_id, group.key);
          this.db
            .prepare(
              `INSERT INTO resident_profile_evidence (
                profile_id, evidence_key, source_refs_json, authority, confidence, observed_at
              ) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(profile_id, evidence_key) DO NOTHING`,
            )
            .run(
              legacy.profile_id,
              evidenceKey,
              JSON.stringify(group.sourceRefs),
              record.authority,
              record.confidence,
              legacy.observed_at,
            );
        }
        if (this.rescoreFromEvidence(record)) rescored += 1;
        regrouped += 1;
      }
      for (const record of this.db
        .prepare<[], ProfileRow>(
          `SELECT * FROM resident_profile_records
           WHERE support_count != (SELECT COUNT(*) FROM resident_profile_evidence WHERE profile_id = resident_profile_records.id)`,
        )
        .all()) {
        if (this.rescoreFromEvidence(record)) rescored += 1;
      }
    });
    transaction();
    return { regrouped, rescored };
  }

  private rescoreFromEvidence(row: ProfileRow): boolean {
    const evidenceRows = this.listEvidence(row.id);
    const supportCount = evidenceRows.length;
    const evidenceRefs = uniqueStrings(evidenceRows.flatMap((evidence) => parseStringArray(evidence.source_refs_json)));
    const authority = evidenceRows.reduce(
      (strongest, evidence) => strongestAgentContinuityAuthority(strongest, evidence.authority),
      row.authority,
    );
    const confidence = evidenceRows.reduce(
      (highest, evidence) => Math.max(highest, evidence.confidence),
      row.confidence,
    );
    const maturity = resolveAgentResidentProfileMaturity(authority, supportCount, this.consolidation());
    if (
      supportCount === row.support_count &&
      authority === row.authority &&
      confidence === row.confidence &&
      maturity === row.maturity &&
      sameStringArray(evidenceRefs, parseStringArray(row.source_refs_json))
    ) {
      return false;
    }
    this.db
      .prepare(
        `UPDATE resident_profile_records
         SET authority = ?, confidence = ?, support_count = ?, maturity = ?, source_refs_json = ?
         WHERE id = ?`,
      )
      .run(authority, confidence, supportCount, maturity, JSON.stringify(evidenceRefs), row.id);
    return true;
  }

  deleteSession(sessionId: string): void {
    this.db
      .prepare("DELETE FROM resident_profile_records WHERE scope_kind = 'session' AND scope_id = ?")
      .run(sessionId);
  }

  deleteSources(impact: AgentMemoryDeletionImpact): void {
    const deletedSourceUris = new Set(impact.sourceUris.map((uri) => uri.trim()).filter(Boolean));
    if (deletedSourceUris.size === 0) return;
    const affected = new Set<string>();
    const rows = this.db.prepare<[], ProfileRow>("SELECT * FROM resident_profile_records").all();
    const remove = this.db.prepare("DELETE FROM resident_profile_records WHERE id = ?");
    const transaction = this.db.transaction(() => {
      for (const row of rows) {
        const refs = parseStringArray(row.source_refs_json);
        const remaining = pruneAgentContinuitySourceReferences(refs, deletedSourceUris);
        if (remaining === undefined) {
          remove.run(row.id);
          affected.add(profileIdentity(row));
          continue;
        }

        const evidenceChanged = this.pruneEvidence(row.id, deletedSourceUris);
        const historyChanged = this.pruneHistory(row.id, deletedSourceUris);
        const evidenceRows = this.listEvidence(row.id);
        const evidenceRefs = uniqueStrings(
          evidenceRows.flatMap((evidence) => parseStringArray(evidence.source_refs_json)),
        );
        const survivingRefs = uniqueStrings([...remaining, ...evidenceRefs]);
        if (survivingRefs.length === 0) {
          remove.run(row.id);
          affected.add(profileIdentity(row));
          continue;
        }

        const authority = evidenceRows.reduce(
          (strongest, evidence) => strongestAgentContinuityAuthority(strongest, evidence.authority),
          row.authority,
        );
        const confidence = evidenceRows.reduce(
          (highest, evidence) => Math.max(highest, evidence.confidence),
          row.confidence,
        );
        const supportCount = evidenceRows.length > 0 ? evidenceRows.length : row.support_count;
        const maturity = resolveAgentResidentProfileMaturity(authority, supportCount, this.consolidation());
        if (
          evidenceChanged ||
          historyChanged ||
          survivingRefs.length !== refs.length ||
          authority !== row.authority ||
          confidence !== row.confidence ||
          supportCount !== row.support_count ||
          maturity !== row.maturity
        ) {
          this.db
            .prepare(
              `UPDATE resident_profile_records
               SET authority = ?, confidence = ?, support_count = ?, maturity = ?, source_refs_json = ?
               WHERE id = ?`,
            )
            .run(authority, confidence, supportCount, maturity, JSON.stringify(survivingRefs), row.id);
          affected.add(profileIdentity(row));
        }
      }
      this.restoreLatestProfiles(affected);
    });
    transaction();
  }

  private restoreLatestProfiles(identities: ReadonlySet<string>): void {
    const select = this.db.prepare<[string, string, string, string], ProfileRow>(
      `SELECT * FROM resident_profile_records
       WHERE scope_kind = ? AND scope_id = ? AND subject = ? AND profile_key = ?
         AND status = 'superseded'
         AND (
           json_array_length(source_refs_json) > 0 OR
           EXISTS (SELECT 1 FROM resident_profile_evidence evidence WHERE evidence.profile_id = resident_profile_records.id)
         )
       ORDER BY updated_at DESC, id DESC LIMIT 1`,
    );
    const activate = this.db.prepare(
      "UPDATE resident_profile_records SET status = 'active', superseded_by = NULL, maturity = ? WHERE id = ?",
    );
    for (const identity of identities) {
      const [scopeKind, scopeId, subject, key] = identity.split("\u0000");
      const current = this.db
        .prepare(
          "SELECT 1 FROM resident_profile_records WHERE scope_kind = ? AND scope_id = ? AND subject = ? AND profile_key = ? AND status = 'active' LIMIT 1",
        )
        .get(scopeKind, scopeId, subject, key);
      if (current) continue;
      const previous = select.get(scopeKind, scopeId, subject, key);
      if (previous) {
        const maturity = resolveAgentResidentProfileMaturity(
          previous.authority,
          previous.support_count,
          this.consolidation(),
        );
        activate.run(maturity, previous.id);
        this.registerConcept(profileFromRow({ ...previous, status: "active", superseded_by: null, maturity }));
      }
    }
  }

  private pruneEvidence(profileId: string, deletedSourceUris: ReadonlySet<string>): boolean {
    const rows = this.listEvidence(profileId);
    let changed = false;
    for (const row of rows) {
      const refs = parseStringArray(row.source_refs_json);
      const remaining = pruneAgentContinuitySourceReferences(refs, deletedSourceUris);
      if (remaining === undefined || remaining.length === 0) {
        this.db
          .prepare("DELETE FROM resident_profile_evidence WHERE profile_id = ? AND evidence_key = ?")
          .run(profileId, row.evidence_key);
        changed = true;
      } else if (remaining.length !== refs.length) {
        this.db
          .prepare(
            `UPDATE resident_profile_evidence
             SET source_refs_json = ?
             WHERE profile_id = ? AND evidence_key = ?`,
          )
          .run(JSON.stringify(remaining), profileId, row.evidence_key);
        changed = true;
      }
    }
    return changed;
  }

  private listEvidence(profileId: string): ProfileEvidenceRow[] {
    return this.db
      .prepare<[string], ProfileEvidenceRow>(
        `SELECT * FROM resident_profile_evidence
         WHERE profile_id = ?
         ORDER BY observed_at DESC, evidence_key ASC`,
      )
      .all(profileId);
  }

  private pruneHistory(profileId: string, deletedSourceUris: ReadonlySet<string>): boolean {
    const rows = this.db
      .prepare<[string], Pick<ProfileHistoryRow, "id" | "source_refs_json">>(
        "SELECT id, source_refs_json FROM resident_profile_history WHERE profile_id = ?",
      )
      .all(profileId);
    let changed = false;
    for (const row of rows) {
      const refs = parseStringArray(row.source_refs_json);
      const remaining = pruneAgentContinuitySourceReferences(refs, deletedSourceUris);
      if (remaining === undefined) {
        this.db.prepare("DELETE FROM resident_profile_history WHERE id = ?").run(row.id);
        changed = true;
      } else if (remaining.length !== refs.length) {
        this.db
          .prepare("UPDATE resident_profile_history SET source_refs_json = ? WHERE id = ?")
          .run(JSON.stringify(remaining), row.id);
        changed = true;
      }
    }
    return changed;
  }

  close(): void {
    if (this.ownsKernel) this.kernel.close();
  }
}

function profileFromRow(row: ProfileRow): AgentResidentProfileRecord {
  return {
    id: row.id,
    uri: row.uri,
    subject: row.subject,
    key: row.profile_key,
    value: JSON.parse(row.value_json) as AgentResidentProfileRecord["value"],
    scope: { kind: row.scope_kind, id: row.scope_id },
    authority: row.authority,
    confidence: row.confidence,
    temporal: { until: row.valid_until, timeZone: row.time_zone },
    sourceRefs: parseStringArray(row.source_refs_json),
    status: row.status,
    maturity: row.maturity,
    supersededBy: row.superseded_by,
    supportCount: row.support_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function profileFingerprint(input: {
  subject: AgentResidentProfileRecord["subject"];
  key: string;
  value: AgentResidentProfileRecord["value"];
  scope: AgentContinuityScopeRef;
  until: string;
}): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([input.scope.kind, input.scope.id, input.subject, input.key, input.value, input.until]))
    .digest("hex")
    .slice(0, 24);
}

function profileFingerprintFromRow(row: ProfileRow): string {
  return profileFingerprint({
    subject: row.subject,
    key: row.profile_key,
    value: JSON.parse(row.value_json) as AgentResidentProfileRecord["value"],
    scope: { kind: row.scope_kind, id: row.scope_id },
    until: row.valid_until,
  });
}

function profileEvidenceKey(profileId: string, evidenceGroupKey: string): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([profileId, evidenceGroupKey]))
    .digest("hex")
    .slice(0, 24);
}

function profileHistoryFromRow(row: ProfileHistoryRow): AgentResidentProfileHistoryEntry {
  return {
    id: row.id,
    profileId: row.profile_id,
    operation: row.operation,
    sourceRefs: parseStringArray(row.source_refs_json),
    authority: row.authority,
    confidence: row.confidence,
    occurredAt: row.occurred_at,
  };
}

function valueType(value: AgentResidentProfileRecord["value"]): ProfileRow["value_type"] {
  return typeof value as ProfileRow["value_type"];
}

function isEffectiveProfile(validUntil: string, now: string): boolean {
  if (validUntil === "session" || validUntil === "permanent") return true;
  const expiry = Date.parse(validUntil);
  const current = Date.parse(now);
  return Number.isFinite(expiry) && Number.isFinite(current) && expiry >= current;
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function profileIdentity(row: Pick<ProfileRow, "scope_kind" | "scope_id" | "subject" | "profile_key">): string {
  return [row.scope_kind, row.scope_id, row.subject, row.profile_key].join("\u0000");
}
