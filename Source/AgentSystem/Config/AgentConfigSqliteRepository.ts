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
import type { AgentUpgradeSession } from "../Upgrade/AgentUpgradeSession.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { AgentDefaults } from "../Defaults/AgentDefaultCatalog.js";
import {
  assertAgentConfigHistoryRetentionPolicy,
  projectAgentConfigHistoryRetentionPolicy,
  type AgentConfigHistoryRetentionPolicy,
} from "./AgentConfigHistoryRetention.js";

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
  retention?: AgentConfigHistoryRetentionPolicy;
}

export interface AgentConfigCommandWriteInput {
  commandId: string;
  operationKind: string;
  payloadHash: string;
  source: AgentConfigRevisionRecord["source"];
  createdAt?: string;
  retention?: AgentConfigHistoryRetentionPolicy;
}

export interface AgentConfigHistoryPruneResult {
  readonly commandReceipts: number;
  readonly revisions: number;
}

export interface AgentConfigCommandWriteResult {
  revision: AgentConfigRevisionRecord;
  replayed: boolean;
  appliedRevision: number;
}

export interface AgentConfigSqliteRepositoryOptions {
  readonly upgradeSession?: AgentUpgradeSession;
  readonly secretCodec?: AgentConfigSecretCodec;
}

const AgentConfigSecretStorageMigration = Object.freeze({
  id: "agent-config-secrets",
  sourceVersion: 0,
  targetVersion: 1,
});

const DefaultConfigHistoryRetentionPolicy = projectAgentConfigHistoryRetentionPolicy(AgentDefaults.ConfigStore);

export class AgentConfigCommandIdConflictError extends AgentBaseError {
  readonly code = "config_command_id_conflict";

  constructor(
    readonly commandId: string,
    readonly expected: { operationKind: string; payloadHash: string },
    readonly received: { operationKind: string; payloadHash: string },
  ) {
    super(`Configuration commandId was reused with a different command: ${commandId}`);
  }
}

export class AgentConfigSqliteRepository {
  private readonly kernel: AgentSqliteDatabaseKernel;
  private readonly db: Database.Database;
  private readonly statements: AgentConfigSqlStatements;
  private readonly secretCodec: AgentConfigSecretCodec;

  constructor(databasePath: string, options: AgentConfigSqliteRepositoryOptions = {}) {
    this.secretCodec =
      options.secretCodec ??
      new AgentConfigSecretCodec({ workspaceRoot: resolveAgentConfigSecretWorkspaceRoot(databasePath) });
    this.kernel = new AgentSqliteDatabaseKernel({
      databasePath,
      contract: AgentConfigDatabaseContract,
      upgradeSession: options.upgradeSession,
    });
    this.db = this.kernel.connection;
    this.statements = prepareAgentConfigSqlStatements(this.db);
    try {
      this.db.pragma("secure_delete = ON");
      this.protectLegacyRevisionSecrets(databasePath, options.upgradeSession);
    } catch (error) {
      this.kernel.close();
      throw error;
    }
  }

  latestRevision(): AgentConfigRevisionRecord | undefined {
    const row = this.statements.selectLatestRevision.get();
    return row ? this.rowToRevision(row) : undefined;
  }

  appendRevision(input: AgentConfigWriteInput): AgentConfigRevisionRecord {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const retention = assertAgentConfigHistoryRetentionPolicy(input.retention ?? DefaultConfigHistoryRetentionPolicy);
    const insert = this.db.transaction(() => {
      const nextRevision = this.nextRevision();
      this.statements.insertRevision.run({
        revision: nextRevision,
        config_json: JSON.stringify(this.secretCodec.protectConfig(input.config)),
        source: input.source,
        created_at: createdAt,
      });
      this.pruneHistoryRows(createdAt, retention);
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
    const retention = assertAgentConfigHistoryRetentionPolicy(input.retention ?? DefaultConfigHistoryRetentionPolicy);
    const execute = this.db.transaction((): AgentConfigCommandWriteResult => {
      this.pruneHistoryRows(createdAt, retention);
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
      this.pruneHistoryRows(createdAt, retention);
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

  pruneHistory(
    retention: AgentConfigHistoryRetentionPolicy = DefaultConfigHistoryRetentionPolicy,
    now = new Date().toISOString(),
  ): AgentConfigHistoryPruneResult {
    const policy = assertAgentConfigHistoryRetentionPolicy(retention);
    return this.db.transaction(() => this.pruneHistoryRows(now, policy)).immediate();
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
    const parsed = parseJsonText(row.config_json, "Agent config revision") as AgentSystemConfig;
    return {
      revision: row.revision,
      config: this.secretCodec.revealConfig(parsed).value,
      source: row.source,
      createdAt: row.created_at,
    };
  }

  private pruneHistoryRows(now: string, retention: AgentConfigHistoryRetentionPolicy): AgentConfigHistoryPruneResult {
    const cutoff = configReceiptCutoff(now, retention.commandReceiptRetentionHours);
    const expired = this.statements.deleteExpiredCommandReceipts.run(cutoff).changes;
    const excess = this.statements.deleteExcessCommandReceipts.run(retention.commandReceiptMaxCount).changes;
    const revisions = this.statements.deleteUnretainedRevisions.run(retention.revisionRetentionCount).changes;
    return { commandReceipts: expired + excess, revisions };
  }

  private protectLegacyRevisionSecrets(databasePath: string, upgradeSession?: AgentUpgradeSession): void {
    const inspection = inspectRevisionSecretStorage(this.db, this.secretCodec);
    if (!inspection.plaintextSecretsFound) {
      if (inspection.protectedSecretsFound) this.kernel.checkpoint();
      return;
    }

    const migrate = (database: Database.Database): void => {
      protectRevisionSecretStorage(database, this.secretCodec);
    };
    if (upgradeSession) {
      upgradeSession.migrateSqliteData({
        ...AgentConfigSecretStorageMigration,
        database: this.db,
        databasePath,
        migrate,
      });
      return;
    }
    migrate(this.db);
  }
}

function configReceiptCutoff(now: string, retentionHours: number): string {
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) throw new RangeError(`Invalid config history maintenance timestamp: ${now}`);
  return new Date(timestamp - retentionHours * 60 * 60 * 1_000).toISOString();
}

function inspectRevisionSecretStorage(
  database: Database.Database,
  secretCodec: AgentConfigSecretCodec,
): { plaintextSecretsFound: boolean; protectedSecretsFound: boolean } {
  let plaintextSecretsFound = false;
  let protectedSecretsFound = false;
  const statements = prepareAgentConfigSqlStatements(database);
  for (const row of statements.selectAllRevisions.all()) {
    const revealed = secretCodec.revealPayload(parseJsonText(row.config_json, "Agent config revision") as unknown);
    plaintextSecretsFound ||= revealed.plaintextSecretsFound;
    protectedSecretsFound ||= revealed.protectedSecretsFound;
  }
  return { plaintextSecretsFound, protectedSecretsFound };
}

function protectRevisionSecretStorage(database: Database.Database, secretCodec: AgentConfigSecretCodec): void {
  database.pragma("secure_delete = ON");
  const statements = prepareAgentConfigSqlStatements(database);
  const rewrites = statements.selectAllRevisions.all().flatMap((row) => {
    const revealed = secretCodec.revealPayload(parseJsonText(row.config_json, "Agent config revision") as unknown);
    return revealed.plaintextSecretsFound
      ? [
          {
            revision: row.revision,
            configJson: JSON.stringify(secretCodec.protectPayload(revealed.value)),
          },
        ]
      : [];
  });
  if (rewrites.length === 0) return;

  database
    .transaction(() => {
      for (const item of rewrites) {
        statements.updateRevisionConfig.run({ revision: item.revision, config_json: item.configJson });
      }
    })
    .immediate();
  database.pragma("wal_checkpoint(TRUNCATE)");
  database.exec("VACUUM");
  database.pragma("wal_checkpoint(TRUNCATE)");
}
