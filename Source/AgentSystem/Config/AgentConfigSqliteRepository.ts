import type Database from "better-sqlite3";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentConfigDatabaseMigrations } from "./AgentConfigSqlSchema.js";
import {
  prepareAgentConfigSqlStatements,
  type AgentConfigRevisionRow,
  type AgentConfigSqlStatements,
} from "./AgentConfigSqlStatements.js";

export interface AgentConfigRevisionRecord {
  revision: number;
  config: AgentSystemConfig;
  source: "seed" | "json_import" | "ui_update" | "api_update" | "migration";
  createdAt: string;
}

export interface AgentConfigWriteInput {
  config: AgentSystemConfig;
  source: AgentConfigRevisionRecord["source"];
  createdAt?: string;
}

export class AgentConfigSqliteRepository {
  private readonly kernel: AgentSqliteDatabaseKernel;
  private readonly db: Database.Database;
  private readonly statements: AgentConfigSqlStatements;

  constructor(databasePath: string) {
    this.kernel = new AgentSqliteDatabaseKernel({ databasePath, migrations: AgentConfigDatabaseMigrations });
    this.db = this.kernel.connection;
    this.statements = prepareAgentConfigSqlStatements(this.db);
  }

  latestRevision(): AgentConfigRevisionRecord | undefined {
    const row = this.statements.selectLatestRevision.get();
    return row ? rowToRevision(row) : undefined;
  }

  appendRevision(input: AgentConfigWriteInput): AgentConfigRevisionRecord {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const insert = this.db.transaction(() => {
      const nextRevision = this.nextRevision();
      this.statements.insertRevision.run({
        revision: nextRevision,
        config_json: JSON.stringify(input.config),
        source: input.source,
        created_at: createdAt,
      });
      return nextRevision;
    });

    const revision = insert();
    return {
      revision,
      config: input.config,
      source: input.source,
      createdAt,
    };
  }

  close(): void {
    this.kernel.close();
  }

  private nextRevision(): number {
    const row = this.statements.selectNextRevision.get();
    if (!row) throw new Error("Unable to allocate the next configuration revision.");
    return row.revision;
  }
}

function rowToRevision(row: AgentConfigRevisionRow): AgentConfigRevisionRecord {
  return {
    revision: row.revision,
    config: JSON.parse(row.config_json) as AgentSystemConfig,
    source: row.source,
    createdAt: row.created_at,
  };
}
