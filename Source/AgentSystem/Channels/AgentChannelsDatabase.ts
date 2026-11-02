import type Database from "better-sqlite3";
import type { AgentUpgradeSession } from "../Upgrade/AgentUpgradeSession.js";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import { AgentChannelsDatabaseContract } from "./AgentChannelsSqlSchema.js";

export class AgentChannelsDatabase {
  private readonly kernel: AgentSqliteDatabaseKernel;
  readonly connection: Database.Database;

  constructor(databasePath: string, upgradeSession?: AgentUpgradeSession) {
    this.kernel = new AgentSqliteDatabaseKernel({
      databasePath,
      contract: AgentChannelsDatabaseContract,
      upgradeSession,
    });
    this.connection = this.kernel.connection;
  }

  close(): void {
    this.kernel.close();
  }
}
