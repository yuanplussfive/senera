import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { z } from "zod";
import type { ResolvedAgentToolSearchConfig } from "./Types/AgentConfigTypes.js";
import { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";

export interface AgentToolSearchEpisode {
  query: string;
  queryTokens: string[];
  plannerTags: string[];
  candidates: string[];
  chosenTools: string[];
  learnedKeywords: AgentToolSearchLearnedKeyword[];
  outcome: "success" | "failure" | "unknown";
  calls: AgentToolSearchEpisodeCall[];
  finalScore: number;
  finalOutcome: AgentToolSearchFinalOutcome;
  projectId: string;
  timestamp: number;
}

export interface AgentToolSearchLearnedKeyword {
  toolName: string;
  value: string;
  source: string;
  weight: number;
}

export interface AgentToolSearchEpisodeCall {
  toolName: string;
  argumentKeys: string[];
  evidenceKinds: string[];
  status: "success" | "failure" | "empty";
  evidenceUris: string[];
  artifactUris: string[];
  hasArtifact: boolean;
  hasEvidence: boolean;
  hasWorkspaceChanges: boolean;
  errorCode: string;
  error: string;
  score: number;
}

export interface AgentToolSearchFinalOutcome {
  toolExecutionSucceeded: boolean;
  producedEvidence: boolean;
  producedArtifact: boolean;
  changedWorkspace: boolean;
}

export interface AgentToolSearchMemoryEvidence {
  toolName: string;
  evidence: number;
  confidence: number;
  rankScore: number;
  signals: AgentToolLearningSignal[];
}

export interface AgentToolLearningSignal {
  term: string;
  source: string;
  support: number;
  confidence: number;
  score: number;
  lastSeenAt: number;
}

export interface AgentToolUsePattern {
  toolName: string;
  triggerSummary: string;
  argumentGuidance: string;
  evidenceGoal: string;
  confidence: number;
  supportCount: number;
  successCount: number;
  failureCount: number;
  lastSeenAt: number;
}

interface AgentToolUsePatternMatch extends AgentToolUsePattern {
  score: number;
}

interface StoredEpisodeRow {
  query: string;
  query_tokens: string;
  planner_tags: string;
  candidates: string;
  chosen_tools: string;
  learned_keywords: string;
  outcome: AgentToolSearchEpisode["outcome"];
  calls: string;
  final_score: number;
  final_outcome: string;
  project_id: string;
  timestamp: number;
}

interface StoredTermAggregateRow {
  project_id: string;
  tool_name: string;
  term: string;
  source: string;
  support: number;
  weight: number;
  last_seen_at: number;
}

interface StoredPatternAggregateRow {
  project_id: string;
  tool_name: string;
  pattern_key: string;
  trigger_terms: string;
  argument_keys: string;
  evidence_kinds: string;
  support: number;
  last_seen_at: number;
}

interface AgentToolLearningTermAggregate {
  projectId: string;
  toolName: string;
  term: string;
  source: string;
  support: number;
  weight: number;
  lastSeenAt: number;
}

interface AgentToolUsePatternAggregate {
  projectId: string;
  toolName: string;
  patternKey: string;
  triggerTerms: AgentToolSearchLearnedKeyword[];
  argumentKeys: string[];
  evidenceKinds: string[];
  support: number;
  lastSeenAt: number;
}

interface AgentToolLearningProjection {
  terms: AgentToolLearningTermAggregate[];
  patterns: AgentToolUsePatternAggregate[];
}

interface MemoryStore {
  add(episode: AgentToolSearchEpisode, projection: AgentToolLearningProjection): void;
  list(projectId: string, limit: number): AgentToolSearchEpisode[];
  terms(projectId: string): AgentToolLearningTermAggregate[];
  patterns(projectId: string): AgentToolUsePatternAggregate[];
  prune(maxEpisodes: number): void;
  close(): void;
}

const SuccessEvidence = 1;
const BetaPrior = 1;

const StringArrayColumnSchema = z.array(z.string());
const LearnedKeywordColumnSchema = z.array(z.object({
  toolName: z.string().min(1),
  value: z.string().min(1),
  source: z.string().min(1),
  weight: z.number(),
}).strict());
const ToolCallColumnSchema = z.array(z.object({
  toolName: z.string().min(1),
  argumentKeys: z.array(z.string()),
  evidenceKinds: z.array(z.string()).default([]),
  status: z.enum(["success", "failure", "empty"]),
  evidenceUris: z.array(z.string()),
  artifactUris: z.array(z.string()),
  hasArtifact: z.boolean(),
  hasEvidence: z.boolean(),
  hasWorkspaceChanges: z.boolean(),
  errorCode: z.string().default(""),
  error: z.string(),
  score: z.number(),
}).strict());
const FinalOutcomeColumnSchema = z.object({
  toolExecutionSucceeded: z.boolean(),
  producedEvidence: z.boolean(),
  producedArtifact: z.boolean(),
  changedWorkspace: z.boolean(),
}).strict();

export class AgentToolSearchMemory {
  private readonly store: MemoryStore;
  private readonly tokenizer = new AgentToolSearchTokenizer();

  constructor(
    private readonly config: ResolvedAgentToolSearchConfig,
    workspaceRoot: string,
  ) {
    this.store = config.Memory.Kind === "sqlite"
      ? new SqliteToolSearchMemoryStore(resolveMemoryDatabasePath(workspaceRoot, config.Memory.DatabasePath))
      : new InMemoryToolSearchMemoryStore();
  }

  record(episode: AgentToolSearchEpisode): void {
    this.store.add(episode, projectLearningProjection(episode, this.tokenizer));
    this.store.prune(this.config.Memory.MaxEpisodes);
  }

  rank(queryTokens: readonly string[], projectId: string, now = Date.now()): AgentToolSearchMemoryEvidence[] {
    const querySet = new Set(queryTokens);
    if (querySet.size === 0) {
      return [];
    }

    const evidence = new Map<string, {
      alpha: number;
      mass: number;
      signals: AgentToolLearningSignal[];
    }>();
    for (const term of this.store.terms(projectId)) {
      const similarity = weightedSimilarity(
        querySet,
        singleTermWeights(term.term, term.weight, this.tokenizer),
      );
      if (similarity <= 0) {
        continue;
      }

      const decay = this.timeDecay(now - term.lastSeenAt, this.config.Memory.HalfLifeDays);
      const mass = term.support * similarity * decay;
      if (mass <= 0) {
        continue;
      }

      const current = evidence.get(term.toolName) ?? {
        alpha: BetaPrior,
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
      const similarity = weightedSimilarity(
        querySet,
        learnedKeywordWeights(pattern.triggerTerms, this.tokenizer),
      );
      if (similarity <= 0) {
        continue;
      }
      matches.push(patternFromAggregate(pattern, similarity, this.tokenizer));
    }

    return matches
      .filter((pattern) => pattern.successCount >= options.minSupport)
      .sort((left, right) =>
        right.score - left.score || left.toolName.localeCompare(right.toolName))
      .slice(0, options.limit)
      .map(({ score: _score, ...pattern }) => pattern);
  }

  close(): void {
    this.store.close();
  }

  private timeDecay(ageMs: number, halfLifeDays: number): number {
    const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
    return halfLifeMs <= 0 ? 1 : 2 ** -(Math.max(0, ageMs) / halfLifeMs);
  }
}

class SqliteToolSearchMemoryStore implements MemoryStore {
  private readonly db: Database.Database;
  private readonly insertStmt: Database.Statement;
  private readonly insertTermStmt: Database.Statement;
  private readonly selectPatternStmt: Database.Statement<[string, string, string], StoredPatternAggregateRow>;
  private readonly insertPatternStmt: Database.Statement;
  private readonly updatePatternStmt: Database.Statement;
  private readonly listStmt: Database.Statement<[string, number], StoredEpisodeRow>;
  private readonly termsStmt: Database.Statement<[string], StoredTermAggregateRow>;
  private readonly patternsStmt: Database.Statement<[string], StoredPatternAggregateRow>;
  private readonly pruneStmt: Database.Statement<[number]>;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_search_episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        query_tokens TEXT NOT NULL,
        planner_tags TEXT NOT NULL,
        candidates TEXT NOT NULL,
        chosen_tools TEXT NOT NULL,
        learned_keywords TEXT NOT NULL,
        outcome TEXT NOT NULL,
        calls TEXT NOT NULL,
        final_score REAL NOT NULL,
        final_outcome TEXT NOT NULL,
        project_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tool_search_episodes_project_time
        ON tool_search_episodes(project_id, timestamp DESC);
      CREATE TABLE IF NOT EXISTS tool_learning_terms (
        project_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        term TEXT NOT NULL,
        source TEXT NOT NULL,
        support REAL NOT NULL,
        weight REAL NOT NULL,
        last_seen_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, tool_name, term, source)
      );
      CREATE INDEX IF NOT EXISTS idx_tool_learning_terms_project_tool
        ON tool_learning_terms(project_id, tool_name);
      CREATE TABLE IF NOT EXISTS tool_use_patterns (
        project_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        pattern_key TEXT NOT NULL,
        trigger_terms TEXT NOT NULL,
        argument_keys TEXT NOT NULL,
        evidence_kinds TEXT NOT NULL,
        support REAL NOT NULL,
        last_seen_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, tool_name, pattern_key)
      );
      CREATE INDEX IF NOT EXISTS idx_tool_use_patterns_project_tool
        ON tool_use_patterns(project_id, tool_name);
    `);
    this.insertStmt = this.db.prepare(`
      INSERT INTO tool_search_episodes
        (
          query,
          query_tokens,
          planner_tags,
          candidates,
          chosen_tools,
          learned_keywords,
          outcome,
          calls,
          final_score,
          final_outcome,
          project_id,
          timestamp
        )
      VALUES
        (
          @query,
          @query_tokens,
          @planner_tags,
          @candidates,
          @chosen_tools,
          @learned_keywords,
          @outcome,
          @calls,
          @final_score,
          @final_outcome,
          @project_id,
          @timestamp
        )
    `);
    this.insertTermStmt = this.db.prepare(`
      INSERT INTO tool_learning_terms
        (
          project_id,
          tool_name,
          term,
          source,
          support,
          weight,
          last_seen_at
        )
      VALUES
        (
          @project_id,
          @tool_name,
          @term,
          @source,
          @support,
          @weight,
          @last_seen_at
        )
      ON CONFLICT(project_id, tool_name, term, source)
      DO UPDATE SET
        support = support + excluded.support,
        weight = MAX(weight, excluded.weight),
        last_seen_at = MAX(last_seen_at, excluded.last_seen_at)
    `);
    this.selectPatternStmt = this.db.prepare<[string, string, string], StoredPatternAggregateRow>(`
      SELECT
        project_id,
        tool_name,
        pattern_key,
        trigger_terms,
        argument_keys,
        evidence_kinds,
        support,
        last_seen_at
      FROM tool_use_patterns
      WHERE project_id = ? AND tool_name = ? AND pattern_key = ?
    `);
    this.insertPatternStmt = this.db.prepare(`
      INSERT INTO tool_use_patterns
        (
          project_id,
          tool_name,
          pattern_key,
          trigger_terms,
          argument_keys,
          evidence_kinds,
          support,
          last_seen_at
        )
      VALUES
        (
          @project_id,
          @tool_name,
          @pattern_key,
          @trigger_terms,
          @argument_keys,
          @evidence_kinds,
          @support,
          @last_seen_at
        )
    `);
    this.updatePatternStmt = this.db.prepare(`
      UPDATE tool_use_patterns
      SET
        trigger_terms = @trigger_terms,
        argument_keys = @argument_keys,
        evidence_kinds = @evidence_kinds,
        support = @support,
        last_seen_at = @last_seen_at
      WHERE project_id = @project_id
        AND tool_name = @tool_name
        AND pattern_key = @pattern_key
    `);
    this.listStmt = this.db.prepare<[string, number], StoredEpisodeRow>(`
      SELECT
        query,
        query_tokens,
        planner_tags,
        candidates,
        chosen_tools,
        learned_keywords,
        outcome,
        calls,
        final_score,
        final_outcome,
        project_id,
        timestamp
      FROM tool_search_episodes
      WHERE project_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    this.termsStmt = this.db.prepare<[string], StoredTermAggregateRow>(`
      SELECT
        project_id,
        tool_name,
        term,
        source,
        support,
        weight,
        last_seen_at
      FROM tool_learning_terms
      WHERE project_id = ?
    `);
    this.patternsStmt = this.db.prepare<[string], StoredPatternAggregateRow>(`
      SELECT
        project_id,
        tool_name,
        pattern_key,
        trigger_terms,
        argument_keys,
        evidence_kinds,
        support,
        last_seen_at
      FROM tool_use_patterns
      WHERE project_id = ?
    `);
    this.pruneStmt = this.db.prepare<[number]>(`
      DELETE FROM tool_search_episodes
      WHERE id NOT IN (
        SELECT id FROM tool_search_episodes ORDER BY timestamp DESC LIMIT ?
      )
    `);
  }

  add(episode: AgentToolSearchEpisode, projection: AgentToolLearningProjection): void {
    this.insertStmt.run({
      query: episode.query,
      query_tokens: stringifyJsonColumn(StringArrayColumnSchema, episode.queryTokens),
      planner_tags: stringifyJsonColumn(StringArrayColumnSchema, episode.plannerTags),
      candidates: stringifyJsonColumn(StringArrayColumnSchema, episode.candidates),
      chosen_tools: stringifyJsonColumn(StringArrayColumnSchema, episode.chosenTools),
      learned_keywords: stringifyJsonColumn(LearnedKeywordColumnSchema, episode.learnedKeywords),
      outcome: episode.outcome,
      calls: stringifyJsonColumn(ToolCallColumnSchema, episode.calls),
      final_score: episode.finalScore,
      final_outcome: stringifyJsonColumn(FinalOutcomeColumnSchema, episode.finalOutcome),
      project_id: episode.projectId,
      timestamp: episode.timestamp,
    });
    for (const term of projection.terms) {
      this.insertTermStmt.run({
        project_id: term.projectId,
        tool_name: term.toolName,
        term: term.term,
        source: term.source,
        support: term.support,
        weight: term.weight,
        last_seen_at: term.lastSeenAt,
      });
    }
    for (const pattern of projection.patterns) {
      this.upsertPattern(pattern);
    }
  }

  list(projectId: string, limit: number): AgentToolSearchEpisode[] {
    return this.listStmt.all(projectId, limit).map(rowToEpisode);
  }

  terms(projectId: string): AgentToolLearningTermAggregate[] {
    return this.termsStmt.all(projectId).map(rowToTermAggregate);
  }

  patterns(projectId: string): AgentToolUsePatternAggregate[] {
    return this.patternsStmt.all(projectId).map(rowToPatternAggregate);
  }

  prune(maxEpisodes: number): void {
    this.pruneStmt.run(maxEpisodes);
  }

  close(): void {
    this.db.close();
  }

  private upsertPattern(pattern: AgentToolUsePatternAggregate): void {
    const current = this.selectPatternStmt.get(
      pattern.projectId,
      pattern.toolName,
      pattern.patternKey,
    );
    const merged = current
      ? mergePatternAggregate(rowToPatternAggregate(current), pattern)
      : pattern;
    const record = patternAggregateRecord(merged);

    if (current) {
      this.updatePatternStmt.run(record);
      return;
    }

    this.insertPatternStmt.run(record);
  }
}

class InMemoryToolSearchMemoryStore implements MemoryStore {
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

function rowToEpisode(row: StoredEpisodeRow): AgentToolSearchEpisode {
  return {
    query: row.query,
    queryTokens: parseJsonColumn(StringArrayColumnSchema, row.query_tokens),
    plannerTags: parseJsonColumn(StringArrayColumnSchema, row.planner_tags),
    candidates: parseJsonColumn(StringArrayColumnSchema, row.candidates),
    chosenTools: parseJsonColumn(StringArrayColumnSchema, row.chosen_tools),
    learnedKeywords: parseJsonColumn(LearnedKeywordColumnSchema, row.learned_keywords),
    outcome: row.outcome,
    calls: parseJsonColumn(ToolCallColumnSchema, row.calls),
    finalScore: row.final_score,
    finalOutcome: parseJsonColumn(FinalOutcomeColumnSchema, row.final_outcome),
    projectId: row.project_id,
    timestamp: row.timestamp,
  };
}

function rowToTermAggregate(row: StoredTermAggregateRow): AgentToolLearningTermAggregate {
  return {
    projectId: row.project_id,
    toolName: row.tool_name,
    term: row.term,
    source: row.source,
    support: row.support,
    weight: row.weight,
    lastSeenAt: row.last_seen_at,
  };
}

function rowToPatternAggregate(row: StoredPatternAggregateRow): AgentToolUsePatternAggregate {
  return {
    projectId: row.project_id,
    toolName: row.tool_name,
    patternKey: row.pattern_key,
    triggerTerms: parseJsonColumn(LearnedKeywordColumnSchema, row.trigger_terms),
    argumentKeys: parseJsonColumn(StringArrayColumnSchema, row.argument_keys),
    evidenceKinds: parseJsonColumn(StringArrayColumnSchema, row.evidence_kinds),
    support: row.support,
    lastSeenAt: row.last_seen_at,
  };
}

function patternAggregateRecord(pattern: AgentToolUsePatternAggregate): Record<string, unknown> {
  return {
    project_id: pattern.projectId,
    tool_name: pattern.toolName,
    pattern_key: pattern.patternKey,
    trigger_terms: stringifyJsonColumn(LearnedKeywordColumnSchema, pattern.triggerTerms),
    argument_keys: stringifyJsonColumn(StringArrayColumnSchema, pattern.argumentKeys),
    evidence_kinds: stringifyJsonColumn(StringArrayColumnSchema, pattern.evidenceKinds),
    support: pattern.support,
    last_seen_at: pattern.lastSeenAt,
  };
}

function stringifyJsonColumn<T>(schema: z.ZodType<T>, value: T): string {
  return JSON.stringify(schema.parse(value));
}

function parseJsonColumn<T>(schema: z.ZodType<T>, value: string): T {
  return schema.parse(JSON.parse(value) as unknown);
}

function resolveMemoryDatabasePath(workspaceRoot: string, databasePath: string): string {
  return path.isAbsolute(databasePath)
    ? path.normalize(databasePath)
    : path.resolve(workspaceRoot, databasePath);
}

function learnedKeywordWeights(
  keywords: readonly AgentToolSearchLearnedKeyword[],
  tokenizer: AgentToolSearchTokenizer,
): Map<string, number> {
  const weights = new Map<string, number>();
  for (const keyword of keywords) {
    addWeightedTerm(weights, keyword.value, keyword.weight, tokenizer);
  }
  return weights;
}

function singleTermWeights(
  term: string,
  weight: number,
  tokenizer: AgentToolSearchTokenizer,
): Map<string, number> {
  const weights = new Map<string, number>();
  addWeightedTerm(weights, term, weight, tokenizer);
  return weights;
}

function addWeightedTerm(
  weights: Map<string, number>,
  value: string,
  weight: number,
  tokenizer: AgentToolSearchTokenizer,
): void {
  const normalizedWeight = Number.isFinite(weight) && weight > 0 ? weight : 0;
  if (normalizedWeight <= 0) {
    return;
  }

  const tokens = tokenizer.tokenize(value);
  if (tokens.length === 0) {
    return;
  }

  const tokenWeight = normalizedWeight / tokens.length;
  for (const token of tokens) {
    weights.set(token, Math.max(weights.get(token) ?? 0, tokenWeight));
  }
}

function weightedSimilarity(queryTokens: Set<string>, episodeWeights: Map<string, number>): number {
  if (queryTokens.size === 0 || episodeWeights.size === 0) {
    return 0;
  }

  let matchedWeight = 0;
  for (const [token, weight] of episodeWeights) {
    if (queryTokens.has(token)) {
      matchedWeight += weight;
    }
  }

  return 1 - Math.exp(-matchedWeight);
}

function projectLearningProjection(
  episode: AgentToolSearchEpisode,
  tokenizer: AgentToolSearchTokenizer,
): AgentToolLearningProjection {
  return {
    terms: projectTermAggregates(episode),
    patterns: projectPatternAggregates(episode, tokenizer),
  };
}

function projectTermAggregates(episode: AgentToolSearchEpisode): AgentToolLearningTermAggregate[] {
  if (!isSuccessfulEpisode(episode)) {
    return [];
  }

  const aggregates = new Map<string, AgentToolLearningTermAggregate>();
  for (const keyword of episode.learnedKeywords) {
    if (!episode.chosenTools.includes(keyword.toolName)) {
      continue;
    }
    const next = {
      projectId: episode.projectId,
      toolName: keyword.toolName,
      term: keyword.value,
      source: keyword.source,
      support: keyword.weight * SuccessEvidence,
      weight: keyword.weight,
      lastSeenAt: episode.timestamp,
    };
    const key = termAggregateKey(next);
    aggregates.set(key, mergeTermAggregate(aggregates.get(key), next));
  }
  return [...aggregates.values()];
}

function projectPatternAggregates(
  episode: AgentToolSearchEpisode,
  tokenizer: AgentToolSearchTokenizer,
): AgentToolUsePatternAggregate[] {
  return episode.calls.flatMap((call) => {
    if (!isSuccessfulCall(call)) {
      return [];
    }
    const triggerTerms = episode.learnedKeywords
      .filter((keyword) => keyword.toolName === call.toolName)
      .filter((keyword) => learnedKeywordWeights([keyword], tokenizer).size > 0);
    if (triggerTerms.length === 0) {
      return [];
    }
    return [{
      projectId: episode.projectId,
      toolName: call.toolName,
      patternKey: patternKey(call),
      triggerTerms,
      argumentKeys: uniqueSorted(call.argumentKeys),
      evidenceKinds: uniqueSorted(call.evidenceKinds),
      support: SuccessEvidence,
      lastSeenAt: episode.timestamp,
    }];
  });
}

function patternFromAggregate(
  pattern: AgentToolUsePatternAggregate,
  similarity: number,
  tokenizer: AgentToolSearchTokenizer,
): AgentToolUsePatternMatch {
  const confidence = confidenceFromSupport(pattern.support);
  const supportCount = pattern.support;
  const score = similarity * confidence * Math.log1p(supportCount);
  const terms = topWeightedKeys(learnedKeywordWeights(pattern.triggerTerms, tokenizer));

  return {
    toolName: pattern.toolName,
    triggerSummary: terms.length > 0
      ? `相关触发词：${terms.join("、")}`
      : "历史成功样本显示当前请求与该工具相关。",
    argumentGuidance: pattern.argumentKeys.length > 0
      ? `按当前用户目标填写这些历史有效参数：${pattern.argumentKeys.join("、")}。`
      : "按工具签名和当前用户目标构造参数。",
    evidenceGoal: pattern.evidenceKinds.length > 0
      ? `历史成功结果通常产生：${pattern.evidenceKinds.join("、")}。`
      : "以工具结果能支持当前回答为准。",
    confidence,
    supportCount,
    successCount: pattern.support,
    failureCount: 0,
    lastSeenAt: pattern.lastSeenAt,
    score,
  };
}

function isSuccessfulEpisode(episode: AgentToolSearchEpisode): boolean {
  return episode.outcome === "success"
    && episode.finalScore > 0
    && episode.finalOutcome.toolExecutionSucceeded
    && (
      episode.finalOutcome.producedEvidence
      || episode.finalOutcome.producedArtifact
      || episode.finalOutcome.changedWorkspace
    );
}

function isSuccessfulCall(call: AgentToolSearchEpisodeCall): boolean {
  return call.status === "success"
    && call.score > 0
    && (
      call.hasEvidence
      || call.hasArtifact
      || call.hasWorkspaceChanges
    );
}

function topWeightedKeys(values: Map<string, number>): string[] {
  return [...values.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([key]) => key);
}

function confidenceFromSupport(support: number): number {
  return (support + BetaPrior) / (support + BetaPrior * 2);
}

function mergeTermAggregate(
  current: AgentToolLearningTermAggregate | undefined,
  next: AgentToolLearningTermAggregate,
): AgentToolLearningTermAggregate {
  if (!current) {
    return next;
  }
  return {
    ...current,
    support: current.support + next.support,
    weight: Math.max(current.weight, next.weight),
    lastSeenAt: Math.max(current.lastSeenAt, next.lastSeenAt),
  };
}

function mergePatternAggregate(
  current: AgentToolUsePatternAggregate | undefined,
  next: AgentToolUsePatternAggregate,
): AgentToolUsePatternAggregate {
  if (!current) {
    return next;
  }
  return {
    ...current,
    triggerTerms: mergeLearnedKeywords(current.triggerTerms, next.triggerTerms),
    argumentKeys: uniqueSorted([...current.argumentKeys, ...next.argumentKeys]),
    evidenceKinds: uniqueSorted([...current.evidenceKinds, ...next.evidenceKinds]),
    support: current.support + next.support,
    lastSeenAt: Math.max(current.lastSeenAt, next.lastSeenAt),
  };
}

function mergeLearnedKeywords(
  current: readonly AgentToolSearchLearnedKeyword[],
  next: readonly AgentToolSearchLearnedKeyword[],
): AgentToolSearchLearnedKeyword[] {
  const byKey = new Map<string, AgentToolSearchLearnedKeyword>();
  for (const keyword of [...current, ...next]) {
    const key = [keyword.toolName, keyword.source, keyword.value].join("\u0000");
    const previous = byKey.get(key);
    byKey.set(key, previous && previous.weight >= keyword.weight ? previous : keyword);
  }
  return [...byKey.values()].sort((left, right) =>
    left.toolName.localeCompare(right.toolName)
    || left.source.localeCompare(right.source)
    || left.value.localeCompare(right.value));
}

function termAggregateKey(term: AgentToolLearningTermAggregate): string {
  return [
    term.projectId,
    term.toolName,
    term.source,
    term.term,
  ].join("\u0000");
}

function patternAggregateKey(pattern: AgentToolUsePatternAggregate): string {
  return [
    pattern.projectId,
    pattern.toolName,
    pattern.patternKey,
  ].join("\u0000");
}

function patternKey(call: AgentToolSearchEpisodeCall): string {
  return crypto
    .createHash("sha1")
    .update(JSON.stringify({
      arguments: call.argumentKeys,
      evidence: call.evidenceKinds,
    }))
    .digest("hex");
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}
