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
import { AgentToolSearchMemoryDatabaseMigrations } from "./AgentToolSearchMemorySqlSchema.js";
import {
  prepareToolSearchMemorySqlStatements,
  type ToolSearchMemorySqlStatements,
} from "./AgentToolSearchMemorySqlStatements.js";

export class SqliteToolSearchMemoryStore implements AgentToolSearchMemoryStore {
  private readonly kernel: AgentSqliteDatabaseKernel;
  private readonly db: Database.Database;
  private readonly stmts: ToolSearchMemorySqlStatements;
  private readonly persistEpisode: (episode: AgentToolSearchEpisode, projection: AgentToolLearningProjection) => void;

  constructor(databasePath: string) {
    this.kernel = new AgentSqliteDatabaseKernel({
      databasePath,
      migrations: AgentToolSearchMemoryDatabaseMigrations,
    });
    this.db = this.kernel.connection;
    this.stmts = prepareToolSearchMemorySqlStatements(this.db);
    this.persistEpisode = this.db.transaction(
      (episode: AgentToolSearchEpisode, projection: AgentToolLearningProjection) => {
        this.stmts.insertEpisode.run(episodeRecord(episode));
        for (const term of projection.terms) this.stmts.insertTerm.run(termAggregateRecord(term));
        for (const pattern of projection.patterns) this.upsertPattern(pattern);
      },
    );
  }

  add(episode: AgentToolSearchEpisode, projection: AgentToolLearningProjection): void {
    this.persistEpisode(episode, projection);
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

  prune(maxEpisodes: number): void {
    this.stmts.pruneEpisodes.run(maxEpisodes);
  }

  close(): void {
    this.kernel.close();
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
