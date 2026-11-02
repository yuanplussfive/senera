import type Database from "better-sqlite3";
import type { AgentUpgradeSession } from "../Upgrade/AgentUpgradeSession.js";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import { AgentOrchestrationDatabaseContract } from "./AgentOrchestrationSqlSchema.js";

export class AgentOrchestrationDatabase {
  private readonly kernel: AgentSqliteDatabaseKernel;
  readonly connection: Database.Database;

  constructor(databasePath: string, upgradeSession?: AgentUpgradeSession) {
    this.kernel = new AgentSqliteDatabaseKernel({
      databasePath,
      contract: AgentOrchestrationDatabaseContract,
      upgradeSession,
    });
    this.connection = this.kernel.connection;
    this.connection.pragma("foreign_keys = ON");
  }

  close(): void {
    this.kernel.close();
  }

  /** Call only after owned tasks have settled; foreign keys remove their messages, nodes and receipts. */
  removeSessions(sessionIds: ReadonlySet<string>): void {
    this.connection.transaction(() => {
      const removeWorkflows = this.connection.prepare("DELETE FROM agent_workflows WHERE parent_session_id=?");
      const removeChildren = this.connection.prepare(
        "DELETE FROM child_runs WHERE parent_session_id=? OR child_session_id=?",
      );
      for (const id of sessionIds) {
        removeWorkflows.run(id);
        removeChildren.run(id, id);
      }
    })();
  }
}
