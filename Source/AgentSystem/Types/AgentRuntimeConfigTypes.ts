export type AgentLoadedToolsConfig = "all" | "dynamic" | string[];

export interface AgentLoopConfig {
  LoadedTools?: AgentLoadedToolsConfig;
  PiSessionCreateTimeoutSeconds?: number;
  PiSessions?: AgentPiSessionsConfig;
}

export interface AgentPiSessionsConfig {
  RootDir?: string;
}

export interface ResolvedAgentPiSessionsConfig {
  RootDir: string;
}

export interface ResolvedAgentLoopConfig {
  LoadedTools: AgentLoadedToolsConfig;
  PiSessionCreateTimeoutSeconds: number;
  PiSessionCreateTimeoutMs: number;
  PiSessions: ResolvedAgentPiSessionsConfig;
}

export interface ResolvedAgentPluginRootsConfig {
  System: string[];
  User: string[];
}

export interface ResolvedAgentPluginDiscoveryConfig {
  ManifestFileName: string;
  ConfigFileName: string;
}

export interface AgentToolExecutionConfig {
  TimeoutSeconds?: number;
  MaxStdoutBytes?: number;
  MaxStderrBytes?: number;
}

export interface ResolvedAgentToolExecutionConfig {
  TimeoutMs: number;
  MaxStdoutBytes: number;
  MaxStderrBytes: number;
}

export interface AgentSandboxRuntimeConfig {
  BaseDir?: string;
  BundleDir?: string;
  ImportBundlesOnStartup?: boolean;
  Images?: string[];
}

export interface ResolvedAgentSandboxRuntimeConfig {
  BaseDir: string;
  BundleDir: string;
  ImportBundlesOnStartup: boolean;
  Images: string[];
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
