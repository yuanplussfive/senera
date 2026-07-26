import type Database from "better-sqlite3";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentConfigDatabaseContract } from "./AgentConfigSqlSchema.js";
import { AgentConfigSecretCodec, resolveAgentConfigSecretWorkspaceRoot } from "./AgentConfigSecretProtection.js";
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

export interface AgentConfigCommandWriteInput {
  commandId: string;
  operationKind: string;
  payloadHash: string;
  source: AgentConfigRevisionRecord["source"];
  createdAt?: string;
}

export interface AgentConfigCommandWriteResult {
  revision: AgentConfigRevisionRecord;
  replayed: boolean;
  appliedRevision: number;
}

export class AgentConfigCommandIdConflictError extends Error {
  readonly code = "config_command_id_conflict";

  constructor(
    readonly commandId: string,
    readonly expected: { operationKind: string; payloadHash: string },
    readonly received: { operationKind: string; payloadHash: string },
  ) {
    super(`Configuration commandId was reused with a different command: ${commandId}`);
    this.name = "AgentConfigCommandIdConflictError";
  }
}

export class AgentConfigSqliteRepository {
  private readonly kernel: AgentSqliteDatabaseKernel;
  private readonly db: Database.Database;
  private readonly statements: AgentConfigSqlStatements;
  private readonly secretCodec: AgentConfigSecretCodec;

  constructor(databasePath: string, secretCodec?: AgentConfigSecretCodec) {
    this.kernel = new AgentSqliteDatabaseKernel({ databasePath, contract: AgentConfigDatabaseContract });
    this.db = this.kernel.connection;
    this.statements = prepareAgentConfigSqlStatements(this.db);
    this.secretCodec =
      secretCodec ?? new AgentConfigSecretCodec({ workspaceRoot: resolveAgentConfigSecretWorkspaceRoot(databasePath) });
    this.db.pragma("secure_delete = ON");
    this.protectLegacyRevisionSecrets();
  }

  latestRevision(): AgentConfigRevisionRecord | undefined {
    const row = this.statements.selectLatestRevision.get();
    return row ? this.rowToRevision(row) : undefined;
  }

  appendRevision(input: AgentConfigWriteInput): AgentConfigRevisionRecord {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const insert = this.db.transaction(() => {
      const nextRevision = this.nextRevision();
      this.statements.insertRevision.run({
        revision: nextRevision,
        config_json: JSON.stringify(this.secretCodec.protectConfig(input.config)),
        source: input.source,
        created_at: createdAt,
      });
      return nextRevision;
    });

    const revision = insert.immediate();
    return {
      revision,
      config: input.config,
      source: input.source,
      createdAt,
    };
  }

  executeCommand(
    input: AgentConfigCommandWriteInput,
    transform: (current: AgentConfigRevisionRecord) => AgentSystemConfig,
  ): AgentConfigCommandWriteResult {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const execute = this.db.transaction((): AgentConfigCommandWriteResult => {
      const receipt = this.statements.selectCommandReceipt.get(input.commandId);
      if (receipt) {
        if (receipt.operation_kind !== input.operationKind || receipt.payload_hash !== input.payloadHash) {
          throw new AgentConfigCommandIdConflictError(
            input.commandId,
            { operationKind: receipt.operation_kind, payloadHash: receipt.payload_hash },
            { operationKind: input.operationKind, payloadHash: input.payloadHash },
          );
        }
        const recorded = this.statements.selectRevision.get(receipt.revision);
        const latest = this.statements.selectLatestRevision.get();
        if (!recorded || !latest) {
          throw new Error(`Configuration command receipt references missing revision ${receipt.revision}.`);
        }
        return { revision: this.rowToRevision(latest), replayed: true, appliedRevision: receipt.revision };
      }

      const current = this.statements.selectLatestRevision.get();
      if (!current) throw new Error("Configuration database does not contain a latest revision.");
      const config = transform(this.rowToRevision(current));
      const revision = this.nextRevision();
      this.statements.insertRevision.run({
        revision,
        config_json: JSON.stringify(this.secretCodec.protectConfig(config)),
        source: input.source,
        created_at: createdAt,
      });
      this.statements.insertCommandReceipt.run({
        command_id: input.commandId,
        operation_kind: input.operationKind,
        payload_hash: input.payloadHash,
        revision,
        created_at: createdAt,
      });
      return {
        revision: {
          revision,
          config,
          source: input.source,
          createdAt,
        },
        replayed: false,
        appliedRevision: revision,
      };
    });

    return execute.immediate();
  }

  close(): void {
    this.kernel.close();
  }

  private nextRevision(): number {
    const row = this.statements.selectNextRevision.get();
    if (!row) throw new Error("Unable to allocate the next configuration revision.");
    return row.revision;
  }

  private rowToRevision(row: AgentConfigRevisionRow): AgentConfigRevisionRecord {
    const parsed = JSON.parse(row.config_json) as AgentSystemConfig;
    return {
      revision: row.revision,
      config: this.secretCodec.revealConfig(parsed).value,
      source: row.source,
      createdAt: row.created_at,
    };
  }

  private protectLegacyRevisionSecrets(): void {
    const revisions = this.statements.selectAllRevisions.all();
    let protectedSecretsFound = false;
    const rewrites = revisions.flatMap((row) => {
      const payload = JSON.parse(row.config_json) as unknown;
      const revealed = this.secretCodec.revealPayload(payload);
      protectedSecretsFound ||= revealed.protectedSecretsFound;
      return revealed.plaintextSecretsFound
        ? [
            {
              revision: row.revision,
              configJson: JSON.stringify(this.secretCodec.protectPayload(revealed.value)),
            },
          ]
        : [];
    });
    if (rewrites.length === 0) {
      if (protectedSecretsFound) {
        this.kernel.checkpoint();
      }
      return;
    }

    const rewrite = this.db.transaction(() => {
      for (const item of rewrites) {
        this.statements.updateRevisionConfig.run({
          revision: item.revision,
          config_json: item.configJson,
        });
      }
    });
    rewrite.immediate();
    this.kernel.checkpoint();
    this.db.exec("VACUUM");
    this.kernel.checkpoint();
  }
}
