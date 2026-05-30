import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { ResolvedAgentToolSearchConfig } from "./Types.js";

export interface AgentToolSearchEpisode {
  query: string;
  queryTokens: string[];
  candidates: string[];
  chosenTools: string[];
  outcome: "success" | "failure" | "unknown";
  projectId: string;
  timestamp: number;
}

export interface AgentToolSearchMemoryEvidence {
  toolName: string;
  evidence: number;
  confidence: number;
  rankScore: number;
}

interface StoredEpisodeRow {
  query: string;
  query_tokens: string;
  candidates: string;
  chosen_tools: string;
  outcome: string;
  project_id: string;
  timestamp: number;
}

interface MemoryStore {
  add(episode: AgentToolSearchEpisode): void;
  list(projectId: string, limit: number): AgentToolSearchEpisode[];
  prune(maxEpisodes: number): void;
  close(): void;
}

const SuccessEvidence = 1;
const FailureEvidence = 0.35;
const BetaPrior = 1;

export class AgentToolSearchMemory {
  private readonly store: MemoryStore;

  constructor(
    private readonly config: ResolvedAgentToolSearchConfig,
    workspaceRoot: string,
  ) {
    this.store = config.Memory.Kind === "sqlite"
      ? new SqliteToolSearchMemoryStore(resolveMemoryDatabasePath(workspaceRoot, config.Memory.DatabasePath))
      : new InMemoryToolSearchMemoryStore();
  }

  record(episode: AgentToolSearchEpisode): void {
    this.store.add(episode);
    this.store.prune(this.config.Memory.MaxEpisodes);
  }

  rank(queryTokens: readonly string[], projectId: string, now = Date.now()): AgentToolSearchMemoryEvidence[] {
    const querySet = new Set(queryTokens);
    if (querySet.size === 0) {
      return [];
    }

    const evidence = new Map<string, { alpha: number; beta: number; mass: number }>();
    for (const episode of this.store.list(projectId, this.config.Memory.MaxEpisodes)) {
      const similarity = jaccard(querySet, new Set(episode.queryTokens));
      if (similarity <= 0) {
        continue;
      }

      const decay = this.timeDecay(now - episode.timestamp, this.config.Memory.HalfLifeDays);
      const mass = similarity * decay;
      if (mass <= 0) {
        continue;
      }

      const updates = this.episodeUpdates(episode, mass);
      for (const update of updates) {
        const current = evidence.get(update.toolName) ?? {
          alpha: BetaPrior,
          beta: BetaPrior,
          mass: 0,
        };
        current.alpha += update.alpha;
        current.beta += update.beta;
        current.mass += mass;
        evidence.set(update.toolName, current);
      }
    }

    return [...evidence.entries()]
      .map(([toolName, value]) => {
        const confidence = value.alpha / (value.alpha + value.beta);
        return {
          toolName,
          evidence: value.mass,
          confidence,
          rankScore: confidence * Math.log1p(value.mass),
        };
      })
      .sort((left, right) => right.rankScore - left.rankScore);
  }

  close(): void {
    this.store.close();
  }

  private episodeUpdates(
    episode: AgentToolSearchEpisode,
    mass: number,
  ): Array<{ toolName: string; alpha: number; beta: number }> {
    const chosen = [...new Set(episode.chosenTools)];
    const outcomes = {
      success: () => chosen.map((toolName) => ({
        toolName,
        alpha: SuccessEvidence * mass,
        beta: 0,
      })),
      failure: () => chosen.map((toolName) => ({
        toolName,
        alpha: 0,
        beta: FailureEvidence * mass,
      })),
      unknown: () => [],
    } satisfies Record<AgentToolSearchEpisode["outcome"], () => Array<{
      toolName: string;
      alpha: number;
      beta: number;
    }>>;

    return outcomes[episode.outcome]();
  }

  private timeDecay(ageMs: number, halfLifeDays: number): number {
    const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
    return halfLifeMs <= 0 ? 1 : 2 ** -(Math.max(0, ageMs) / halfLifeMs);
  }
}

class SqliteToolSearchMemoryStore implements MemoryStore {
  private readonly db: Database.Database;
  private readonly insertStmt: Database.Statement;
  private readonly listStmt: Database.Statement<[string, number], StoredEpisodeRow>;
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
        candidates TEXT NOT NULL,
        chosen_tools TEXT NOT NULL,
        outcome TEXT NOT NULL,
        project_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tool_search_episodes_project_time
        ON tool_search_episodes(project_id, timestamp DESC);
    `);
    this.insertStmt = this.db.prepare(`
      INSERT INTO tool_search_episodes
        (query, query_tokens, candidates, chosen_tools, outcome, project_id, timestamp)
      VALUES
        (@query, @query_tokens, @candidates, @chosen_tools, @outcome, @project_id, @timestamp)
    `);
    this.listStmt = this.db.prepare<[string, number], StoredEpisodeRow>(`
      SELECT query, query_tokens, candidates, chosen_tools, outcome, project_id, timestamp
      FROM tool_search_episodes
      WHERE project_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    this.pruneStmt = this.db.prepare<[number]>(`
      DELETE FROM tool_search_episodes
      WHERE id NOT IN (
        SELECT id FROM tool_search_episodes ORDER BY timestamp DESC LIMIT ?
      )
    `);
  }

  add(episode: AgentToolSearchEpisode): void {
    this.insertStmt.run({
      query: episode.query,
      query_tokens: JSON.stringify(episode.queryTokens),
      candidates: JSON.stringify(episode.candidates),
      chosen_tools: JSON.stringify(episode.chosenTools),
      outcome: episode.outcome,
      project_id: episode.projectId,
      timestamp: episode.timestamp,
    });
  }

  list(projectId: string, limit: number): AgentToolSearchEpisode[] {
    return this.listStmt.all(projectId, limit).map(rowToEpisode);
  }

  prune(maxEpisodes: number): void {
    this.pruneStmt.run(maxEpisodes);
  }

  close(): void {
    this.db.close();
  }
}

class InMemoryToolSearchMemoryStore implements MemoryStore {
  private readonly episodes: AgentToolSearchEpisode[] = [];

  add(episode: AgentToolSearchEpisode): void {
    this.episodes.push(episode);
  }

  list(projectId: string, limit: number): AgentToolSearchEpisode[] {
    return this.episodes
      .filter((episode) => episode.projectId === projectId)
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, limit);
  }

  prune(maxEpisodes: number): void {
    this.episodes.splice(0, Math.max(0, this.episodes.length - maxEpisodes));
  }

  close(): void {}
}

function rowToEpisode(row: StoredEpisodeRow): AgentToolSearchEpisode {
  return {
    query: row.query,
    queryTokens: parseStringArray(row.query_tokens),
    candidates: parseStringArray(row.candidates),
    chosenTools: parseStringArray(row.chosen_tools),
    outcome: row.outcome === "success" || row.outcome === "failure" ? row.outcome : "unknown",
    projectId: row.project_id,
    timestamp: row.timestamp,
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function resolveMemoryDatabasePath(workspaceRoot: string, databasePath: string): string {
  return path.isAbsolute(databasePath)
    ? path.normalize(databasePath)
    : path.resolve(workspaceRoot, databasePath);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}
