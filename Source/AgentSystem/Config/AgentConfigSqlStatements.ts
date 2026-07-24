import type Database from "better-sqlite3";
import type { AgentConfigRevisionRecord } from "./AgentConfigSqliteRepository.js";

export interface AgentConfigRevisionRow {
  revision: number;
  config_json: string;
  source: AgentConfigRevisionRecord["source"];
  created_at: string;
}

export interface AgentConfigCommandReceiptRow {
  command_id: string;
  operation_kind: string;
  payload_hash: string;
  revision: number;
  created_at: string;
}

export interface AgentConfigSqlStatements {
  readonly selectLatestRevision: Database.Statement<[], AgentConfigRevisionRow>;
  readonly selectNextRevision: Database.Statement<[], { revision: number }>;
  readonly selectRevision: Database.Statement<[number], AgentConfigRevisionRow>;
  readonly selectCommandReceipt: Database.Statement<[string], AgentConfigCommandReceiptRow>;
  readonly insertRevision: Database.Statement;
  readonly insertCommandReceipt: Database.Statement;
}

export function prepareAgentConfigSqlStatements(database: Database.Database): AgentConfigSqlStatements {
  return {
    selectLatestRevision: database.prepare(`
      SELECT revision, config_json, source, created_at
      FROM config_revisions
      ORDER BY revision DESC
      LIMIT 1
    `),
    selectNextRevision: database.prepare(`
      SELECT COALESCE(MAX(revision), 0) + 1 AS revision
      FROM config_revisions
    `),
    selectRevision: database.prepare(`
      SELECT revision, config_json, source, created_at
      FROM config_revisions
      WHERE revision = ?
    `),
    selectCommandReceipt: database.prepare(`
      SELECT command_id, operation_kind, payload_hash, revision, created_at
      FROM config_command_receipts
      WHERE command_id = ?
    `),
    insertRevision: database.prepare(`
      INSERT INTO config_revisions (revision, config_json, source, created_at)
      VALUES (@revision, @config_json, @source, @created_at)
    `),
    insertCommandReceipt: database.prepare(`
      INSERT INTO config_command_receipts (command_id, operation_kind, payload_hash, revision, created_at)
      VALUES (@command_id, @operation_kind, @payload_hash, @revision, @created_at)
    `),
  };
}
