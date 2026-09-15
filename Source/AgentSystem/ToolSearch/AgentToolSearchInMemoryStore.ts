import {
  mergePatternAggregate,
  mergeTermAggregate,
  patternAggregateKey,
  termAggregateKey,
} from "./AgentToolSearchMemoryProjection.js";
import type {
  AgentToolLearningProjection,
  AgentToolLearningTermAggregate,
  AgentToolSearchEpisode,
  AgentToolSearchMemoryStore,
  AgentToolUsePatternAggregate,
} from "./AgentToolSearchMemoryTypes.js";
import type {
  AgentLearningEpisode,
  AgentLearningEpisodeResolution,
  AgentLearningSummary,
  AgentSkillLearningTermAggregate,
} from "./AgentLearningEpisodeTypes.js";

export class InMemoryToolSearchMemoryStore implements AgentToolSearchMemoryStore {
  private readonly episodes: AgentToolSearchEpisode[] = [];
  private readonly termAggregates = new Map<string, AgentToolLearningTermAggregate>();
  private readonly patternAggregates = new Map<string, AgentToolUsePatternAggregate>();
  private readonly learningEpisodeRecords = new Map<string, AgentLearningEpisode>();
  private readonly skillTermAggregates = new Map<string, AgentSkillLearningTermAggregate>();

  add(episode: AgentToolSearchEpisode, projection: AgentToolLearningProjection): void {
    this.episodes.push(episode);
    for (const term of projection.terms) {
      const key = termAggregateKey(term);
      this.termAggregates.set(key, mergeTermAggregate(this.termAggregates.get(key), term));
    }
    for (const pattern of projection.patterns) {
      const key = patternAggregateKey(pattern);
      this.patternAggregates.set(key, mergePatternAggregate(this.patternAggregates.get(key), pattern));
    }
  }

  commitToolLearning(
    episode: AgentToolSearchEpisode,
    projection: AgentToolLearningProjection,
    learningEpisodeId: string,
    resolution: AgentLearningEpisodeResolution,
  ): void {
    this.requireLearningEpisode(learningEpisodeId);
    this.add(episode, projection);
    this.resolveLearningEpisode(learningEpisodeId, resolution);
  }

  list(projectId: string, limit: number): AgentToolSearchEpisode[] {
    return this.episodes
      .filter((episode) => episode.projectId === projectId)
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, limit);
  }

  terms(projectId: string): AgentToolLearningTermAggregate[] {
    return [...this.termAggregates.values()].filter((entry) => entry.projectId === projectId);
  }

  patterns(projectId: string): AgentToolUsePatternAggregate[] {
    return [...this.patternAggregates.values()].filter((entry) => entry.projectId === projectId);
  }

  recordLearningEpisode(episode: AgentLearningEpisode): void {
    if (this.learningEpisodeRecords.has(episode.id)) throw new Error(`Learning episode already exists: ${episode.id}`);
    this.learningEpisodeRecords.set(episode.id, structuredClone(episode));
  }

  resolveLearningEpisode(id: string, resolution: AgentLearningEpisodeResolution): void {
    const current = this.learningEpisodeRecords.get(id);
    if (!current) throw new Error(`Learning episode does not exist: ${id}`);
    this.learningEpisodeRecords.set(id, {
      ...current,
      ...resolution,
      error: resolution.error ?? "",
      attempts: resolution.attempts ?? 1,
    });
  }

  learningEpisodes(projectId: string, limit: number): AgentLearningEpisode[] {
    return [...this.learningEpisodeRecords.values()]
      .filter((episode) => episode.projectId === projectId)
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.id.localeCompare(right.id))
      .slice(0, limit)
      .map((episode) => structuredClone(episode));
  }

  learningEpisode(projectId: string, id: string): AgentLearningEpisode | undefined {
    const episode = this.learningEpisodeRecords.get(id);
    return episode?.projectId === projectId ? structuredClone(episode) : undefined;
  }

  learningSummary(projectId: string): AgentLearningSummary {
    const episodes = [...this.learningEpisodeRecords.values()].filter((episode) => episode.projectId === projectId);
    const groups = new Map<string, AgentLearningSummary["episodeGroups"][number]>();
    for (const episode of episodes) {
      const key = `${episode.domain}\u0000${episode.state}`;
      const current = groups.get(key);
      groups.set(key, {
        domain: episode.domain,
        state: episode.state,
        count: (current?.count ?? 0) + 1,
      });
    }
    return {
      episodeCount: episodes.length,
      episodeGroups: [...groups.values()].sort(
        (left, right) => left.domain.localeCompare(right.domain) || left.state.localeCompare(right.state),
      ),
      skillTermCount: this.skillLearningTerms(projectId).length,
    };
  }

  addSkillLearningTerms(terms: readonly AgentSkillLearningTermAggregate[]): void {
    for (const term of terms) {
      const key = [term.projectId, term.skillName, term.skillRevision, term.source, term.term].join("\u0000");
      const current = this.skillTermAggregates.get(key);
      this.skillTermAggregates.set(
        key,
        current
          ? {
              ...current,
              support: current.support + term.support,
              weight: Math.max(current.weight, term.weight),
              lastSeenAt: Math.max(current.lastSeenAt, term.lastSeenAt),
            }
          : { ...term },
      );
    }
  }

  commitSkillLearning(
    terms: readonly AgentSkillLearningTermAggregate[],
    learningEpisodeId: string,
    resolution: AgentLearningEpisodeResolution,
  ): void {
    this.requireLearningEpisode(learningEpisodeId);
    this.addSkillLearningTerms(terms);
    this.resolveLearningEpisode(learningEpisodeId, resolution);
  }

  skillLearningTerms(projectId: string): AgentSkillLearningTermAggregate[] {
    return [...this.skillTermAggregates.values()].filter((term) => term.projectId === projectId);
  }

  prune(maxEpisodes: number): void {
    this.episodes.splice(0, Math.max(0, this.episodes.length - maxEpisodes));
  }

  close(): void {}

  private requireLearningEpisode(id: string): AgentLearningEpisode {
    const episode = this.learningEpisodeRecords.get(id);
    if (!episode) throw new Error(`Learning episode does not exist: ${id}`);
    return episode;
  }
}
