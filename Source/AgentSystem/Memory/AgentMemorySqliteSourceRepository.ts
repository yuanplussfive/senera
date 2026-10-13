import type Database from "better-sqlite3";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import { AgentMemorySqliteExtensions } from "../Database/AgentSqliteVecExtension.js";
import { uniqueTrimmed } from "./AgentMemoryCollections.js";
import { buildEpisode } from "./AgentMemoryEpisodeRecords.js";
import { buildSources } from "./AgentMemorySourceRecords.js";
import { rowToEpisode, rowToSource, episodeToRow, sourceToRow } from "./AgentMemoryRowMapper.js";
import type { SourceRow } from "./AgentMemorySqlRows.js";
import { AgentMemoryDatabaseContract } from "./AgentMemorySqlSchema.js";
import { prepareAgentMemorySqlStatements, type AgentMemorySqlStatements } from "./AgentMemorySqlStatements.js";
import type {
  AgentMemoryCompletedTurnInput,
  AgentMemoryDeletionImpact,
  AgentMemoryEpisodeRecord,
  AgentMemoryRecordedTurn,
  AgentMemorySourceRecord,
  AgentMemorySourceRepository,
} from "./AgentMemorySourceRepository.js";
import type { AgentUpgradeSession } from "../Upgrade/AgentUpgradeSession.js";

export class SqliteAgentMemorySourceRepository implements AgentMemorySourceRepository {
  private readonly kernel: AgentSqliteDatabaseKernel;
  private readonly ownsKernel: boolean;
  private readonly db: Database.Database;
  private readonly statements: AgentMemorySqlStatements;
  private readonly catalogRevisionStatement: Database.Statement<[], { revision: number }>;

  constructor(database: string | AgentSqliteDatabaseKernel, upgradeSession?: AgentUpgradeSession) {
    this.ownsKernel = typeof database === "string";
    this.kernel =
      typeof database === "string"
        ? new AgentSqliteDatabaseKernel({
            databasePath: database,
            contract: AgentMemoryDatabaseContract,
            upgradeSession,
            extensions: AgentMemorySqliteExtensions,
          })
        : database;
    this.db = this.kernel.connection;
    this.statements = prepareAgentMemorySqlStatements(this.db);
    this.catalogRevisionStatement = this.db.prepare<[], { revision: number }>(
      "SELECT revision FROM memory_catalog_state WHERE catalog = 'physical_history'",
    );
  }

  catalogRevision(): string {
    const row = this.catalogRevisionStatement.get();
    if (!row) throw new Error("Physical history catalog revision is unavailable.");
    return String(row.revision);
  }

  recordCompletedTurn(input: AgentMemoryCompletedTurnInput): AgentMemoryRecordedTurn {
    const episode = buildEpisode(input);
    const sources = buildSources(input, episode);
    const persist = this.db.transaction(() => {
      this.statements.upsertEpisodeStmt.run(episodeToRow(episode));
      this.statements.deleteSourcesByEpisodeStmt.run(episode.id);
      for (const source of sources) this.statements.insertSourceStmt.run(sourceToRow(source));
    });
    persist();
    return { episode, sources };
  }

  deleteSession(sessionId: string): AgentMemoryDeletionImpact {
    const episodes = this.listEpisodes(sessionId);
    const impact = this.deletionImpact(sessionId, episodes, "session");
    this.statements.deleteSessionStmt.run(sessionId);
    return impact;
  }

  deleteFromSessionRequest(sessionId: string, requestId: string): AgentMemoryDeletionImpact {
    const target = this.statements.selectEpisodeForRequestStmt.get(sessionId, requestId);
    if (target) {
      const episodes = this.listEpisodes(sessionId).filter((episode) => episode.startedAtMs >= target.started_at_ms);
      const impact = this.deletionImpact(sessionId, episodes, "from_request", requestId);
      this.statements.deleteEpisodesFromTimeStmt.run(sessionId, target.started_at_ms);
      return impact;
    }
    const impact = emptyDeletionImpact(sessionId, requestId);
    this.statements.deleteExactEpisodeStmt.run(sessionId, requestId);
    return impact;
  }

  listEpisodes(sessionId: string): AgentMemoryEpisodeRecord[] {
    return this.statements.listEpisodesStmt.all(sessionId).map(rowToEpisode);
  }

  listCompletedEpisodes(): AgentMemoryEpisodeRecord[] {
    return this.statements.listCompletedEpisodesStmt.all().map(rowToEpisode);
  }

  findEpisodesByUris(uris: readonly string[]): AgentMemoryEpisodeRecord[] {
    return uniqueTrimmed(uris).flatMap((uri) => {
      const row = this.statements.selectEpisodeByUriStmt.get(uri);
      return row ? [rowToEpisode(row)] : [];
    });
  }

  listSources(episodeUri: string): AgentMemorySourceRecord[] {
    return this.statements.listSourcesStmt.all(episodeUri).map(rowToSource);
  }

  private listSourcesForEpisodes(episodeUris: readonly string[]): AgentMemorySourceRecord[] {
    const normalized = uniqueTrimmed(episodeUris);
    if (normalized.length === 0) return [];
    const placeholders = normalized.map(() => "?").join(", ");
    return this.db
      .prepare<unknown[], SourceRow>(
        `SELECT * FROM memory_sources
         WHERE episode_uri IN (${placeholders})
         ORDER BY created_at_ms ASC, source_kind ASC, id ASC`,
      )
      .all(...normalized)
      .map(rowToSource);
  }

  close(): void {
    if (this.ownsKernel) this.kernel.close();
  }

  private deletionImpact(
    sessionId: string,
    episodes: readonly AgentMemoryEpisodeRecord[],
    scope: "session" | "from_request",
    requestId?: string,
  ): AgentMemoryDeletionImpact {
    const episodeUris = episodes.map((episode) => episode.uri);
    return {
      sessionId,
      scope,
      ...(requestId ? { requestId } : {}),
      ...(scope === "from_request" ? { requestIds: [...new Set(episodes.map((episode) => episode.requestId))] } : {}),
      episodeUris,
      sourceUris: this.listSourcesForEpisodes(episodeUris).map((source) => source.uri),
    };
  }
}

function emptyDeletionImpact(sessionId: string, requestId: string): AgentMemoryDeletionImpact {
  return { sessionId, scope: "from_request", requestId, requestIds: [requestId], episodeUris: [], sourceUris: [] };
}
