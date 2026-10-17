import type Database from "better-sqlite3";
import { agentSql } from "../Database/AgentSql.js";

export interface AgentMcpCredentialRow {
  readonly server_id: string;
  readonly name: string;
  readonly value_envelope: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AgentMcpCredentialMetadataRow {
  readonly server_id: string;
  readonly name: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AgentMcpInputValueRow {
  readonly server_id: string;
  readonly input_id: string;
  readonly value_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AgentMcpInputValueMetadataRow {
  readonly server_id: string;
  readonly input_id: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AgentMcpCredentialSqlStatements {
  readonly selectCredential: Database.Statement<[string, string], AgentMcpCredentialRow>;
  readonly listCredentials: Database.Statement<[], AgentMcpCredentialMetadataRow>;
  readonly listServerCredentials: Database.Statement<[string], AgentMcpCredentialMetadataRow>;
  readonly upsertCredential: Database.Statement;
  readonly deleteCredential: Database.Statement<[string, string]>;
  readonly selectRevision: Database.Statement<[], { revision: number }>;
  readonly incrementRevision: Database.Statement;
  readonly selectInputValue: Database.Statement<[string, string], AgentMcpInputValueRow>;
  readonly listInputValues: Database.Statement<[], AgentMcpInputValueMetadataRow>;
  readonly listServerInputValues: Database.Statement<[string], AgentMcpInputValueMetadataRow>;
  readonly upsertInputValue: Database.Statement;
  readonly deleteInputValue: Database.Statement<[string, string]>;
  readonly selectInputRevision: Database.Statement<[], { revision: number }>;
  readonly incrementInputRevision: Database.Statement;
}

export function prepareAgentMcpCredentialSqlStatements(database: Database.Database): AgentMcpCredentialSqlStatements {
  return {
    selectCredential: database.prepare(
      agentSql`SELECT server_id, name, value_envelope, created_at, updated_at
               FROM mcp_credentials
               WHERE server_id = ? AND name = ?`,
    ),
    listCredentials: database.prepare(
      agentSql`SELECT server_id, name, created_at, updated_at
               FROM mcp_credentials
               ORDER BY server_id, name`,
    ),
    listServerCredentials: database.prepare(
      agentSql`SELECT server_id, name, created_at, updated_at
               FROM mcp_credentials
               WHERE server_id = ?
               ORDER BY name`,
    ),
    upsertCredential: database.prepare(
      agentSql`INSERT INTO mcp_credentials (server_id, name, value_envelope, created_at, updated_at)
               VALUES (@server_id, @name, @value_envelope, @created_at, @updated_at)
               ON CONFLICT (server_id, name) DO UPDATE SET
                 value_envelope = excluded.value_envelope,
                 updated_at = excluded.updated_at`,
    ),
    deleteCredential: database.prepare(agentSql`DELETE FROM mcp_credentials WHERE server_id = ? AND name = ?`),
    selectRevision: database.prepare(agentSql`SELECT revision FROM mcp_credential_state WHERE singleton = 1`),
    incrementRevision: database.prepare(
      agentSql`UPDATE mcp_credential_state SET revision = revision + 1 WHERE singleton = 1`,
    ),
    selectInputValue: database.prepare(
      agentSql`SELECT server_id, input_id, value_json, created_at, updated_at
               FROM mcp_input_values
               WHERE server_id = ? AND input_id = ?`,
    ),
    listInputValues: database.prepare(
      agentSql`SELECT server_id, input_id, created_at, updated_at
               FROM mcp_input_values
               ORDER BY server_id, input_id`,
    ),
    listServerInputValues: database.prepare(
      agentSql`SELECT server_id, input_id, created_at, updated_at
               FROM mcp_input_values
               WHERE server_id = ?
               ORDER BY input_id`,
    ),
    upsertInputValue: database.prepare(
      agentSql`INSERT INTO mcp_input_values (server_id, input_id, value_json, created_at, updated_at)
               VALUES (@server_id, @input_id, @value_json, @created_at, @updated_at)
               ON CONFLICT (server_id, input_id) DO UPDATE SET
                 value_json = excluded.value_json,
                 updated_at = excluded.updated_at`,
    ),
    deleteInputValue: database.prepare(agentSql`DELETE FROM mcp_input_values WHERE server_id = ? AND input_id = ?`),
    selectInputRevision: database.prepare(agentSql`SELECT revision FROM mcp_input_state WHERE singleton = 1`),
    incrementInputRevision: database.prepare(
      agentSql`UPDATE mcp_input_state SET revision = revision + 1 WHERE singleton = 1`,
    ),
  };
}
