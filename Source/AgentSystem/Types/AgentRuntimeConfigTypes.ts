export type AgentLoadedToolsConfig = "all" | "dynamic" | string[];

export interface AgentLoopConfig {
  MaxSteps?: number;
  MaxRepairAttempts?: number;
  LoadedTools?: AgentLoadedToolsConfig;
}

export type ResolvedAgentLoopConfig = Required<AgentLoopConfig>;

export interface ResolvedAgentPluginRootsConfig {
  System: string[];
  User: string[];
}

export interface ResolvedAgentPluginDiscoveryConfig {
  ManifestFileName: string;
  ConfigFileName: string;
}

export interface AgentToolExecutionConfig {
  Mode?: "Process";
  TimeoutSeconds?: number;
  MaxStdoutBytes?: number;
  MaxStderrBytes?: number;
}

export interface ResolvedAgentToolExecutionConfig {
  Mode: "Process";
  TimeoutMs: number;
  MaxStdoutBytes: number;
  MaxStderrBytes: number;
}

export interface AgentPresetsConfig {
  Enabled?: boolean;
  RootDir?: string;
  StateFile?: string;
}

export interface ResolvedAgentPresetsConfig {
  Enabled: boolean;
  RootDir: string;
  StateFile: string;
}

export interface AgentArtifactsConfig {
  RootDir?: string;
  SummaryMaxChars?: number;
  RawJsonMaxBytes?: number;
  TextFileMaxBytes?: number;
}

export interface ResolvedAgentArtifactsConfig {
  RootDir: string;
  SummaryMaxChars: number;
  RawJsonMaxBytes: number;
  TextFileMaxBytes: number;
}

export interface AgentUploadsConfig {
  RootDir?: string;
  MaxFileBytes?: number;
}

export interface ResolvedAgentUploadsConfig {
  RootDir: string;
  MaxFileBytes: number;
}

export interface AgentConfigStoreConfig {
  Enabled?: boolean;
  Kind?: "sqlite";
  DatabasePath?: string;
  MirrorJson?: boolean;
}

export interface ResolvedAgentPersistenceConfig {
  Kind: "sqlite" | "memory";
  DatabasePath: string;
}

export interface ResolvedAgentConfigStoreConfig {
  Enabled: boolean;
  Kind: "sqlite";
  DatabasePath: string;
  MirrorJson: boolean;
}
