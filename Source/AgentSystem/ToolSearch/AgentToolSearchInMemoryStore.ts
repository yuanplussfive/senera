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

export class InMemoryToolSearchMemoryStore implements AgentToolSearchMemoryStore {
  private readonly episodes: AgentToolSearchEpisode[] = [];
  private readonly termAggregates = new Map<string, AgentToolLearningTermAggregate>();
  private readonly patternAggregates = new Map<string, AgentToolUsePatternAggregate>();

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

  prune(maxEpisodes: number): void {
    this.episodes.splice(0, Math.max(0, this.episodes.length - maxEpisodes));
  }

  close(): void {}
}
