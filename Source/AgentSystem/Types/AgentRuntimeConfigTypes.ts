export interface AgentLoopConfig {
  PiTurnLeaseTimeoutSeconds?: number;
  RunSettlementTimeoutSeconds?: number;
  PiSessions?: AgentPiSessionsConfig;
}

export interface AgentEventWriterConfig {
  RestartDelayMs?: number;
  CloseTimeoutMs?: number;
  DrainBatchSize?: number;
  CommittedRetentionMs?: number;
}

export interface ResolvedAgentEventWriterConfig {
  RestartDelayMs: number;
  CloseTimeoutMs: number;
  DrainBatchSize: number;
  CommittedRetentionMs: number;
}

export interface AgentPiSessionsConfig {
  RootDir?: string;
  MaxCachedSessions?: number;
  Compaction?: AgentPiCompactionConfig;
}

export interface AgentPiCompactionConfig {
  Enabled?: boolean;
}

export interface ResolvedAgentPiSessionsConfig {
  RootDir: string;
  MaxCachedSessions: number;
  Compaction: ResolvedAgentPiCompactionConfig;
}

export interface ResolvedAgentPiCompactionConfig {
  Enabled: boolean;
}

export interface ResolvedAgentLoopConfig {
  PiTurnLeaseTimeoutSeconds: number;
  PiTurnLeaseTimeoutMs: number;
  RunSettlementTimeoutSeconds: number;
  RunSettlementTimeoutMs: number;
  PiSessions: ResolvedAgentPiSessionsConfig;
}

export interface AgentTodosConfig {
  MaxItems?: number;
  MaxContentCharacters?: number;
  MaxResultCharacters?: number;
}

export type ResolvedAgentTodosConfig = Required<AgentTodosConfig>;

export interface AgentToolExecutionConfig {
  TimeoutSeconds?: number;
  MaxConcurrentCallsPerRun?: number;
  MaxStdoutBytes?: number;
  MaxStderrBytes?: number;
  SemanticAudit?: AgentToolSemanticAuditConfig;
  Environment?: AgentProcessEnvironmentConfig;
  Resources?: AgentExecutionResourcesConfig;
}

/**
 * Lifecycle policy for MCP client connections. Tool execution resources and
 * MCP connections have different ownership, so the connection pool gets its
 * own configuration surface while sharing the execution resource defaults.
 */
export interface AgentMcpConnectionsConfig {
  /** Set to 0 to disable idle eviction and keep pooled connections resident. */
  IdleTtlSeconds?: number;
  SweepIntervalSeconds?: number;
}

export interface ResolvedAgentMcpConnectionsConfig {
  IdleTtlMs: number;
  SweepIntervalMs: number;
}

export const AgentToolSemanticAuditModes = {
  Disabled: "disabled",
  ApprovalSensitive: "approval_sensitive",
} as const;

export type AgentToolSemanticAuditMode = (typeof AgentToolSemanticAuditModes)[keyof typeof AgentToolSemanticAuditModes];

export interface AgentToolSemanticAuditConfig {
  Mode?: AgentToolSemanticAuditMode;
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
  OutputBatchMaxBytes?: number;
  OutputBatchMaxDelayMs?: number;
  MaxInputBytes?: number;
  InitialYieldSeconds?: number;
  MaxWaitSeconds?: number;
  IdleTtlSeconds?: number;
  TerminalTtlSeconds?: number;
  SweepIntervalSeconds?: number;
  TerminationGraceSeconds?: number;
}

export interface ResolvedAgentToolExecutionConfig {
  TimeoutMs: number;
  MaxConcurrentCallsPerRun: number;
  MaxStdoutBytes: number;
  MaxStderrBytes: number;
  SemanticAudit: Required<AgentToolSemanticAuditConfig>;
  Environment: Required<AgentProcessEnvironmentConfig>;
  Resources: ResolvedAgentExecutionResourcesConfig;
}

export interface ResolvedAgentExecutionResourcesConfig extends Required<AgentExecutionResourcesConfig> {
  MaxWaitMs: number;
  InitialYieldMs: number;
  IdleTtlMs: number;
  TerminalTtlMs: number;
  SweepIntervalMs: number;
  TerminationGraceMs: number;
}

export interface AgentSandboxRuntimeConfig {
  Enabled?: boolean;
  Provider?: AgentSandboxProviderPreference;
  BaseDir?: string;
  Docker?: AgentDockerRuntimeConfig;
}

export interface ResolvedAgentSandboxRuntimeConfig {
  Enabled: boolean;
  Provider: AgentSandboxProviderPreference;
  BaseDir: string;
  Docker: ResolvedAgentDockerRuntimeConfig;
}

export type AgentSandboxProviderPreference = "auto" | "gvisor" | "docker-engine";

export type AgentDockerImagePullPolicy = "always" | "if-missing" | "never";

export interface AgentDockerRuntimeConfig {
  WorkerEndpoint?: string;
  EngineEndpoint?: string;
  DetectionTimeoutSeconds?: number;
  PreparationTimeoutSeconds?: number;
  Image?: string;
  PullPolicy?: AgentDockerImagePullPolicy;
}

export interface ResolvedAgentDockerRuntimeConfig {
  WorkerEndpoint?: string;
  EngineEndpoint?: string;
  DetectionTimeoutSeconds: number;
  PreparationTimeoutSeconds: number;
  Image: string;
  PullPolicy: AgentDockerImagePullPolicy;
}

export interface AgentArtifactsConfig {
  RootDir?: string;
  ToolObservationMaxTokens?: number;
  RawJsonMaxBytes?: number;
  TextFileMaxBytes?: number;
  WorkspaceObserverMemoryMaxBytes?: number;
  WorkspaceObserverSettleMs?: number;
  WorkspaceObserverIdleTtlMs?: number;
  WorkspaceObserverIgnoredPaths?: string[];
  WorkspacePatchContextLines?: number;
  MemoryReadMaxArtifacts?: number;
  MemoryReadMaxConcurrency?: number;
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
  ToolObservationMaxTokens: number;
  RawJsonMaxBytes: number;
  TextFileMaxBytes: number;
  WorkspaceObserverMemoryMaxBytes: number;
  WorkspaceObserverSettleMs: number;
  WorkspaceObserverIdleTtlMs: number;
  WorkspaceObserverIgnoredPaths: string[];
  WorkspacePatchContextLines: number;
  MemoryReadMaxArtifacts: number;
  MemoryReadMaxConcurrency: number;
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
  MirrorJson?: boolean;
  RevisionRetentionCount?: number;
  CommandReceiptRetentionHours?: number;
  CommandReceiptMaxCount?: number;
}

export interface AgentPromptConfig {
  /** Wrap the user message in an attribution XML envelope at request time. */
  UserMessageEnvelope?: boolean;
  /** Request-local timezone rendered inside the envelope. */
  TimeZone?: string;
  /** The only user-authored persona content included in the model prompt. */
  CorePersona?: string;
  /** The only user-authored voice/style guidance included in the model prompt. */
  LanguageStyle?: string;
  /** Rewrite the short preface shown before tool execution; independent of persona text. */
  PrefaceRewrite?: boolean;
  /** Rewrite the settled final answer independently of persona text (polish tier when no card). */
  FinalResponseRewrite?: boolean;
  /** Wrap BAML tool observations with attribution="tool" at the projection exit. */
  BamlToolAttribution?: boolean;
}

export interface ResolvedAgentPromptConfig {
  UserMessageEnvelope: boolean;
  TimeZone: string;
  CorePersona?: string;
  LanguageStyle?: string;
  /** Optional for backwards-compatible embedders; resolver always supplies false/true. */
  PrefaceRewrite?: boolean;
  /** Optional for backwards-compatible embedders; resolver always supplies false/true. */
  FinalResponseRewrite?: boolean;
  BamlToolAttribution: boolean;
}

/** Shared model-inference admission policy for foreground and background work. */
export interface AgentInferenceBudgetConfig {
  Enabled?: boolean;
  WindowSeconds?: number;
  MaxRequests?: number;
  MaxEstimatedInputTokens?: number;
  MaxEstimatedOutputTokens?: number;
  MaxConcurrent?: number;
  /** Fraction of the global request/token capacity reserved for foreground work. */
  ForegroundReserveFraction?: number;
  /** Optional lane weights; unknown lanes use the resolved default weight. */
  LaneWeights?: Record<string, number>;
}

export interface ResolvedAgentInferenceBudgetConfig {
  Enabled: boolean;
  WindowSeconds: number;
  MaxRequests: number;
  MaxEstimatedInputTokens: number;
  MaxEstimatedOutputTokens: number;
  MaxConcurrent: number;
  ForegroundReserveFraction: number;
  LaneWeights: Record<string, number>;
}

export interface ResolvedAgentPersistenceConfig {
  Kind: "sqlite" | "memory";
  EventWriter: ResolvedAgentEventWriterConfig;
}

export interface ResolvedAgentConfigStoreConfig {
  Enabled: boolean;
  Kind: "sqlite";
  MirrorJson: boolean;
  RevisionRetentionCount: number;
  CommandReceiptRetentionHours: number;
  CommandReceiptMaxCount: number;
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
  MaxRateLimitClients?: number;
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
  AllowInsecureHttp?: boolean;
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
  AllowInsecureHttp: boolean;
  Session: Required<AgentServerSessionConfig>;
  Limits: Required<AgentServerConnectionLimitsConfig>;
}

export interface ResolvedAgentServerConfig extends Required<Omit<AgentServerConfig, "AccessControl">> {
  AccessControl: ResolvedAgentServerAccessControlConfig;
}
