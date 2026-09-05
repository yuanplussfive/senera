import type { AgentContinuityScopeRef } from "../Continuity/AgentContinuityDomain.js";
import type { AgentMemoryDeletionImpact } from "../Memory/AgentMemorySourceRepository.js";
import { compareAgentContinuityScopeSpecificity } from "../Continuity/AgentContinuityScopes.js";
import type {
  AgentResidentProfileDraft,
  AgentResidentProfileHistoryEntry,
  AgentResidentProfilePromptEntry,
  AgentResidentProfileRecord,
} from "./AgentResidentProfileTypes.js";
import { AgentResidentProfileMaturities, residentProfileClaim } from "./AgentResidentProfileTypes.js";
import { AgentResidentProfileSqliteStore } from "./AgentResidentProfileSqliteStore.js";
import { agentContinuityAuthorityRank } from "../Continuity/AgentContinuityAuthorityPolicy.js";

export interface AgentResidentProfileServiceOptions {
  readonly store: AgentResidentProfileSqliteStore;
}

/** Provides the small always-available profile layer used by prompt compilation. */
export class AgentResidentProfileService {
  constructor(private readonly options: AgentResidentProfileServiceOptions) {}

  record(draft: AgentResidentProfileDraft, now?: string) {
    return this.options.store.upsert(draft, now);
  }

  recordMany(drafts: readonly AgentResidentProfileDraft[], now?: string) {
    return this.options.store.upsertMany(drafts, now);
  }

  history(scope: AgentContinuityScopeRef, key?: string): AgentResidentProfileHistoryEntry[] {
    return this.options.store.listHistory(scope, key);
  }

  promptContext(scopes: readonly AgentContinuityScopeRef[], now = new Date()): AgentResidentProfilePromptEntry[] {
    const records = selectProfileScopeHeads(this.options.store.listActive(scopes, now));
    return records.map((record) => ({
      subject: record.subject,
      key: record.key,
      valueJson: JSON.stringify(record.value),
      claim: residentProfileClaim(record.key, record.value),
      validUntil:
        record.temporal.until !== "permanent" && record.temporal.until !== "session" ? record.temporal.until : "",
      sourceRefs: [...record.sourceRefs],
      maturity: record.maturity,
      supportCount: record.supportCount,
    }));
  }

  deleteSession(sessionId: string): void {
    this.options.store.deleteSession(sessionId);
  }

  deleteSources(impact: AgentMemoryDeletionImpact): void {
    this.options.store.deleteSources(impact);
  }
}

function selectProfileScopeHeads(records: readonly AgentResidentProfileRecord[]): AgentResidentProfileRecord[] {
  const selected = new Map<string, AgentResidentProfileRecord>();
  for (const record of records) {
    const key = `${record.subject}\u0000${record.key}`;
    const current = selected.get(key);
    if (!current || isMoreSpecificProfile(record, current)) selected.set(key, record);
  }
  return [...selected.values()].sort(compareProfilePromptPriority);
}

function isMoreSpecificProfile(candidate: AgentResidentProfileRecord, current: AgentResidentProfileRecord): boolean {
  const scopeOrder = compareAgentContinuityScopeSpecificity(candidate.scope, current.scope);
  return scopeOrder > 0 || (scopeOrder === 0 && candidate.updatedAt > current.updatedAt);
}

function compareProfilePromptPriority(left: AgentResidentProfileRecord, right: AgentResidentProfileRecord): number {
  return (
    AgentResidentProfileMaturities.indexOf(right.maturity) - AgentResidentProfileMaturities.indexOf(left.maturity) ||
    right.supportCount - left.supportCount ||
    agentContinuityAuthorityRank(right.authority) - agentContinuityAuthorityRank(left.authority) ||
    right.confidence - left.confidence ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.subject.localeCompare(right.subject) ||
    left.key.localeCompare(right.key)
  );
}
