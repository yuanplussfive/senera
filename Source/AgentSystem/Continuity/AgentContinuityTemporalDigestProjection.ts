import type { AgentIdentityDisplayValues } from "../Text/AgentTextParts.js";
import { projectAgentTemporalMemoryScope } from "../TemporalMemory/AgentTemporalMemoryIdentity.js";
import { renderAgentTemporalMemoryDigest } from "../TemporalMemory/AgentTemporalMemoryPresentation.js";
import type { AgentTemporalMemorySqliteStore } from "../TemporalMemory/AgentTemporalMemorySqliteStore.js";
import type { AgentTemporalMemoryDigest } from "../TemporalMemory/AgentTemporalMemoryTypes.js";
import type { AgentContinuityIdentityContext } from "./AgentContinuityIdentityStore.js";
import type { AgentContinuityDigestPromptEntry } from "./AgentContinuityMemoryTypes.js";
import { AgentContinuityTextSimilarity } from "./AgentContinuityTextSimilarity.js";

export interface AgentContinuityTemporalDigestSelectionInput {
  readonly temporalMemoryStore?: AgentTemporalMemorySqliteStore;
  readonly identity: AgentContinuityIdentityContext;
  readonly identityDisplayValues?: () => AgentIdentityDisplayValues;
  readonly query: string;
  readonly now: Date;
  readonly maxEntries: number;
  readonly similarity: AgentContinuityTextSimilarity;
  readonly floor: number;
}

/** Projects only relevant sealed summaries; exact detail remains in the temporal store. */
export function selectAgentContinuityTemporalDigests(
  input: AgentContinuityTemporalDigestSelectionInput,
): readonly AgentContinuityDigestPromptEntry[] {
  const store = input.temporalMemoryStore;
  if (!store || input.maxEntries <= 0) return [];

  const scopeKey = projectAgentTemporalMemoryScope(input.identity).key;
  const scored: { readonly digest: AgentTemporalMemoryDigest; readonly score: number }[] = [];
  for (const digest of store.list(scopeKey, {
    granularities: ["segment", "day", "month"],
    statuses: ["sealed"],
    endMs: input.now.getTime(),
  })) {
    const score = input.similarity.compare(input.query, `${digest.summary} ${digest.topics.join(" ")}`).score;
    if (score >= input.floor) scored.push({ digest, score });
  }
  return scored
    .sort((left, right) => right.score - left.score)
    .slice(0, input.maxEntries)
    .map(({ digest, score }) => projectAgentContinuityDigestEntry(digest, score, input.identityDisplayValues?.()));
}

function projectAgentContinuityDigestEntry(
  digest: AgentTemporalMemoryDigest,
  score: number,
  displayValues: AgentIdentityDisplayValues | undefined,
): AgentContinuityDigestPromptEntry {
  const rendered = displayValues ? renderAgentTemporalMemoryDigest(digest, displayValues) : digest;
  return {
    id: digest.id,
    uri: digest.uri,
    granularity: digest.granularity,
    sessionId: digest.sessionId,
    periodStart: digest.periodStart,
    periodEnd: digest.periodEnd,
    summary: rendered.summary,
    topics: [...rendered.topics],
    openLoops: [...rendered.openLoops],
    sourceRevision: digest.sourceRevision,
    childCount: digest.childCount,
    score,
    matchedBy: score > 0 ? ["text_similarity"] : [],
  };
}
