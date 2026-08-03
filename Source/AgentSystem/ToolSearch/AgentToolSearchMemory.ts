import type { ResolvedAgentToolSearchConfig } from "../Types/AgentConfigTypes.js";
import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import {
  AgentToolSearchMemoryBetaPrior,
  confidenceFromSupport,
  learnedKeywordWeights,
  patternFromAggregate,
  projectLearningProjection,
  singleTermWeights,
  weightedSimilarity,
} from "./AgentToolSearchMemoryProjection.js";
import { SqliteToolSearchMemoryStore } from "./AgentToolSearchMemoryStore.js";
import type {
  AgentToolLearningSignal,
  AgentToolSearchEpisode,
  AgentToolSearchMemoryEvidence,
  AgentToolSearchMemoryStore,
  AgentToolUsePattern,
  AgentToolUsePatternMatch,
} from "./AgentToolSearchMemoryTypes.js";
import type {
  AgentLearningEpisode,
  AgentLearningEpisodeResolution,
  AgentLearningSummary,
  AgentSkillLearningEvidence,
  AgentSkillLearningTermAggregate,
} from "./AgentLearningEpisodeTypes.js";
import { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";

export type {
  AgentToolLearningSignal,
  AgentToolSearchEpisode,
  AgentToolSearchEpisodeCall,
  AgentToolSearchFinalOutcome,
  AgentToolSearchLearnedKeyword,
  AgentToolSearchMemoryEvidence,
  AgentToolUsePattern,
} from "./AgentToolSearchMemoryTypes.js";

export class AgentToolSearchMemory {
  private readonly store: AgentToolSearchMemoryStore;
  private readonly tokenizer = new AgentToolSearchTokenizer();

  constructor(
    private readonly config: ResolvedAgentToolSearchConfig,
    workspaceRoot: string,
    store?: AgentToolSearchMemoryStore,
  ) {
    this.store =
      store ?? new SqliteToolSearchMemoryStore(resolveAgentWorkspaceLayout(workspaceRoot).databases.toolSearch);
  }

  record(episode: AgentToolSearchEpisode): void {
    this.store.add(episode, projectLearningProjection(episode, this.tokenizer));
    this.store.prune(this.config.Memory.MaxEpisodes);
  }

  commitToolLearning(
    episode: AgentToolSearchEpisode,
    learningEpisodeId: string,
    resolution: AgentLearningEpisodeResolution,
  ): void {
    this.store.commitToolLearning(
      episode,
      projectLearningProjection(episode, this.tokenizer),
      learningEpisodeId,
      resolution,
    );
    this.store.prune(this.config.Memory.MaxEpisodes);
  }

  rank(queryTokens: readonly string[], projectId: string, now = Date.now()): AgentToolSearchMemoryEvidence[] {
    const querySet = new Set(queryTokens);
    if (querySet.size === 0) {
      return [];
    }

    const evidence = new Map<
      string,
      {
        alpha: number;
        mass: number;
        signals: AgentToolLearningSignal[];
      }
    >();
    for (const term of this.store.terms(projectId)) {
      const similarity = weightedSimilarity(querySet, singleTermWeights(term.term, term.weight, this.tokenizer));
      if (similarity <= 0) {
        continue;
      }

      const decay = this.timeDecay(now - term.lastSeenAt, this.config.Memory.HalfLifeDays);
      const mass = term.support * similarity * decay;
      if (mass <= 0) {
        continue;
      }

      const current = evidence.get(term.toolName) ?? {
        alpha: AgentToolSearchMemoryBetaPrior,
        mass: 0,
        signals: [],
      };
      current.alpha += mass;
      current.mass += mass;
      current.signals.push({
        term: term.term,
        source: term.source,
        support: term.support,
        confidence: confidenceFromSupport(term.support),
        score: mass,
        lastSeenAt: term.lastSeenAt,
      });
      evidence.set(term.toolName, current);
    }

    return [...evidence.entries()]
      .map(([toolName, value]) => {
        const confidence = confidenceFromSupport(value.mass);
        return {
          toolName,
          evidence: value.mass,
          confidence,
          rankScore: confidence * Math.log1p(value.mass),
          signals: value.signals.sort((left, right) => right.score - left.score),
        };
      })
      .sort((left, right) => right.rankScore - left.rankScore);
  }

  patterns(options: {
    queryTokens: readonly string[];
    projectId: string;
    allowedTools: readonly string[];
    minSupport: number;
    limit: number;
  }): AgentToolUsePattern[] {
    if (options.limit <= 0 || options.allowedTools.length === 0) {
      return [];
    }

    const querySet = new Set(options.queryTokens);
    if (querySet.size === 0) {
      return [];
    }

    const allowed = new Set(options.allowedTools);
    const matches: AgentToolUsePatternMatch[] = [];
    for (const pattern of this.store.patterns(options.projectId)) {
      if (!allowed.has(pattern.toolName)) {
        continue;
      }
      const similarity = weightedSimilarity(querySet, learnedKeywordWeights(pattern.triggerTerms, this.tokenizer));
      if (similarity <= 0) {
        continue;
      }
      matches.push(patternFromAggregate(pattern, similarity, this.tokenizer));
    }

    return matches
      .filter((pattern) => pattern.successCount >= options.minSupport)
      .sort((left, right) => right.score - left.score || left.toolName.localeCompare(right.toolName))
      .slice(0, options.limit)
      .map(({ score: _score, ...pattern }) => pattern);
  }

  recordLearningEpisode(episode: AgentLearningEpisode): void {
    this.store.recordLearningEpisode(episode);
  }

  resolveLearningEpisode(id: string, resolution: AgentLearningEpisodeResolution): void {
    this.store.resolveLearningEpisode(id, resolution);
  }

  learningEpisodes(projectId: string, limit: number): AgentLearningEpisode[] {
    return this.store.learningEpisodes(projectId, limit);
  }

  learningEpisode(projectId: string, id: string): AgentLearningEpisode | undefined {
    return this.store.learningEpisode(projectId, id);
  }

  learningSummary(projectId: string): AgentLearningSummary {
    return this.store.learningSummary(projectId);
  }

  skillLearningTerms(projectId: string, skillName?: string): AgentSkillLearningTermAggregate[] {
    return this.store
      .skillLearningTerms(projectId)
      .filter((term) => !skillName || term.skillName === skillName)
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt || left.term.localeCompare(right.term));
  }

  addSkillLearningTerms(terms: readonly AgentSkillLearningTermAggregate[]): void {
    if (terms.length > 0) this.store.addSkillLearningTerms(terms);
  }

  commitSkillLearning(
    terms: readonly AgentSkillLearningTermAggregate[],
    learningEpisodeId: string,
    resolution: AgentLearningEpisodeResolution,
  ): void {
    this.store.commitSkillLearning(terms, learningEpisodeId, resolution);
  }

  rankSkills(options: {
    queryTokens: readonly string[];
    projectId: string;
    revisions: ReadonlyMap<string, string>;
    now?: number;
  }): AgentSkillLearningEvidence[] {
    const query = new Set(options.queryTokens);
    if (query.size === 0 || options.revisions.size === 0) return [];
    const now = options.now ?? Date.now();
    const evidence = new Map<string, { revision: string; mass: number; support: number; terms: Set<string> }>();
    for (const term of this.store.skillLearningTerms(options.projectId)) {
      const revision = options.revisions.get(term.skillName);
      if (!revision || revision !== term.skillRevision) continue;
      const similarity = weightedSimilarity(query, singleTermWeights(term.term, term.weight, this.tokenizer));
      if (similarity <= 0) continue;
      const decay = this.timeDecay(now - term.lastSeenAt, this.config.Memory.HalfLifeDays);
      const current = evidence.get(term.skillName) ?? {
        revision,
        mass: 0,
        support: 0,
        terms: new Set<string>(),
      };
      current.mass += term.support * similarity * decay;
      current.support += term.support;
      current.terms.add(term.term);
      evidence.set(term.skillName, current);
    }
    return [...evidence.entries()]
      .map(([skillName, value]) => {
        const confidence = confidenceFromSupport(value.mass);
        return {
          skillName,
          skillRevision: value.revision,
          evidence: value.mass,
          confidence,
          rankScore: confidence * Math.log1p(value.mass),
          terms: [...value.terms].sort(),
        };
      })
      .sort((left, right) => right.rankScore - left.rankScore || left.skillName.localeCompare(right.skillName));
  }

  close(): void {
    this.store.close();
  }

  private timeDecay(ageMs: number, halfLifeDays: number): number {
    const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
    return halfLifeMs <= 0 ? 1 : 2 ** -(Math.max(0, ageMs) / halfLifeMs);
  }
}
