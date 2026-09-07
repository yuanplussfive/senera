import crypto from "node:crypto";
import type { AgentContinuityScopeRef } from "./AgentContinuityDomain.js";
import type {
  AgentContinuityTextSimilarity,
  AgentContinuityTextSimilarityResult,
} from "./AgentContinuityTextSimilarity.js";

export interface AgentContinuityFactIdentity {
  readonly factKey: string;
  readonly normalizedClaim: string;
}

export interface AgentContinuityFactIdentityCandidate {
  readonly factKey: string;
  readonly claim: string;
  readonly scope: AgentContinuityScopeRef;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

/**
 * Creates a deterministic identity from the host-normalized claim.
 * The model supplies the claim; the host owns identity and versioning.
 */
export function createAgentContinuityFactIdentity(summary: string, explicitKey?: unknown): AgentContinuityFactIdentity {
  const normalizedClaim = normalizeAgentContinuityFactClaim(summary);
  if (!normalizedClaim) throw new Error("Continuity fact summary cannot be empty.");
  const requestedKey = typeof explicitKey === "string" ? explicitKey.trim() : "";
  const factKey = requestedKey || hashFactClaim(normalizedClaim);
  return { factKey, normalizedClaim };
}

/**
 * Reuses an existing host-owned identity when a later extraction only changes
 * the wording. The match is deliberately conservative: fuzzy similarity is
 * used for paraphrase detection, while identity remains deterministic and
 * the model never receives a storage key to invent.
 */
export function resolveAgentContinuityFactIdentity(
  summary: string,
  scope: AgentContinuityScopeRef,
  candidates: readonly AgentContinuityFactIdentityCandidate[],
  similarity: Pick<AgentContinuityTextSimilarity, "compare">,
  fuzzyThreshold: number,
): AgentContinuityFactIdentity {
  const identity = createAgentContinuityFactIdentity(summary);
  const match = candidates
    .filter((candidate) => sameScope(candidate.scope, scope))
    .map((candidate) => ({ candidate, comparison: compareAgentContinuityClaims(similarity, summary, candidate.claim) }))
    .filter(({ comparison }) => isAgentContinuityEquivalentComparison(comparison, fuzzyThreshold))
    .sort(compareMatches)[0];
  return match ? { factKey: match.candidate.factKey, normalizedClaim: identity.normalizedClaim } : identity;
}

/** Paraphrase detection must be direction-independent for CJK-heavy claims. */
export function compareAgentContinuityClaims(
  similarity: Pick<AgentContinuityTextSimilarity, "compare"> &
    Partial<Pick<AgentContinuityTextSimilarity, "compareClaimIdentity">>,
  left: string,
  right: string,
): AgentContinuityTextSimilarityResult {
  const compare = similarity.compareClaimIdentity ?? similarity.compare;
  const forward = compare.call(similarity, left, right);
  const reverse = compare.call(similarity, right, left);
  return {
    score: Math.max(forward.score, reverse.score),
    exact: Math.max(forward.exact, reverse.exact),
    coverage: Math.max(forward.coverage, reverse.coverage),
    fuzzy: Math.max(forward.fuzzy, reverse.fuzzy),
    structuralMismatch:
      forward.structuralMismatch === undefined || reverse.structuralMismatch === undefined
        ? undefined
        : Math.max(forward.structuralMismatch, reverse.structuralMismatch),
  };
}

/**
 * A fuzzy match is only an equivalent claim when both sides agree on the
 * structural markers detected by the local comparator.  Keeping this gate in
 * one helper prevents storage reconciliation and identity routing from
 * drifting into different notions of "same fact".
 */
export function isAgentContinuityEquivalentComparison(
  comparison: Pick<AgentContinuityTextSimilarityResult, "fuzzy" | "structuralMismatch">,
  fuzzyThreshold: number,
): boolean {
  return (
    comparison.fuzzy >= fuzzyThreshold &&
    (comparison.structuralMismatch === undefined || comparison.structuralMismatch === 0)
  );
}

export function isAgentContinuityEquivalentClaim(
  similarity: Pick<AgentContinuityTextSimilarity, "compare"> &
    Partial<Pick<AgentContinuityTextSimilarity, "compareClaimIdentity">>,
  left: string,
  right: string,
  fuzzyThreshold: number,
): boolean {
  if (normalizeAgentContinuityFactClaim(left) === normalizeAgentContinuityFactClaim(right)) return true;
  return isAgentContinuityEquivalentComparison(compareAgentContinuityClaims(similarity, left, right), fuzzyThreshold);
}

export function normalizeAgentContinuityFactClaim(summary: string): string {
  return summary.trim().normalize("NFKC").replace(/\s+/gu, " ").toLocaleLowerCase();
}

function hashFactClaim(normalizedClaim: string): string {
  return `fact_${crypto.createHash("sha256").update(normalizedClaim).digest("hex").slice(0, 24)}`;
}

function sameScope(left: AgentContinuityScopeRef, right: AgentContinuityScopeRef): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function compareMatches(
  left: {
    readonly candidate: AgentContinuityFactIdentityCandidate;
    readonly comparison: AgentContinuityTextSimilarityResult;
  },
  right: {
    readonly candidate: AgentContinuityFactIdentityCandidate;
    readonly comparison: AgentContinuityTextSimilarityResult;
  },
): number {
  return (
    right.comparison.fuzzy - left.comparison.fuzzy ||
    right.comparison.score - left.comparison.score ||
    (left.candidate.createdAt ?? "").localeCompare(right.candidate.createdAt ?? "") ||
    (right.candidate.updatedAt ?? "").localeCompare(left.candidate.updatedAt ?? "") ||
    left.candidate.factKey.localeCompare(right.candidate.factKey)
  );
}
