import type Database from "better-sqlite3";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../Memory/AgentMemorySqlSchema.js";
import type { AgentUpgradeSession } from "../Upgrade/AgentUpgradeSession.js";

/**
 * Session delivery receipts kept beside MemOS. Semantic knowledge and its
 * graph, validity, and embeddings belong to MemOS.
 */
export class AgentContinuitySqliteStore {
  private readonly kernel: AgentSqliteDatabaseKernel;
  private readonly ownsKernel: boolean;
  private readonly db: Database.Database;

  constructor(database: string | AgentSqliteDatabaseKernel, upgradeSession?: AgentUpgradeSession) {
    this.ownsKernel = typeof database === "string";
    this.kernel =
      typeof database === "string"
        ? new AgentSqliteDatabaseKernel({
            databasePath: database,
            contract: AgentMemoryDatabaseContract,
            upgradeSession,
          })
        : database;
    this.db = this.kernel.connection;
  }

  listMemoryDeliveryKeys(sessionId: string, contextEpoch = "active"): readonly string[] {
    return this.db
      .prepare<[string, string], { memory_key: string }>(
        `SELECT memory_key
           FROM continuity_memory_delivery
          WHERE session_id = ? AND context_epoch = ?
          ORDER BY delivered_at ASC, memory_key ASC`,
      )
      .all(sessionId, contextEpoch)
      .map((row) => row.memory_key);
  }

  recordMemoryDelivery(
    sessionId: string,
    memoryKeys: readonly string[],
    deliveredAt: string,
    contextEpoch = "active",
  ): number {
    const keys = [...new Set(memoryKeys.map((key) => key.trim()).filter(Boolean))];
    if (keys.length === 0) return 0;
    const insert = this.db.prepare<[string, string, string, string]>(
      `INSERT INTO continuity_memory_delivery(session_id, context_epoch, memory_key, delivered_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id, context_epoch, memory_key) DO UPDATE SET delivered_at = excluded.delivered_at`,
    );
    const transaction = this.db.transaction(() => {
      for (const key of keys) insert.run(sessionId, contextEpoch, key, deliveredAt);
    });
    transaction();
    return keys.length;
  }

  clearMemoryDelivery(sessionId: string): number {
    return this.db.prepare<[string]>("DELETE FROM continuity_memory_delivery WHERE session_id = ?").run(sessionId)
      .changes;
  }

  deleteSession(sessionId: string): void {
    this.clearMemoryDelivery(sessionId);
  }

  close(): void {
    if (this.ownsKernel) this.kernel.close();
  }
}
