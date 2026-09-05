import type { AgentMemorySourceRecord } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentContinuityAuthority } from "./AgentContinuityDomain.js";
import { AgentContinuityTextSimilarity } from "./AgentContinuityTextSimilarity.js";
import { AgentContinuityRecallRankingDefaults } from "./AgentContinuityRecallDefaults.js";
import type { ResolvedAgentContinuityRecallRankingConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";

export interface AgentContinuityEvidenceLink {
  readonly sources: readonly AgentMemorySourceRecord[];
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
}

/** Links model summaries to physical episode sources without model-managed indexes. */
export class AgentContinuityEvidenceLinker {
  private readonly similarity: AgentContinuityTextSimilarity;

  constructor(
    private readonly policy: ResolvedAgentContinuityRecallRankingConfig = AgentContinuityRecallRankingDefaults,
  ) {
    this.similarity = new AgentContinuityTextSimilarity(policy.Similarity);
  }

  link(summary: string, sources: readonly AgentMemorySourceRecord[]): AgentContinuityEvidenceLink {
    const eligible = sources.filter((source) => source.sourceKind !== "assistant_final");
    if (eligible.length === 0) throw new Error("Continuity learning requires a physical user or tool source.");

    const ranked = eligible
      .map((source) => ({ source, score: this.similarity.compare(summary, searchableSourceText(source)).score }))
      .sort((left, right) => right.score - left.score || left.source.uri.localeCompare(right.source.uri));
    const bestScore = ranked[0]?.score ?? 0;
    const minimum = Math.max(
      this.policy.Evidence.MinimumRelatedScore,
      bestScore * this.policy.Evidence.RelativeToBestScore,
    );
    const selected = ranked.filter((candidate) => candidate.score >= minimum);
    if (selected.length === 0) {
      throw new Error(`Continuity candidate is not grounded in the episode sources: ${summary}`);
    }
    const authority = authorityForSource(selected[0]!.source);
    return {
      sources: selected.map((candidate) => candidate.source),
      authority,
      confidence: clamp01(bestScore),
    };
  }
}

function searchableSourceText(source: AgentMemorySourceRecord): string {
  return [
    source.summary,
    source.textContent,
    source.toolName,
    source.metadata.evidence ? JSON.stringify(source.metadata.evidence) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function authorityForSource(source: AgentMemorySourceRecord): AgentContinuityAuthority {
  if (source.sourceKind === "user_message") return "user_explicit";
  if (source.sourceKind === "tool_evidence") return "tool_verified";
  return "system_observed";
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
