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
  rank(
    matches: readonly AgentToolSearchScenarioMatch[],
    projectId: string,
    now = Date.now(),
  ): AgentToolSearchMemoryEvidence[] {
    const evidence = new Map<string, { mass: number; signals: AgentToolSearchScenarioSignal[] }>();
    for (const match of matches) {
      if (match.episode.projectId !== projectId || match.episode.outcome !== "success") continue;
      const scores = new Map<string, number>();
      for (const call of match.episode.calls)
        if (call.status === "success") scores.set(call.toolName, Math.max(scores.get(call.toolName) ?? 0, call.score));
      for (const [toolName, callScore] of scores) {
        const mass = match.score * match.episode.finalScore * callScore * this.timeDecay(now - match.episode.timestamp);
        if (mass <= 0) continue;
        const current = evidence.get(toolName) ?? { mass: 0, signals: [] };
        current.mass += mass;
        current.signals.push({
          term: match.episode.query,
          source: match.id,
          support: callScore,
          confidence: 1 - Math.exp(-mass),
          score: mass,
          lastSeenAt: match.episode.timestamp,
        });
        evidence.set(toolName, current);
      }
    }
    return [...evidence]
      .map(([toolName, value]) => ({
        toolName,
        evidence: value.mass,
        confidence: 1 - Math.exp(-value.mass),
        rankScore: (1 - Math.exp(-value.mass)) * Math.log1p(value.mass),
        signals: value.signals.sort((left, right) => right.score - left.score),
      }))
      .sort((left, right) => right.rankScore - left.rankScore || left.toolName.localeCompare(right.toolName));
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
