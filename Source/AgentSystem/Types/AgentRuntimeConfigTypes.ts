export interface AgentLoopConfig {
  PiTurnLeaseTimeoutSeconds?: number;
  RunSettlementTimeoutSeconds?: number;
  PiSessions?: AgentPiSessionsConfig;
}

export interface AgentPiSessionsConfig {
  RootDir?: string;
  MaxCachedSessions?: number;
  Compaction?: AgentPiCompactionConfig;
}

export interface AgentPiCompactionConfig {
  Enabled?: boolean;
  TriggerRatio?: number;
  HardLimitRatio?: number;
  TargetRatio?: number;
  SummaryMaxTokens?: number;
  TimeoutSeconds?: number;
  UnknownContextWindowTokens?: number;
  UnknownModelOutputTokens?: number;
}

export interface ResolvedAgentPiSessionsConfig {
  RootDir: string;
  MaxCachedSessions: number;
  Compaction: ResolvedAgentPiCompactionConfig;
}

export interface ResolvedAgentPiCompactionConfig {
  Enabled: boolean;
  TriggerRatio: number;
  HardLimitRatio: number;
  TargetRatio: number;
  SummaryMaxTokens: number;
  TimeoutSeconds: number;
  TimeoutMs: number;
  UnknownContextWindowTokens: number;
  UnknownModelOutputTokens: number;
}

export interface ResolvedAgentLoopConfig {
  PiTurnLeaseTimeoutSeconds: number;
  PiTurnLeaseTimeoutMs: number;
  RunSettlementTimeoutSeconds: number;
  RunSettlementTimeoutMs: number;
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
  Environment?: AgentProcessEnvironmentConfig;
  Resources?: AgentExecutionResourcesConfig;
}

export interface AgentProcessEnvironmentConfig {
  Inherit?: "all" | "allowlist" | "none";
  IncludeOnly?: string[];
  Exclude?: string[];
  Set?: Record<string, string>;
}

export interface AgentExecutionResourcesConfig {
  MaxActive?: number;
  MaxBufferedBytes?: number;
  MaxInputBytes?: number;
  MaxWaitSeconds?: number;
  IdleTtlSeconds?: number;
  TerminalTtlSeconds?: number;
  SweepIntervalSeconds?: number;
  TerminationGraceSeconds?: number;
}

export interface ResolvedAgentToolExecutionConfig {
  TimeoutMs: number;
  MaxStdoutBytes: number;
  MaxStderrBytes: number;
  Environment: Required<AgentProcessEnvironmentConfig>;
  Resources: ResolvedAgentExecutionResourcesConfig;
}

export interface ResolvedAgentExecutionResourcesConfig extends Required<AgentExecutionResourcesConfig> {
  MaxWaitMs: number;
  IdleTtlMs: number;
  TerminalTtlMs: number;
  SweepIntervalMs: number;
  TerminationGraceMs: number;
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
  MemoryReadStructuredJsonMaxBytes?: number;
  MemoryReadMaxArtifacts?: number;
  MemoryReadMaxRefs?: number;
  MemoryReadMaxConcurrency?: number;
  MemoryReadCacheMaxBytes?: number;
  MemoryReadCacheMaxEntries?: number;
  OutputCaptureMaxBytes?: number;
  MaxStoredBytes?: number;
  MaxArtifacts?: number;
  RetentionHours?: number;
  IncompleteRetentionHours?: number;
  MaintenanceIntervalMinutes?: number;
  MaintenanceMaxConcurrency?: number;
}

export interface ResolvedAgentArtifactsConfig {
  RootDir: string;
  SummaryMaxChars: number;
  RawJsonMaxBytes: number;
  TextFileMaxBytes: number;
  MemoryReadStructuredJsonMaxBytes: number;
  MemoryReadMaxArtifacts: number;
  MemoryReadMaxRefs: number;
  MemoryReadMaxConcurrency: number;
  MemoryReadCacheMaxBytes: number;
  MemoryReadCacheMaxEntries: number;
  OutputCaptureMaxBytes: number;
  MaxStoredBytes: number;
  MaxArtifacts: number;
  RetentionHours: number;
  IncompleteRetentionHours: number;
  MaintenanceIntervalMinutes: number;
  MaintenanceMaxConcurrency: number;
}

export interface AgentUploadsConfig {
  RootDir?: string;
  MaxFileBytes?: number;
  MaxRequestBytes?: number;
  MaxFilesPerRequest?: number;
  MaxConcurrentUploads?: number;
  MaxStoredBytes?: number;
  RetentionHours?: number;
  MaintenanceIntervalMinutes?: number;
}

export interface ResolvedAgentUploadsConfig {
  RootDir: string;
  MaxFileBytes: number;
  MaxRequestBytes: number;
  MaxFilesPerRequest: number;
  MaxConcurrentUploads: number;
  MaxStoredBytes: number;
  RetentionHours: number;
  MaintenanceIntervalMinutes: number;
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

export type AgentServerAccessMode = "auto" | "required" | "disabled";

export interface AgentServerSessionConfig {
  AbsoluteTtlHours?: number;
  IdleTtlHours?: number;
  MaxSessions?: number;
}

export interface AgentServerConnectionLimitsConfig {
  MaxConnections?: number;
  MaxConnectionsPerClient?: number;
  UpgradeRequestsPerMinute?: number;
  HttpRequestsPerMinute?: number;
  MessagesPerMinute?: number;
  LoginAttemptsPerMinute?: number;
  HeartbeatIntervalSeconds?: number;
  IdleSocketTimeoutSeconds?: number;
}

export interface AgentServerAccessControlConfig {
  Mode?: AgentServerAccessMode;
  AccountFile?: string;
  AllowedOrigins?: string[];
  TrustedProxyAddresses?: string[];
  AllowInsecureLoopback?: boolean;
  Session?: AgentServerSessionConfig;
  Limits?: AgentServerConnectionLimitsConfig;
}

export interface AgentServerConfig {
  Host?: string;
  Port?: number;
  HotReload?: boolean;
  RequestMaxBytes?: number;
  AccessControl?: AgentServerAccessControlConfig;
}

export interface ResolvedAgentServerAccessControlConfig {
  Mode: AgentServerAccessMode;
  AccountFile: string;
  AllowedOrigins: string[];
  TrustedProxyAddresses: string[];
  AllowInsecureLoopback: boolean;
  Session: Required<AgentServerSessionConfig>;
  Limits: Required<AgentServerConnectionLimitsConfig>;
}

export interface ResolvedAgentServerConfig extends Required<Omit<AgentServerConfig, "AccessControl">> {
  AccessControl: ResolvedAgentServerAccessControlConfig;
}
