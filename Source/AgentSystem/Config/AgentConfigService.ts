import { AgentConfigLoader } from "../Config/AgentConfigLoader.js";
import { AgentJsonFileLoader } from "../Config/AgentJsonFileLoader.js";
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
  type AgentConfigRevisionGuardInput,
  type AgentDefaultModelSetInput,
  type AgentProviderEndpointDeleteInput,
  type AgentProviderEndpointRenameInput,
  type AgentProviderEndpointUpsertInput,
  type AgentProviderModelBulkImportInput,
  type AgentProviderModelDeleteInput,
  type AgentProviderModelUpsertInput,
} from "./AgentProviderModelConfigCommands.js";
import { AgentConfigSqliteRepository, type AgentConfigRevisionRecord } from "./AgentConfigSqliteRepository.js";
import { formatConfigIssues } from "./AgentConfigDiagnostics.js";
import {
  resolveConfigPath,
  resolveConfigStoreDatabasePath,
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

export interface AgentConfigUpdateInput {
  config: AgentSystemConfig;
  source?: "ui_update" | "api_update";
  mirrorJson?: boolean;
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

type AgentConfigRepairResult =
  | {
      kind: "none";
    }
  | {
      kind: "migrated";
      migratedPaths: string[];
      removedPaths: string[];
    }
  | {
      kind: "seed_reimported";
    };

export class AgentConfigService {
  private snapshotValue: AgentConfigSnapshot;
  private repository?: AgentConfigSqliteRepository;
  private repositoryPath?: string;

  constructor(
    private readonly options: {
      workspaceRoot: string;
      source: AgentConfigSourceOptions;
    },
  ) {
    this.snapshotValue = this.initialize(1);
  }

  snapshot(): AgentConfigSnapshot {
    return this.snapshotValue;
  }

  update(input: AgentConfigUpdateInput): AgentConfigSnapshot {
    const config = this.validateConfig(input.config);
    if (this.options.source.kind === "sqlite") {
      const source = this.options.source;
      const databasePath = this.resolveSqliteSourceDatabasePath(source);
      const revision = this.repositoryForPath(databasePath).appendRevision({
        config,
        source: input.source ?? "api_update",
      });
      this.snapshotValue = this.snapshotFromRevision(config, revision, {
        path: this.readSourceLabel(source),
        databasePath,
        diagnostics: [],
      });
      return this.snapshotValue;
    }

    const store = resolveConfigStoreConfig(config);
    if (!store.Enabled) {
      this.closeRepository();
      writeAgentConfigJsonMirror(config, this.options.source.configPath);
      this.snapshotValue = {
        path: this.options.source.configPath,
        version: this.snapshotValue.version + 1,
        value: config,
        source: "json",
        diagnostics: [],
        form: projectAgentConfigForm(config),
      };
      return this.snapshotValue;
    }

    const databasePath = this.resolveDatabasePath(config);
    const revision = this.repositoryForPath(databasePath).appendRevision({
      config,
      source: input.source ?? "api_update",
    });
    if (input.mirrorJson ?? store.MirrorJson) {
      writeAgentConfigJsonMirror(config, this.options.source.configPath);
    }
    this.snapshotValue = this.snapshotFromRevision(config, revision, {
      path: this.options.source.configPath,
      databasePath,
      diagnostics: [],
    });
    return this.snapshotValue;
  }


  upsertProviderEndpoint(input: AgentProviderEndpointUpsertInput): AgentConfigSnapshot {
    return this.updateProviderModelConfig(input, (config) => upsertProviderEndpoint(config, input));
  }

  renameProviderEndpoint(input: AgentProviderEndpointRenameInput): AgentConfigSnapshot {
    return this.updateProviderModelConfig(input, (config) => renameProviderEndpoint(config, input));
  }

  deleteProviderEndpoint(input: AgentProviderEndpointDeleteInput): AgentConfigSnapshot {
    return this.updateProviderModelConfig(input, (config) => deleteProviderEndpoint(config, input));
  }

  upsertProviderModel(input: AgentProviderModelUpsertInput): AgentConfigSnapshot {
    return this.updateProviderModelConfig(input, (config) => upsertProviderModel(config, input));
  }

  bulkImportProviderModels(input: AgentProviderModelBulkImportInput): AgentConfigSnapshot {
    return this.updateProviderModelConfig(input, (config) => bulkImportProviderModels(config, input));
  }

  deleteProviderModel(input: AgentProviderModelDeleteInput): AgentConfigSnapshot {
    return this.updateProviderModelConfig(input, (config) => deleteProviderModel(config, input));
  }

  setDefaultProviderModel(input: AgentDefaultModelSetInput): AgentConfigSnapshot {
    return this.updateProviderModelConfig(input, (config) => setDefaultProviderModel(config, input));
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
    const jsonConfig = AgentConfigLoader.load(source.configPath);
    const store = resolveConfigStoreConfig(jsonConfig);
    if (!store.Enabled) {
      return {
        path: source.configPath,
        version,
        value: jsonConfig,
        source: "json",
        diagnostics: [],
        form: projectAgentConfigForm(jsonConfig),
      };
    }

    try {
      const databasePath = this.resolveDatabasePath(jsonConfig);
      const repository = this.repositoryForPath(databasePath);
      const latest = this.readLatestValidRevision(repository, jsonConfig) ?? {
        revision: repository.appendRevision({
          config: jsonConfig,
          source: "json_import",
        }),
        repaired: { kind: "none" },
      };
      return this.snapshotFromRevision(latest.revision.config, latest.revision, {
        path: source.configPath,
        databasePath,
        version,
        diagnostics: diagnosticsForRepair(latest.repaired),
      });
    } catch (error) {
      return {
        path: source.configPath,
        version,
        value: jsonConfig,
        source: "json",
        databasePath: this.resolveDatabasePath(jsonConfig),
        diagnostics: [
          {
            severity: "error",
            message: agentErrorMessage("config.databaseUnavailableJsonMirror"),
            details: error instanceof Error ? error.message : String(error),
          },
        ],
        form: projectAgentConfigForm(jsonConfig),
      };
    }
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

    const loaded = this.readLatestValidRevision(repository, seedConfig) ?? {
      revision: repository.appendRevision({
        config: seedConfig,
        source: "seed",
      }),
      repaired: { kind: "none" },
    };

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
    input: AgentConfigRevisionGuardInput,
    transform: (config: AgentSystemConfig) => AgentSystemConfig,
  ): AgentConfigSnapshot {
    const snapshot = this.snapshotValue;
    assertConfigRevisionGuard(input, {
      revision: snapshot.revision,
      version: snapshot.version,
    });
    return this.update({
      config: transform(snapshot.value),
      source: "ui_update",
      mirrorJson: input.mirrorJson,
    });
  }
  private readLatestValidRevision(
    repository: AgentConfigSqliteRepository,
    seedConfig: AgentSystemConfig,
  ): AgentConfigRevisionLoadResult | undefined {
    const latest = repository.latestRevision();
    if (!latest) {
      return undefined;
    }

    const result = AgentSystemConfigSchema.safeParse(latest.config);
    if (result.success) {
      return {
        revision: {
          ...latest,
          config: result.data,
        },
        repaired: { kind: "none" },
      };
    }

    const migrated = migrateAgentConfigPayload(latest.config, AgentSystemConfigSchema);
    if (migrated) {
      return {
        revision: repository.appendRevision({
          config: migrated.config,
          source: "migration",
        }),
        repaired: {
          kind: "migrated",
          migratedPaths: migrated.migratedPaths,
          removedPaths: migrated.removedPaths,
        },
      };
    }

    if (seedConfig === latest.config) {
      throw new Error(
        agentErrorMessage("config.databaseInvalid", {
          issues: formatConfigIssues(result.error.issues),
        }),
      );
    }

    return {
      revision: repository.appendRevision({
        config: seedConfig,
        source: "seed",
      }),
      repaired: { kind: "seed_reimported" },
    };
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
    return AgentSystemConfigSchema.parse(config);
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
  return new AgentJsonFileLoader().load(filePath, AgentSystemConfigSchema);
}

function diagnosticsForRepair(repair: AgentConfigRepairResult): AgentConfigDiagnostic[] {
  if (repair.kind === "none") {
    return [];
  }

  if (repair.kind === "migrated") {
    return [];
  }

  return [
    {
      severity: "warning",
      message: agentErrorMessage("config.databaseLegacyReimported"),
    },
  ];
}
