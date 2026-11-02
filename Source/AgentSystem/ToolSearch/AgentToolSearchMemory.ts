import type { ResolvedAgentToolSearchConfig } from "../Types/AgentConfigTypes.js";
import type { AgentSkillSelectionScenarioEvidence } from "../Skills/AgentSkillSelector.js";
import type {
  AgentToolSearchEpisode,
  AgentToolSearchMemoryEvidence,
  AgentToolSearchScenarioSignal,
} from "./AgentToolSearchMemoryTypes.js";
import type { AgentToolSearchScenarioMatch, AgentToolSearchScenarioSource } from "./AgentToolSearchScenarioSource.js";
export type {
  AgentToolSearchEpisode,
  AgentToolSearchEpisodeCall,
  AgentToolSearchFinalOutcome,
  AgentToolSearchMemoryEvidence,
  AgentToolSearchScenarioSignal,
  AgentToolSearchSkillReference,
} from "./AgentToolSearchMemoryTypes.js";

interface ToolOutcomeObservation {
  readonly status: "success" | "failure";
  readonly weight: number;
  readonly support: number;
  readonly source: string;
  readonly timestamp: number;
}

/**
 * Uniform Beta prior (one virtual success, one virtual failure) scored by one
 * posterior standard deviation below the mean. A tool needs a consistent
 * record, not merely a long one, before memory outranks lexical evidence.
 */
const ReliabilityPrior = 1;
const ReliabilityLowerBoundZ = 1;

function toolReliability(successes: number, failures: number): { mean: number; lowerBound: number } {
  const alpha = ReliabilityPrior + successes;
  const beta = ReliabilityPrior + failures;
  const mean = alpha / (alpha + beta);
  const variance = (mean * (1 - mean)) / (alpha + beta + 1);
  return { mean, lowerBound: mean - ReliabilityLowerBoundZ * Math.sqrt(variance) };
}

/** Request-local scenario weighting. MemOS relevance is preserved; no secondary keyword gate or hydration cache. */
export class AgentToolSearchMemory {
  constructor(
    private readonly config: ResolvedAgentToolSearchConfig,
    private readonly source: AgentToolSearchScenarioSource,
  ) {}
  prepare(query: string, projectId: string): Promise<readonly AgentToolSearchScenarioMatch[]> {
    return this.source.search(query, projectId, this.config.Memory.MaxEpisodes);
  }
  record(episode: AgentToolSearchEpisode, source?: { readonly sessionId?: string; readonly requestId?: string }): void {
    this.source.record(episode, source);
  }
  /**
   * Ranks tools by a Beta posterior lower bound instead of accumulated recall
   * mass. Repeated recalls of one query collapse into a single observation,
   * failed calls count against the tool, and a uniform prior keeps one lucky
   * recall from outranking a longer, mixed record.
   */
  rank(
    matches: readonly AgentToolSearchScenarioMatch[],
    projectId: string,
    now = Date.now(),
  ): AgentToolSearchMemoryEvidence[] {
    const observations = new Map<string, Map<string, ToolOutcomeObservation>>();
    for (const match of matches) {
      const episode = match.episode;
      if (episode.projectId !== projectId || episode.outcome === "unknown") continue;
      const weight = match.score * this.timeDecay(now - episode.timestamp);
      if (weight <= 0) continue;
      for (const call of episode.calls) {
        // An empty result is neither a success nor a failure of the tool.
        if (call.status === "empty") continue;
        // Task success is what makes a successful call reusable evidence.
        if (call.status === "success" && episode.outcome !== "success") continue;
        const byQuery = observations.get(call.toolName) ?? new Map<string, ToolOutcomeObservation>();
        const previous = byQuery.get(episode.query);
        if (previous && previous.timestamp > episode.timestamp) continue;
        byQuery.set(episode.query, {
          status: call.status,
          weight,
          support: call.score,
          source: match.id,
          timestamp: episode.timestamp,
        });
        observations.set(call.toolName, byQuery);
      }
    }

    const evidence: AgentToolSearchMemoryEvidence[] = [];
    for (const [toolName, byQuery] of observations) {
      let successes = 0;
      let failures = 0;
      for (const observation of byQuery.values()) {
        if (observation.status === "success") successes += observation.weight;
        else failures += observation.weight;
      }
      // Failures only widen the denominator of tools that also succeeded.
      if (successes <= 0) continue;
      const reliability = toolReliability(successes, failures);
      evidence.push({
        toolName,
        evidence: successes + failures,
        confidence: reliability.mean,
        rankScore: reliability.lowerBound,
        signals: [...byQuery.entries()]
          .map(([query, observation]): AgentToolSearchScenarioSignal => {
            const signal = toolReliability(
              observation.status === "success" ? observation.weight : 0,
              observation.status === "failure" ? observation.weight : 0,
            );
            return {
              term: query,
              source: observation.source,
              support: observation.support,
              confidence: signal.mean,
              score: observation.weight,
              lastSeenAt: observation.timestamp,
            };
          })
          .sort((left, right) => right.score - left.score || left.term.localeCompare(right.term)),
      });
    }
    return evidence.sort(
      (left, right) => right.rankScore - left.rankScore || left.toolName.localeCompare(right.toolName),
    );
  }
  rankSkillScenarios(options: {
    readonly matches: readonly AgentToolSearchScenarioMatch[];
    readonly projectId: string;
    readonly revisions: ReadonlyMap<string, string>;
    readonly now?: number;
  }): AgentSkillSelectionScenarioEvidence[] {
    const evidence = new Map<string, { revision: string; mass: number; contexts: Set<string> }>();
    for (const match of options.matches) {
      if (match.episode.projectId !== options.projectId || match.episode.outcome !== "success") continue;
      const mass =
        match.score * match.episode.finalScore * this.timeDecay((options.now ?? Date.now()) - match.episode.timestamp);
      if (mass <= 0) continue;
      for (const skill of match.episode.activeSkills) {
        if (options.revisions.get(skill.name) !== skill.revision) continue;
        const current = evidence.get(skill.name) ?? { revision: skill.revision, mass: 0, contexts: new Set<string>() };
        current.mass += mass;
        current.contexts.add(match.episode.query);
        evidence.set(skill.name, current);
      }
    }
    return [...evidence]
      .map(([skillName, value]) => ({
        skillName,
        skillRevision: value.revision,
        rankScore: (1 - Math.exp(-value.mass)) * Math.log1p(value.mass),
        terms: [...value.contexts],
      }))
      .sort((left, right) => right.rankScore - left.rankScore || left.skillName.localeCompare(right.skillName));
  }
  private timeDecay(ageMs: number): number {
    return 2 ** -(Math.max(0, ageMs) / (this.config.Memory.HalfLifeDays * 24 * 60 * 60 * 1000));
  }
}
