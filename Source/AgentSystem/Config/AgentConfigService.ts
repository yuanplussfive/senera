import { AgentConfigLoader } from "../AgentConfigLoader.js";
import { AgentJsonFileLoader } from "../AgentJsonFileLoader.js";
import { resolveConfigStoreConfig } from "../AgentDefaults.js";
import { AgentSystemConfigSchema } from "../Schemas/AgentSystemConfigSchema.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentConfigFormSnapshot } from "../Types/ConfigFormTypes.js";
import { projectAgentConfigForm } from "./AgentConfigFormProjector.js";
import {
  AgentConfigSqliteRepository,
  type AgentConfigRevisionRecord,
} from "./AgentConfigSqliteRepository.js";
import { formatConfigIssues } from "./AgentConfigDiagnostics.js";
import {
  resolveConfigPath,
  resolveConfigStoreDatabasePath,
  writeAgentConfigJsonMirror,
} from "./AgentConfigServicePaths.js";

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
  repaired: boolean;
}

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
        repaired: false,
      };
      return this.snapshotFromRevision(latest.revision.config, latest.revision, {
        path: source.configPath,
        databasePath,
        version,
        diagnostics: latest.repaired
          ? [{
              severity: "warning",
              message: "配置数据库中的旧配置已不兼容，已从当前 JSON 镜像重新导入。",
            }]
          : [],
      });
    } catch (error) {
      return {
        path: source.configPath,
        version,
        value: jsonConfig,
        source: "json",
        databasePath: this.resolveDatabasePath(jsonConfig),
        diagnostics: [{
          severity: "error",
          message: "配置数据库不可用，已使用 JSON 镜像启动。",
          details: error instanceof Error ? error.message : String(error),
        }],
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

    const parsed = AgentSystemConfigSchema.safeParse(latest.config);
    if (!parsed.success) {
      throw new Error(`配置数据库中的配置结构无效：${formatConfigIssues(parsed.error.issues)}`);
    }

    return this.snapshotFromRevision(parsed.data, {
      ...latest,
      config: parsed.data,
    }, {
      path: this.readSourceLabel(source),
      databasePath,
      version,
      diagnostics: [],
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
        repaired: false,
      };
    }

    return {
      revision: repository.appendRevision({
        config: seedConfig,
        source: "seed",
      }),
      repaired: true,
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
    const store = resolveConfigStoreConfig(config);
    return resolveConfigStoreDatabasePath(this.options.workspaceRoot, config);
  }

  private resolveSqliteSourceDatabasePath(
    source: Extract<AgentConfigSourceOptions, { kind: "sqlite" }>,
  ): string {
    return resolveConfigPath(this.options.workspaceRoot, source.databasePath);
  }

  private readSourceLabel(
    source: Extract<AgentConfigSourceOptions, { kind: "sqlite" }>,
  ): string {
    return source.label ?? this.resolveSqliteSourceDatabasePath(source);
  }
}

export function loadConfigFile(filePath: string): AgentSystemConfig {
  return new AgentJsonFileLoader().load(filePath, AgentSystemConfigSchema);
}
