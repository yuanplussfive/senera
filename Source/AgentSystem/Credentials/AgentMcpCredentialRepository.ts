import type Database from "better-sqlite3";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import { AgentSecretEnvelopeCodec } from "../Security/AgentSecretEnvelopeCodec.js";
import { AgentMcpCredentialDatabaseContract } from "./AgentMcpCredentialSqlSchema.js";
import {
  prepareAgentMcpCredentialSqlStatements,
  type AgentMcpCredentialMetadataRow,
  type AgentMcpCredentialSqlStatements,
  type AgentMcpInputValueMetadataRow,
} from "./AgentMcpCredentialSqlStatements.js";
import { AgentExtensionInputValueSchema, type AgentExtensionInputValue } from "../Extensions/AgentExtensionInput.js";

const CredentialSecretKeyEnvironmentVariable = "SENERA_CREDENTIAL_SECRET_KEY";

export interface AgentMcpStoredCredentialMetadata {
  readonly serverId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentMcpStoredInputMetadata {
  readonly serverId: string;
  readonly inputId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentMcpCredentialRepositoryOptions {
  readonly secretKeyPath: string;
  readonly key?: Buffer;
  readonly environment?: NodeJS.ProcessEnv;
}

export type AgentMcpInputStorageMutation =
  | { readonly kind: "set_secret"; readonly inputId: string; readonly value: string }
  | { readonly kind: "set_value"; readonly inputId: string; readonly value: AgentExtensionInputValue }
  | { readonly kind: "delete_secret"; readonly inputId: string }
  | { readonly kind: "delete_value"; readonly inputId: string };

export class AgentMcpCredentialRepository {
  private readonly kernel: AgentSqliteDatabaseKernel;
  private readonly database: Database.Database;
  private readonly statements: AgentMcpCredentialSqlStatements;
  private readonly secrets: AgentSecretEnvelopeCodec;
  private readonly writeCredential: (serverId: string, name: string, value: string, updatedAt: string) => void;
  private readonly removeCredential: (serverId: string, name: string) => boolean;
  private readonly writeInputValue: (
    serverId: string,
    inputId: string,
    value: AgentExtensionInputValue,
    updatedAt: string,
  ) => void;
  private readonly removeInputValue: (serverId: string, inputId: string) => boolean;
  private readonly applyInputMutations: (
    serverId: string,
    mutations: readonly AgentMcpInputStorageMutation[],
    updatedAt: string,
  ) => void;

  constructor(databasePath: string, options: AgentMcpCredentialRepositoryOptions) {
    this.kernel = new AgentSqliteDatabaseKernel({
      databasePath,
      contract: AgentMcpCredentialDatabaseContract,
    });
    this.database = this.kernel.connection;
    this.database.pragma("secure_delete = ON");
    this.statements = prepareAgentMcpCredentialSqlStatements(this.database);
    this.secrets = new AgentSecretEnvelopeCodec({
      keyPath: options.secretKeyPath,
      keyEnvironmentVariable: CredentialSecretKeyEnvironmentVariable,
      key: options.key,
      environment: options.environment,
      keyLabel: "Credential secret key",
    });
    this.writeCredential = this.database.transaction((serverId, name, value, updatedAt) => {
      const current = this.statements.selectCredential.get(serverId, name);
      this.statements.upsertCredential.run({
        server_id: serverId,
        name,
        value_envelope: this.secrets.seal(value, credentialContext(serverId, name)),
        created_at: current?.created_at ?? updatedAt,
        updated_at: updatedAt,
      });
      this.statements.incrementRevision.run();
    });
    this.removeCredential = this.database.transaction((serverId, name) => {
      const removed = this.statements.deleteCredential.run(serverId, name).changes > 0;
      if (removed) this.statements.incrementRevision.run();
      return removed;
    });
    this.writeInputValue = this.database.transaction((serverId, inputId, value, updatedAt) => {
      const current = this.statements.selectInputValue.get(serverId, inputId);
      this.statements.upsertInputValue.run({
        server_id: serverId,
        input_id: inputId,
        value_json: JSON.stringify(value),
        created_at: current?.created_at ?? updatedAt,
        updated_at: updatedAt,
      });
      this.statements.incrementInputRevision.run();
    });
    this.removeInputValue = this.database.transaction((serverId, inputId) => {
      const removed = this.statements.deleteInputValue.run(serverId, inputId).changes > 0;
      if (removed) this.statements.incrementInputRevision.run();
      return removed;
    });
    this.applyInputMutations = this.database.transaction((serverId, mutations, updatedAt) => {
      let credentialsChanged = false;
      let inputValuesChanged = false;
      for (const mutation of mutations) {
        if (mutation.kind === "set_secret") {
          const current = this.statements.selectCredential.get(serverId, mutation.inputId);
          this.statements.upsertCredential.run({
            server_id: serverId,
            name: mutation.inputId,
            value_envelope: this.secrets.seal(mutation.value, credentialContext(serverId, mutation.inputId)),
            created_at: current?.created_at ?? updatedAt,
            updated_at: updatedAt,
          });
          credentialsChanged = true;
          continue;
        }
        if (mutation.kind === "delete_secret") {
          credentialsChanged =
            this.statements.deleteCredential.run(serverId, mutation.inputId).changes > 0 || credentialsChanged;
          continue;
        }
        if (mutation.kind === "set_value") {
          const current = this.statements.selectInputValue.get(serverId, mutation.inputId);
          this.statements.upsertInputValue.run({
            server_id: serverId,
            input_id: mutation.inputId,
            value_json: JSON.stringify(mutation.value),
            created_at: current?.created_at ?? updatedAt,
            updated_at: updatedAt,
          });
          inputValuesChanged = true;
          continue;
        }
        inputValuesChanged =
          this.statements.deleteInputValue.run(serverId, mutation.inputId).changes > 0 || inputValuesChanged;
      }
      if (credentialsChanged) this.statements.incrementRevision.run();
      if (inputValuesChanged) this.statements.incrementInputRevision.run();
    });
  }

  resolve(serverId: string, name: string): string | undefined {
    const row = this.statements.selectCredential.get(serverId, name);
    return row
      ? this.secrets.open(row.value_envelope, credentialContext(serverId, name), `MCP credential ${serverId}/${name}`)
      : undefined;
  }

  upsert(serverId: string, name: string, value: string, updatedAt = new Date().toISOString()): void {
    this.writeCredential(serverId, name, value, updatedAt);
  }

  delete(serverId: string, name: string): boolean {
    return this.removeCredential(serverId, name);
  }

  resolveInput(serverId: string, inputId: string): AgentExtensionInputValue | undefined {
    const row = this.statements.selectInputValue.get(serverId, inputId);
    if (!row) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value_json);
    } catch (error) {
      throw new Error(`Stored MCP input ${serverId}/${inputId} is not valid JSON.`, { cause: error });
    }
    return AgentExtensionInputValueSchema.parse(parsed);
  }

  upsertInput(
    serverId: string,
    inputId: string,
    value: AgentExtensionInputValue,
    updatedAt = new Date().toISOString(),
  ): void {
    this.writeInputValue(serverId, inputId, value, updatedAt);
  }

  deleteInput(serverId: string, inputId: string): boolean {
    return this.removeInputValue(serverId, inputId);
  }

  updateInputs(
    serverId: string,
    mutations: readonly AgentMcpInputStorageMutation[],
    updatedAt = new Date().toISOString(),
  ): void {
    if (mutations.length === 0) return;
    this.applyInputMutations(serverId, mutations, updatedAt);
  }

  listInputs(serverId?: string): readonly AgentMcpStoredInputMetadata[] {
    const rows = serverId ? this.statements.listServerInputValues.all(serverId) : this.statements.listInputValues.all();
    return rows.map(projectInputMetadata);
  }

  list(serverId?: string): readonly AgentMcpStoredCredentialMetadata[] {
    const rows = serverId ? this.statements.listServerCredentials.all(serverId) : this.statements.listCredentials.all();
    return rows.map(projectMetadata);
  }

  revision(): number {
    const state = this.statements.selectRevision.get();
    if (!state) throw new Error("MCP credential state is unavailable.");
    return state.revision;
  }

  inputRevision(): number {
    const state = this.statements.selectInputRevision.get();
    if (!state) throw new Error("MCP input state is unavailable.");
    return state.revision;
  }

  close(): void {
    this.kernel.close();
  }
}

function projectInputMetadata(row: AgentMcpInputValueMetadataRow): AgentMcpStoredInputMetadata {
  return {
    serverId: row.server_id,
    inputId: row.input_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function credentialContext(serverId: string, name: string): string {
  return `senera/mcp/${encodeURIComponent(serverId)}/environment/${encodeURIComponent(name)}`;
}

function projectMetadata(row: AgentMcpCredentialMetadataRow): AgentMcpStoredCredentialMetadata {
  return {
    serverId: row.server_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
