import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
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
import { configureToolSearchMemoryDatabase, installToolSearchMemorySchema } from "./AgentToolSearchMemorySqlSchema.js";
import {
  prepareToolSearchMemorySqlStatements,
  type ToolSearchMemorySqlStatements,
} from "./AgentToolSearchMemorySqlStatements.js";

export class SqliteToolSearchMemoryStore implements AgentToolSearchMemoryStore {
  private readonly db: Database.Database;
  private readonly stmts: ToolSearchMemorySqlStatements;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    configureToolSearchMemoryDatabase(this.db);
    installToolSearchMemorySchema(this.db);
    this.stmts = prepareToolSearchMemorySqlStatements(this.db);
  }

  add(episode: AgentToolSearchEpisode, projection: AgentToolLearningProjection): void {
    this.stmts.insertEpisode.run(episodeRecord(episode));
    for (const term of projection.terms) {
      this.stmts.insertTerm.run(termAggregateRecord(term));
    }
    for (const pattern of projection.patterns) {
      this.upsertPattern(pattern);
    }
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
    this.db.close();
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
