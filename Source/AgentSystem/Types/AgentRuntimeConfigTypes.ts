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

export interface AgentPresetsConfig {
  Enabled?: boolean;
  RootDir?: string;
  StateFile?: string;
  PromptBudget?: AgentPresetPromptBudgetConfig;
}

export interface AgentPresetPromptBudgetConfig {
  MaxExamples?: number;
  MaxLoreEntries?: number;
  MaxSupplementalCharacters?: number;
}

export interface ResolvedAgentPresetPromptBudgetConfig {
  MaxExamples: number;
  MaxLoreEntries: number;
  MaxSupplementalCharacters: number;
}

export interface ResolvedAgentPresetsConfig extends Required<Omit<AgentPresetsConfig, "PromptBudget">> {
  Enabled: boolean;
  RootDir: string;
  StateFile: string;
  PromptBudget: ResolvedAgentPresetPromptBudgetConfig;
}

export interface AgentArtifactsConfig {
  RootDir?: string;
  SummaryMaxChars?: number;
  RawJsonMaxBytes?: number;
  TextFileMaxBytes?: number;
  MemoryReadMaxArtifacts?: number;
  MemoryReadMaxRefs?: number;
  MemoryReadMaxConcurrency?: number;
  MemoryReadStructuredJsonMaxTokens?: number;
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
  MemoryReadMaxArtifacts: number;
  MemoryReadMaxRefs: number;
  MemoryReadMaxConcurrency: number;
  MemoryReadStructuredJsonMaxTokens: number;
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
  /** Rewrite the short preface shown before tool execution; independent of presets. */
  PrefaceRewrite?: boolean;
  /** Re-anchor persona before the reference stage when a preset is active. */
  RoleCheck?: boolean;
  /** Wrap BAML tool observations with attribution="tool" at the projection exit. */
  BamlToolAttribution?: boolean;
}

export interface ResolvedAgentPromptConfig {
  UserMessageEnvelope: boolean;
  TimeZone: string;
  /** Optional for backwards-compatible embedders; resolver always supplies false/true. */
  PrefaceRewrite?: boolean;
  RoleCheck: boolean;
  BamlToolAttribution: boolean;
}

export interface AgentWorldDayPhaseConfig {
  Id: string;
  Label: string;
  StartsAt: string;
  EndsAt: string;
}

export interface AgentWorldGoalMicroLoopConfig {
  /** Enables the bounded Goal perceive -> decide -> act cycle. */
  Enabled?: boolean;
  /** Maximum Goals considered in one wake; prevents an unbounded model turn. */
  MaxCandidates?: number;
  /** Minimum delay before an autonomous Goal is reviewed again. */
  ReviewDelaySeconds?: number;
  /** Host allowlist for tools an autonomous Goal run may use. */
  AllowedToolNames?: string[];
}

export interface ResolvedAgentWorldGoalMicroLoopConfig {
  Enabled: boolean;
  MaxCandidates: number;
  ReviewDelaySeconds: number;
  AllowedToolNames: string[];
}

export interface AgentWorldResidentIdleConfig {
  /** Enables sparse, model-backed idle cognition for the active Resident. */
  Enabled?: boolean;
  /** Initial delay between idle ticks. */
  MinIntervalSeconds?: number;
  /** Upper bound for exponential backoff between unchanged ticks. */
  MaxIntervalSeconds?: number;
  /** Multiplier applied after a wait/unchanged decision. */
  BackoffMultiplier?: number;
  /** Maximum idle ticks inspected in one wake. */
  MaxPending?: number;
}

export interface ResolvedAgentWorldResidentIdleConfig {
  Enabled: boolean;
  MinIntervalSeconds: number;
  MaxIntervalSeconds: number;
  BackoffMultiplier: number;
  MaxPending: number;
}

export interface AgentWorldActionBudgetConfig {
  /** Maximum admitted action or decision units in one World wake. */
  MaxActionsPerWake?: number;
  /** Maximum model-backed decision candidates admitted in one World wake. */
  MaxDecisionCandidatesPerWake?: number;
  /** Delay before retrying candidates deferred by budget contention. */
  RetryDelaySeconds?: number;
  /** Lease duration for durable world work items once execution starts. */
  LeaseDurationSeconds?: number;
  /** Shares the global action budget across active wake sources. */
  FairShare?: boolean;
  /** Optional deterministic source precedence; omitted sources sort by source id. */
  SourceOrder?: string[];
  /** Optional per-source caps keyed by a stable wake source id. */
  SourceCaps?: Record<string, number>;
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

export interface ResolvedAgentWorldActionBudgetConfig {
  MaxActionsPerWake: number;
  MaxDecisionCandidatesPerWake: number;
  RetryDelaySeconds: number;
  LeaseDurationSeconds: number;
  FairShare: boolean;
  SourceOrder: string[];
  SourceCaps: Record<string, number>;
}

export interface AgentWorldConfig {
  Name?: string;
  TimeZone?: string;
  DayPhases?: AgentWorldDayPhaseConfig[];
  RecordLimit?: number;
  TimelineLimit?: number;
  HabitCatchUpLimit?: number;
  GoalMicroLoop?: AgentWorldGoalMicroLoopConfig;
  ResidentIdle?: AgentWorldResidentIdleConfig;
  ActionBudget?: AgentWorldActionBudgetConfig;
}

export interface ResolvedAgentWorldConfig {
  Name: string;
  TimeZone: string;
  DayPhases: AgentWorldDayPhaseConfig[];
  RecordLimit: number;
  TimelineLimit: number;
  HabitCatchUpLimit: number;
  GoalMicroLoop?: ResolvedAgentWorldGoalMicroLoopConfig;
  ResidentIdle?: ResolvedAgentWorldResidentIdleConfig;
  ActionBudget?: ResolvedAgentWorldActionBudgetConfig;
}

export interface ResolvedAgentPersistenceConfig {
  Kind: "sqlite" | "memory";
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
