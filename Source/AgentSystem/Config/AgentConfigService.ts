import { createHash } from "node:crypto";
import { AgentConfigLoader } from "../Config/AgentConfigLoader.js";
import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import { resolveConfigStoreConfig } from "../AgentDefaults.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { AgentSystemConfigSchema } from "../Schemas/AgentSystemConfigSchema.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentConfigFormSnapshot } from "../Types/ConfigFormTypes.js";
import { projectAgentConfigForm } from "./AgentConfigFormProjector.js";
import {
  assertConfigRevisionGuard,
  bulkImportProviderModels,
  deleteProviderEndpoint,
  deleteProviderModel,
  renameProviderEndpoint,
  setDefaultProviderModel,
  upsertProviderEndpoint,
  upsertProviderModel,
  type AgentConfigCommandInput,
  type AgentConfigRevisionGuardInput,
  type AgentDefaultModelSetInput,
  type AgentProviderEndpointDeleteInput,
  type AgentProviderEndpointRenameInput,
  type AgentProviderEndpointUpsertInput,
  type AgentProviderModelBulkImportInput,
  type AgentProviderModelDeleteInput,
  type AgentProviderModelUpsertInput,
} from "./AgentProviderModelConfigCommands.js";
import {
  AgentConfigCommandIdConflictError,
  AgentConfigSqliteRepository,
  type AgentConfigRevisionRecord,
} from "./AgentConfigSqliteRepository.js";
import { formatConfigIssues } from "./AgentConfigDiagnostics.js";
import {
  resolveConfigPath,
  resolveConfigStoreDatabasePath,
  persistMigratedAgentConfigJson,
  writeAgentConfigJsonMirror,
} from "./AgentConfigServicePaths.js";
import { migrateAgentConfigPayload } from "./AgentConfigMigration.js";

export type AgentConfigSnapshotSource = "sqlite" | "json";

export interface AgentConfigSnapshot {
  path: string;
  version: number;
  value: AgentSystemConfig;
  source: AgentConfigSnapshotSource;
  revision?: number;
  databasePath?: string;
  diagnostics: AgentConfigDiagnostic[];
  form: AgentConfigFormSnapshot;
}

export interface AgentConfigDiagnostic {
  severity: "warning" | "error";
  message: string;
  details?: unknown;
}

export interface AgentConfigReplaceInput extends AgentConfigCommandInput, AgentConfigRevisionGuardInput {
  config: AgentSystemConfig;
  source?: "ui_update" | "api_update";
}

export type AgentConfigSourceOptions =
  | {
      kind: "json";
      configPath: string;
    }
  | {
      kind: "sqlite";
      databasePath: string;
      seedConfig: AgentSystemConfig;
      label?: string;
    };

interface AgentConfigRevisionLoadResult {
  revision: AgentConfigRevisionRecord;
  repaired: AgentConfigRepairResult;
}

interface AgentConfigMigrationSummary {
  migratedPaths: string[];
  removedPaths: string[];
  sourceVersion?: number;
  targetVersion?: number;
}

type AgentConfigRepairResult =
  | {
      kind: "none";
    }
  | {
      kind: "migrated";
      sourceVersion: number;
      targetVersion: number;
      migratedPaths: string[];
      removedPaths: string[];
    };

export class AgentConfigService {
  private snapshotValue: AgentConfigSnapshot;
  private repository?: AgentConfigSqliteRepository;
  private repositoryPath?: string;
  private readonly jsonCommandReceipts = new Map<string, { operationKind: string; payloadHash: string }>();

  constructor(
    private readonly options: {
      workspaceRoot: string;
      source: AgentConfigSourceOptions;
    },
  ) {
    try {
      this.snapshotValue = this.initialize(1);
    } catch (error) {
      this.closeRepository();
      throw error;
    }
  }

  snapshot(): AgentConfigSnapshot {
    return this.snapshotValue;
  }

  replaceConfig(input: AgentConfigReplaceInput): AgentConfigSnapshot {
    const config = this.validateConfig(input.config);
    return this.executeConfigCommand(
      input,
      "config.update",
      {
        config,
        baseRevision: input.baseRevision,
        baseVersion: input.baseVersion,
      },
      (current) => {
        assertConfigRevisionGuard(input, current);
        return config;
      },
      input.source ?? "api_update",
    );
  }

  upsertProviderEndpoint(input: AgentProviderEndpointUpsertInput): AgentConfigSnapshot {
    return this.updateProviderModelConfig(input, "provider.endpoint.upsert", input.endpoint, (config) =>
      upsertProviderEndpoint(config, input),
    );
  }

  renameProviderEndpoint(input: AgentProviderEndpointRenameInput): AgentConfigSnapshot {
    return this.updateProviderModelConfig(
      input,
      "provider.endpoint.rename",
      { providerId: input.providerId, nextProviderId: input.nextProviderId },
      (config) => renameProviderEndpoint(config, input),
    );
  }

  deleteProviderEndpoint(input: AgentProviderEndpointDeleteInput): AgentConfigSnapshot {
    return this.updateProviderModelConfig(
      input,
      "provider.endpoint.delete",
      {
        providerId: input.providerId,
        cascadeModels: input.cascadeModels,
        replacementDefaultModelId: input.replacementDefaultModelId,
      },
      (config) => deleteProviderEndpoint(config, input),
    );
  }

  upsertProviderModel(input: AgentProviderModelUpsertInput): AgentConfigSnapshot {
    return this.updateProviderModelConfig(
      input,
      "provider.model.upsert",
      { model: input.model, group: input.group },
      (config) => upsertProviderModel(config, input),
    );
  }

  bulkImportProviderModels(input: AgentProviderModelBulkImportInput): AgentConfigSnapshot {
    return this.updateProviderModelConfig(
      input,
      "provider.model.bulkImport",
      {
        models: input.models,
        overwriteExisting: input.overwriteExisting,
        groupAssignments: input.groupAssignments,
      },
      (config) => bulkImportProviderModels(config, input),
    );
  }

  deleteProviderModel(input: AgentProviderModelDeleteInput): AgentConfigSnapshot {
    return this.updateProviderModelConfig(
      input,
      "provider.model.delete",
      { modelId: input.modelId, replacementDefaultModelId: input.replacementDefaultModelId },
      (config) => deleteProviderModel(config, input),
    );
  }

  setDefaultProviderModel(input: AgentDefaultModelSetInput): AgentConfigSnapshot {
    return this.updateProviderModelConfig(input, "provider.defaultModel.set", { modelId: input.modelId }, (config) =>
      setDefaultProviderModel(config, input),
    );
  }
  reloadFromSources(): AgentConfigSnapshot {
    this.snapshotValue = this.initialize(this.snapshotValue.version + 1);
    return this.snapshotValue;
  }

  close(): void {
    this.closeRepository();
  }

  private initialize(version: number): AgentConfigSnapshot {
    return this.options.source.kind === "sqlite"
      ? this.initializeSqlitePrimary(this.options.source, version)
      : this.initializeJson(this.options.source, version);
  }

  private initializeJson(
    source: Extract<AgentConfigSourceOptions, { kind: "json" }>,
    version: number,
  ): AgentConfigSnapshot {
    const loadedJson = AgentConfigLoader.loadWithMetadata(source.configPath);
    const jsonConfig = loadedJson.config;
    const migrationDiagnostics = loadedJson.migration
      ? [
          migrationDiagnostic(
            loadedJson.migration,
            persistMigratedAgentConfigJson(jsonConfig, source.configPath, loadedJson.migration.sourceVersion),
          ),
        ]
      : [];
    const store = resolveConfigStoreConfig(jsonConfig);
    if (!store.Enabled) {
      return {
        path: source.configPath,
        version,
        value: jsonConfig,
        source: "json",
        diagnostics: migrationDiagnostics,
        form: projectAgentConfigForm(jsonConfig),
      };
    }

    const databasePath = this.resolveDatabasePath(jsonConfig);
    const repository = this.repositoryForPath(databasePath);
    const latest = repository.latestRevision()
      ? this.readLatestValidRevision(repository)
      : {
          revision: repository.appendRevision({
            config: jsonConfig,
            source: "json_import",
          }),
          repaired: { kind: "none" } as const,
        };
    return this.snapshotFromRevision(latest.revision.config, latest.revision, {
      path: source.configPath,
      databasePath,
      version,
      diagnostics: [...migrationDiagnostics, ...diagnosticsForRepair(latest.repaired)],
    });
  }

  private initializeSqlitePrimary(
    source: Extract<AgentConfigSourceOptions, { kind: "sqlite" }>,
    version: number,
  ): AgentConfigSnapshot {
    const seedConfig = this.validateConfig(source.seedConfig);
    const databasePath = this.resolveSqliteSourceDatabasePath(source);
    const repository = this.repositoryForPath(databasePath);
    const latest = repository.latestRevision();
    if (!latest) {
      const revision = repository.appendRevision({
        config: seedConfig,
        source: "seed",
      });
      return this.snapshotFromRevision(revision.config, revision, {
        path: this.readSourceLabel(source),
        databasePath,
        version,
        diagnostics: [],
      });
    }

    const loaded = this.readLatestValidRevision(repository);

    return this.snapshotFromRevision(loaded.revision.config, loaded.revision, {
      path: this.readSourceLabel(source),
      databasePath,
      version,
      diagnostics: diagnosticsForRepair(loaded.repaired),
    });
  }

  private repositoryForPath(databasePath: string): AgentConfigSqliteRepository {
    if (this.repository && this.repositoryPath === databasePath) {
      return this.repository;
    }

    const repository = new AgentConfigSqliteRepository(databasePath);
    this.closeRepository();
    this.repository = repository;
    this.repositoryPath = databasePath;
    return repository;
  }

  private closeRepository(): void {
    this.repository?.close();
    this.repository = undefined;
    this.repositoryPath = undefined;
  }

  private updateProviderModelConfig(
    input: AgentConfigCommandInput,
    operationKind: string,
    payload: unknown,
    transform: (config: AgentSystemConfig) => AgentSystemConfig,
  ): AgentConfigSnapshot {
    return this.executeConfigCommand(input, operationKind, payload, (current) => transform(current.value), "ui_update");
  }

  private executeConfigCommand(
    input: AgentConfigCommandInput,
    operationKind: string,
    payload: unknown,
    transform: (current: Pick<AgentConfigSnapshot, "value" | "version" | "revision">) => AgentSystemConfig,
    source: AgentConfigRevisionRecord["source"],
  ): AgentConfigSnapshot {
    const payloadHash = createConfigCommandPayloadHash(operationKind, payload);
    if (!this.usesSqliteStore()) {
      if (this.options.source.kind !== "json") {
        throw new Error("JSON configuration command requires a JSON configuration source.");
      }
      const receipt = this.jsonCommandReceipts.get(input.commandId);
      if (receipt) {
        if (receipt.operationKind !== operationKind || receipt.payloadHash !== payloadHash) {
          throw new AgentConfigCommandIdConflictError(input.commandId, receipt, { operationKind, payloadHash });
        }
        return this.snapshotValue;
      }
      const config = this.validateConfig(transform(this.snapshotValue));
      writeAgentConfigJsonMirror(config, this.options.source.configPath);
      this.snapshotValue = {
        path: this.options.source.configPath,
        version: this.snapshotValue.version + 1,
        value: config,
        source: "json",
        diagnostics: [],
        form: projectAgentConfigForm(config),
      };
      this.jsonCommandReceipts.set(input.commandId, { operationKind, payloadHash });
      return this.snapshotValue;
    }

    const databasePath = this.activeDatabasePath();
    const result = this.repositoryForPath(databasePath).executeCommand(
      {
        commandId: input.commandId,
        operationKind,
        payloadHash,
        source,
      },
      (current) =>
        this.validateConfig(
          transform({
            value: current.config,
            version: this.snapshotValue.version,
            revision: current.revision,
          }),
        ),
    );
    this.snapshotValue = this.snapshotFromRevision(result.revision.config, result.revision, {
      path:
        this.options.source.kind === "json"
          ? this.options.source.configPath
          : this.readSourceLabel(this.options.source),
      databasePath,
      diagnostics: [],
    });
    const store = resolveConfigStoreConfig(result.revision.config);
    this.writeCommittedJsonMirror(result.revision.config, store.MirrorJson);
    return this.snapshotValue;
  }

  private usesSqliteStore(): boolean {
    return this.options.source.kind === "sqlite" || resolveConfigStoreConfig(this.snapshotValue.value).Enabled;
  }

  private activeDatabasePath(): string {
    return this.options.source.kind === "sqlite"
      ? this.resolveSqliteSourceDatabasePath(this.options.source)
      : this.resolveDatabasePath(this.snapshotValue.value);
  }

  private writeCommittedJsonMirror(config: AgentSystemConfig, enabled: boolean): void {
    if (!enabled || this.options.source.kind !== "json") return;
    try {
      writeAgentConfigJsonMirror(config, this.options.source.configPath);
    } catch (error) {
      this.snapshotValue = {
        ...this.snapshotValue,
        diagnostics: [
          ...this.snapshotValue.diagnostics,
          {
            severity: "warning",
            message: agentErrorMessage("config.mirrorWriteFailed", {
              path: this.options.source.configPath,
              error: error instanceof Error ? error.message : String(error),
            }),
          },
        ],
      };
    }
  }
  private readLatestValidRevision(repository: AgentConfigSqliteRepository): AgentConfigRevisionLoadResult {
    const latest = repository.latestRevision();
    if (!latest) {
      throw new Error("Configuration database does not contain a latest revision.");
    }

    const migrated = migrateAgentConfigPayload(latest.config);
    const result = AgentSystemConfigSchema.safeParse(migrated?.config ?? latest.config);
    if (result.success) {
      if (migrated) {
        return {
          revision: repository.appendRevision({
            config: result.data,
            source: "migration",
          }),
          repaired: {
            kind: "migrated",
            sourceVersion: migrated.sourceVersion,
            targetVersion: migrated.targetVersion,
            migratedPaths: migrated.migratedPaths,
            removedPaths: migrated.removedPaths,
          },
        };
      }
      return {
        revision: {
          ...latest,
          config: result.data,
        },
        repaired: { kind: "none" },
      };
    }

    throw new Error(
      agentErrorMessage("config.databaseInvalid", {
        issues: formatConfigIssues(result.error.issues),
      }),
    );
  }

  private snapshotFromRevision(
    config: AgentSystemConfig,
    revision: AgentConfigRevisionRecord,
    options: {
      path: string;
      databasePath: string;
      version?: number;
      diagnostics: AgentConfigDiagnostic[];
    },
  ): AgentConfigSnapshot {
    return {
      path: options.path,
      version: options.version ?? this.snapshotValue.version + 1,
      value: config,
      source: "sqlite",
      revision: revision.revision,
      databasePath: options.databasePath,
      diagnostics: options.diagnostics,
      form: projectAgentConfigForm(config),
    };
  }

  private validateConfig(config: AgentSystemConfig): AgentSystemConfig {
    const migrated = migrateAgentConfigPayload(config);
    return AgentSystemConfigSchema.parse(migrated?.config ?? config);
  }

  private resolveDatabasePath(config: AgentSystemConfig): string {
    return resolveConfigStoreDatabasePath(this.options.workspaceRoot, config);
  }

  private resolveSqliteSourceDatabasePath(source: Extract<AgentConfigSourceOptions, { kind: "sqlite" }>): string {
    return resolveConfigPath(this.options.workspaceRoot, source.databasePath);
  }

  private readSourceLabel(source: Extract<AgentConfigSourceOptions, { kind: "sqlite" }>): string {
    return source.label ?? this.resolveSqliteSourceDatabasePath(source);
  }
}

export function loadConfigFile(filePath: string): AgentSystemConfig {
  return AgentConfigLoader.load(filePath);
}

function createConfigCommandPayloadHash(operationKind: string, payload: unknown): string {
  return createHash("sha256").update(stringifyAgentCanonicalJson({ operationKind, payload }), "utf8").digest("hex");
}

function diagnosticsForRepair(repair: AgentConfigRepairResult): AgentConfigDiagnostic[] {
  if (repair.kind === "none") {
    return [];
  }

  if (repair.kind === "migrated") {
    return [migrationDiagnostic(repair)];
  }

  return [];
}

function migrationDiagnostic(
  migration: AgentConfigMigrationSummary,
  persistence?: { backupPath?: string },
): AgentConfigDiagnostic {
  return {
    severity: "warning",
    message: agentErrorMessage("config.migrationApplied", {
      sourceVersion: migration.sourceVersion ?? "legacy",
      targetVersion: migration.targetVersion ?? "current",
    }),
    details: {
      migratedPaths: migration.migratedPaths,
      removedPaths: migration.removedPaths,
      ...(persistence?.backupPath ? { backupPath: persistence.backupPath } : {}),
    },
  };
}
