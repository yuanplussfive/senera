import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

export interface AgentSqliteMigrationContext {
  readonly database: Database.Database;
  execute(sql: string): void;
}

export interface AgentSqliteMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  up(context: AgentSqliteMigrationContext): void;
}

export interface AgentSqliteSqlMigrationDefinition {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export function defineAgentSqliteMigration(definition: AgentSqliteSqlMigrationDefinition): AgentSqliteMigration {
  const checksum = createHash("sha256").update(definition.sql, "utf8").digest("hex");
  return Object.freeze({
    version: definition.version,
    name: definition.name,
    checksum,
    up: ({ execute }: AgentSqliteMigrationContext) => execute(definition.sql),
  });
}
