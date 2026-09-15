import type { AgentMemorySourceRecord, AgentMemorySourceRepository } from "../Memory/AgentMemorySourceRepository.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { AgentLruCache } from "../Core/AgentLruCache.js";
import { AgentContinuityTextSimilarity } from "./AgentContinuityTextSimilarity.js";
import { AgentContinuityRecallIndexDefaults } from "./AgentContinuityRecallIndex.js";
import type { ResolvedAgentContinuityRecallRankingConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import { readAgentMemorySourceText } from "../Memory/AgentMemorySourceText.js";

/** A quoted interaction example selected for the current turn. */
export interface AgentContinuityStyleExample {
  readonly id: string;
  readonly userText: string;
  readonly assistantText: string;
  readonly sourceRefs: readonly string[];
  readonly observedAt: string;
  readonly score: number;
}

export interface AgentContinuityStyleExampleSelection {
  readonly examples: readonly AgentContinuityStyleExample[];
  readonly available: number;
  readonly matched: number;
}

/** Keeps the physical-turn projection cached while allowing per-query ranking. */
export class AgentContinuityStyleExampleIndex {
  private readonly snapshots = new AgentLruCache<
    string,
    { readonly revision: string; readonly candidates: readonly AgentContinuityStyleExample[] }
  >(AgentContinuityRecallIndexDefaults.snapshotEntries);
  private similaritySnapshot:
    { readonly policyKey: string; readonly similarity: AgentContinuityTextSimilarity } | undefined;

  constructor(private readonly sourceRepository?: AgentMemorySourceRepository) {}

  select(input: {
    readonly sessionId?: string;
    readonly query: string;
    readonly maxEntries: number;
    readonly similarity: ResolvedAgentContinuityRecallRankingConfig["Similarity"];
    readonly minimumScore: number;
  }): AgentContinuityStyleExampleSelection {
    if (!this.sourceRepository || !input.sessionId || input.maxEntries <= 0) {
      return { examples: [], available: 0, matched: 0 };
    }
    const revision = this.sourceRepository.catalogRevision();
    const cached = this.snapshots.get(input.sessionId);
    const candidates = cached?.revision === revision ? cached.candidates : this.buildCandidates(input.sessionId);
    if (!cached || cached.revision !== revision) this.snapshots.set(input.sessionId, { revision, candidates });
    return rankStyleExamples(candidates, input, this.similarityFor(input.similarity));
  }

  clear(sessionId?: string): void {
    if (sessionId) this.snapshots.delete(sessionId);
    else this.snapshots.clear();
  }

  private buildCandidates(sessionId: string): AgentContinuityStyleExample[] {
    return this.sourceRepository!.listEpisodes(sessionId).flatMap((episode) =>
      buildCandidate(episode, this.sourceRepository!.listSources(episode.uri)),
    );
  }

  private similarityFor(
    policy: ResolvedAgentContinuityRecallRankingConfig["Similarity"],
  ): AgentContinuityTextSimilarity {
    const policyKey = JSON.stringify(policy);
    if (this.similaritySnapshot?.policyKey === policyKey) return this.similaritySnapshot.similarity;
    const similarity = new AgentContinuityTextSimilarity(policy);
    this.similaritySnapshot = { policyKey, similarity };
    return similarity;
  }
}

/**
 * Selects prior turns locally. It never calls a model and never treats a
 * prior assistant answer as an instruction; the prompt template quotes it.
 */
export function selectAgentContinuityStyleExamples(input: {
  readonly sourceRepository?: AgentMemorySourceRepository;
  readonly sessionId?: string;
  readonly query: string;
  readonly maxEntries: number;
  readonly similarity: ResolvedAgentContinuityRecallRankingConfig["Similarity"];
  readonly minimumScore: number;
}): AgentContinuityStyleExampleSelection {
  return new AgentContinuityStyleExampleIndex(input.sourceRepository).select(input);
}

function rankStyleExamples(
  candidates: readonly AgentContinuityStyleExample[],
  input: {
    readonly query: string;
    readonly maxEntries: number;
    readonly similarity: ResolvedAgentContinuityRecallRankingConfig["Similarity"];
    readonly minimumScore: number;
  },
  similarity: AgentContinuityTextSimilarity,
): AgentContinuityStyleExampleSelection {
  const scored = candidates.map((candidate) => ({
    candidate,
    score: similarity.compare(input.query, candidate.userText).score,
  }));
  const matched = scored.filter(({ score }) => score >= input.minimumScore);
  const selected = matched
    .sort(
      (left, right) => right.score - left.score || right.candidate.observedAt.localeCompare(left.candidate.observedAt),
    )
    .slice(0, input.maxEntries)
    .map(({ candidate, score }) => ({ ...candidate, score }));
  return { examples: selected, available: candidates.length, matched: matched.length };
}

function buildCandidate(
  episode: { readonly uri: string; readonly assistantPreview: string; readonly completedAt: string },
  sources: readonly AgentMemorySourceRecord[],
): AgentContinuityStyleExample[] {
  const user = sources.find((source) => source.sourceKind === "user_message");
  const assistant = sources.find((source) => source.sourceKind === "assistant_final");
  const userText = sourceText(user);
  const assistantText = sourceText(assistant) || episode.assistantPreview.trim();
  if (!userText || !assistantText) return [];
  return [
    {
      id: `style_${sha256HexOfCanonicalJson({ episode: episode.uri, userText, assistantText }).slice(0, 24)}`,
      userText,
      assistantText,
      sourceRefs: [user?.uri, assistant?.uri].filter((value): value is string => Boolean(value)),
      observedAt: episode.completedAt,
      score: 0,
    },
  ];
}

function sourceText(source: AgentMemorySourceRecord | undefined): string {
  return source ? readAgentMemorySourceText(source) : "";
}
