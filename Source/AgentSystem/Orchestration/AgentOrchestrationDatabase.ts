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
}
