import type Database from "better-sqlite3";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import { mergePatternAggregate } from "./AgentToolSearchMemoryProjection.js";
import type {
  AgentToolLearningProjection,
  AgentToolLearningTermAggregate,
  AgentToolSearchEpisode,
  AgentToolSearchMemoryStore,
  AgentToolUsePatternAggregate,
} from "./AgentToolSearchMemoryTypes.js";
import {
  episodeRecord,
  patternAggregateRecord,
  rowToEpisode,
  rowToPatternAggregate,
  rowToTermAggregate,
  termAggregateRecord,
} from "./AgentToolSearchMemoryCodec.js";
import { AgentToolSearchLearningStoreContract } from "./AgentToolSearchMemorySqlSchema.js";
import {
  prepareToolSearchMemorySqlStatements,
  type ToolSearchMemorySqlStatements,
} from "./AgentToolSearchMemorySqlStatements.js";
import {
  prepareAgentLearningEpisodeSqlStatements,
  type AgentLearningEpisodeSqlStatements,
} from "./AgentLearningEpisodeSqlStatements.js";
import {
  learningEpisodeRecord,
  learningEpisodeResolutionRecord,
  rowToLearningEpisode,
  rowToSkillLearningTerm,
  skillLearningTermRecord,
} from "./AgentLearningEpisodeCodec.js";
import type {
  AgentLearningEpisode,
  AgentLearningEpisodeResolution,
  AgentLearningSummary,
  AgentSkillLearningTermAggregate,
} from "./AgentLearningEpisodeTypes.js";

export class SqliteToolSearchMemoryStore implements AgentToolSearchMemoryStore {
  private readonly kernel: AgentSqliteDatabaseKernel;
  private readonly db: Database.Database;
  private readonly stmts: ToolSearchMemorySqlStatements;
  private readonly learningStmts: AgentLearningEpisodeSqlStatements;
  private readonly persistEpisode: (episode: AgentToolSearchEpisode, projection: AgentToolLearningProjection) => void;
  private readonly persistToolLearning: (
    episode: AgentToolSearchEpisode,
    projection: AgentToolLearningProjection,
    learningEpisodeId: string,
    resolution: AgentLearningEpisodeResolution,
  ) => void;
  private readonly persistSkillLearning: (
    terms: readonly AgentSkillLearningTermAggregate[],
    learningEpisodeId: string,
    resolution: AgentLearningEpisodeResolution,
  ) => void;

  constructor(databasePath: string) {
    this.kernel = new AgentSqliteDatabaseKernel({
      databasePath,
      contract: AgentToolSearchLearningStoreContract,
    });
    this.db = this.kernel.connection;
    this.stmts = prepareToolSearchMemorySqlStatements(this.db);
    this.learningStmts = prepareAgentLearningEpisodeSqlStatements(this.db);
    this.persistEpisode = this.db.transaction(
      (episode: AgentToolSearchEpisode, projection: AgentToolLearningProjection) =>
        this.insertEpisode(episode, projection),
    );
    this.persistToolLearning = this.db.transaction(
      (
        episode: AgentToolSearchEpisode,
        projection: AgentToolLearningProjection,
        learningEpisodeId: string,
        resolution: AgentLearningEpisodeResolution,
      ) => {
        this.insertEpisode(episode, projection);
        this.updateLearningEpisode(learningEpisodeId, resolution);
      },
    );
    this.persistSkillLearning = this.db.transaction(
      (
        terms: readonly AgentSkillLearningTermAggregate[],
        learningEpisodeId: string,
        resolution: AgentLearningEpisodeResolution,
      ) => {
        this.insertSkillLearningTerms(terms);
        this.updateLearningEpisode(learningEpisodeId, resolution);
      },
    );
  }

  add(episode: AgentToolSearchEpisode, projection: AgentToolLearningProjection): void {
    this.persistEpisode(episode, projection);
  }

  commitToolLearning(
    episode: AgentToolSearchEpisode,
    projection: AgentToolLearningProjection,
    learningEpisodeId: string,
    resolution: AgentLearningEpisodeResolution,
  ): void {
    this.persistToolLearning(episode, projection, learningEpisodeId, resolution);
  }

  list(projectId: string, limit: number): AgentToolSearchEpisode[] {
    return this.stmts.listEpisodes.all(projectId, limit).map(rowToEpisode);
  }

  terms(projectId: string): AgentToolLearningTermAggregate[] {
    return this.stmts.listTerms.all(projectId).map(rowToTermAggregate);
  }

  patterns(projectId: string): AgentToolUsePatternAggregate[] {
    return this.stmts.listPatterns.all(projectId).map(rowToPatternAggregate);
  }

  recordLearningEpisode(episode: AgentLearningEpisode): void {
    this.learningStmts.insertLearningEpisode.run(learningEpisodeRecord(episode));
  }

  resolveLearningEpisode(id: string, resolution: AgentLearningEpisodeResolution): void {
    this.updateLearningEpisode(id, resolution);
  }

  learningEpisodes(projectId: string, limit: number): AgentLearningEpisode[] {
    return this.learningStmts.listLearningEpisodes.all(projectId, limit).map(rowToLearningEpisode);
  }

  learningEpisode(projectId: string, id: string): AgentLearningEpisode | undefined {
    const row = this.learningStmts.selectLearningEpisode.get(projectId, id);
    return row ? rowToLearningEpisode(row) : undefined;
  }

  learningSummary(projectId: string): AgentLearningSummary {
    const episodeGroups = this.learningStmts.summarizeLearningEpisodes.all(projectId);
    return {
      episodeCount: episodeGroups.reduce((total, group) => total + group.count, 0),
      episodeGroups,
      skillTermCount: this.learningStmts.countSkillLearningTerms.get(projectId)?.count ?? 0,
    };
  }

  addSkillLearningTerms(terms: readonly AgentSkillLearningTermAggregate[]): void {
    const persist = this.db.transaction((values: readonly AgentSkillLearningTermAggregate[]) => {
      this.insertSkillLearningTerms(values);
    });
    persist(terms);
  }

  commitSkillLearning(
    terms: readonly AgentSkillLearningTermAggregate[],
    learningEpisodeId: string,
    resolution: AgentLearningEpisodeResolution,
  ): void {
    this.persistSkillLearning(terms, learningEpisodeId, resolution);
  }

  skillLearningTerms(projectId: string): AgentSkillLearningTermAggregate[] {
    return this.learningStmts.listSkillLearningTerms.all(projectId).map(rowToSkillLearningTerm);
  }

  prune(maxEpisodes: number): void {
    this.stmts.pruneEpisodes.run(maxEpisodes);
  }

  close(): void {
    this.kernel.close();
  }

  private insertEpisode(episode: AgentToolSearchEpisode, projection: AgentToolLearningProjection): void {
    this.stmts.insertEpisode.run(episodeRecord(episode));
    for (const term of projection.terms) this.stmts.insertTerm.run(termAggregateRecord(term));
    for (const pattern of projection.patterns) this.upsertPattern(pattern);
  }

  private insertSkillLearningTerms(terms: readonly AgentSkillLearningTermAggregate[]): void {
    for (const term of terms) this.learningStmts.insertSkillLearningTerm.run(skillLearningTermRecord(term));
  }

  private updateLearningEpisode(id: string, resolution: AgentLearningEpisodeResolution): void {
    const result = this.learningStmts.updateLearningEpisode.run(learningEpisodeResolutionRecord(id, resolution));
    if (result.changes !== 1) throw new Error(`Learning episode does not exist: ${id}`);
  }

  private upsertPattern(pattern: AgentToolUsePatternAggregate): void {
    const current = this.stmts.selectPattern.get(pattern.projectId, pattern.toolName, pattern.patternKey);
    const merged = current ? mergePatternAggregate(rowToPatternAggregate(current), pattern) : pattern;
    const record = patternAggregateRecord(merged);

    if (current) {
      this.stmts.updatePattern.run(record);
      return;
    }

    this.stmts.insertPattern.run(record);
  }
}
