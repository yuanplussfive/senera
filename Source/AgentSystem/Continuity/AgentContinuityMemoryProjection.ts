import type { AgentContinuityFactHead } from "./AgentContinuitySqliteStore.js";
import type { AgentContinuityMemoryPromptContext } from "./AgentContinuityMemoryTypes.js";
import type { AgentContinuityRankedRecord } from "./AgentContinuityRecordRanker.js";
import { compareAgentContinuityScopeSpecificity } from "./AgentContinuityScopes.js";
import type { AgentResidentProfilePromptEntry } from "../Profile/AgentResidentProfileTypes.js";
import { isAgentContinuityExactProfileEcho } from "./AgentContinuityLearningDeduplication.js";

/**
 * Keeps model-facing continuity projections separate from storage and ranking.
 * The ranked record still owns the evidence URI; this module only chooses what
 * the prompt is allowed to see for each projection tier.
 */
export function projectAgentContinuityFactCatalog(
  facts: readonly AgentContinuityFactHead[],
  options: {
    readonly residentProfile: readonly AgentResidentProfilePromptEntry[];
    readonly rankedRecords: readonly AgentContinuityRankedRecord[];
  },
): AgentContinuityMemoryPromptContext["factCatalog"] {
  const ranks = new Map(
    options.rankedRecords
      .filter((record) => record.projection === "direct")
      .map((record) => [record.observation.uri, record] as const),
  );
  return selectProjectableFactHeads(facts, options.residentProfile)
    .filter((fact) => ranks.has(fact.observationUri))
    .map((fact) => {
      const rank = ranks.get(fact.observationUri);
      if (!rank) throw new Error(`Ranked continuity fact is missing its score: ${fact.observationUri}`);
      return {
        factKey: fact.factKey,
        claim: fact.claim,
        sourceRefs: [...fact.sourceRefs],
        confidence: fact.confidence,
        authority: fact.authority,
        validFrom: fact.validFrom,
        ...(fact.validUntil ? { validUntil: fact.validUntil } : {}),
        supportCount: fact.supportCount,
        supportMass: fact.supportMass,
        maturity: fact.maturity,
        updatedAt: fact.updatedAt,
        score: rank.score,
        matchedBy: [...rank.matchedBy],
      };
    })
    .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt));
}

export function countAgentContinuityProjectableFacts(
  facts: readonly AgentContinuityFactHead[],
  residentProfile: readonly AgentResidentProfilePromptEntry[],
): number {
  return selectProjectableFactHeads(facts, residentProfile).length;
}

function selectProjectableFactHeads(
  facts: readonly AgentContinuityFactHead[],
  residentProfile: readonly AgentResidentProfilePromptEntry[],
): AgentContinuityFactHead[] {
  return selectFactHeads(facts).filter((fact) => !isProfileBackedFact(fact, residentProfile));
}

function isProfileBackedFact(
  fact: AgentContinuityFactHead,
  profiles: readonly AgentResidentProfilePromptEntry[],
): boolean {
  const factSources = new Set(fact.sourceRefs);
  return profiles.some((profile) => {
    if (!profile.sourceRefs.some((sourceRef) => factSources.has(sourceRef))) return false;
    const value = profileValue(profile.valueJson);
    return isAgentContinuityExactProfileEcho(fact.claim, profile.key, value);
  });
}

function profileValue(valueJson: string): string | number | boolean {
  const value: unknown = JSON.parse(valueJson);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  throw new Error("Resident profile prompt values must be scalar.");
}

function selectFactHeads(facts: readonly AgentContinuityFactHead[]): AgentContinuityFactHead[] {
  const selected = new Map<string, AgentContinuityFactHead>();
  for (const fact of facts) {
    const current = selected.get(fact.factKey);
    if (!current || isMoreSpecificFact(fact, current)) selected.set(fact.factKey, fact);
  }
  return [...selected.values()].sort(
    (left, right) => left.factKey.localeCompare(right.factKey) || left.updatedAt.localeCompare(right.updatedAt),
  );
}

function isMoreSpecificFact(candidate: AgentContinuityFactHead, current: AgentContinuityFactHead): boolean {
  const scopeOrder = compareAgentContinuityScopeSpecificity(candidate.scope, current.scope);
  return scopeOrder > 0 || (scopeOrder === 0 && candidate.updatedAt > current.updatedAt);
}

export function projectAgentContinuityEvidenceCandidates(
  records: readonly AgentContinuityRankedRecord[],
): AgentContinuityMemoryPromptContext["evidenceCandidates"] {
  return uniqueBySourceRefs(
    records
      .filter((entry) => entry.projection === "reference")
      .map((entry) => ({
        sourceRefs: [...entry.observation.sourceRefs],
        score: entry.score,
        matchedBy: [...entry.matchedBy],
      })),
  );
}

export function projectAgentContinuityEventCandidates(
  records: readonly AgentContinuityRankedRecord[],
): NonNullable<AgentContinuityMemoryPromptContext["eventCandidates"]> {
  return uniqueBySourceRefs(
    records.map((entry) => ({
      sourceRefs: [...entry.observation.sourceRefs],
      summary: entry.observation.summary,
      occurredAt: entry.observation.occurredAt,
      score: entry.score,
      matchedBy: [...entry.matchedBy],
    })),
  );
}

function uniqueBySourceRefs<T extends { readonly sourceRefs: readonly string[] }>(entries: readonly T[]): T[] {
  const unique = new Map<string, T>();
  for (const entry of entries) {
    const key = [...entry.sourceRefs].sort().join("\u0000");
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()];
}
