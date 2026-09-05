import { z } from "zod";
import { AgentToolSemanticAuditModes } from "../Types/AgentRuntimeConfigTypes.js";

const AgentPiCompactionSchema = z
  .object({
    Enabled: z.boolean().optional(),
  })
  .strict();

export const AgentLoopSchema = z
  .object({
    PiTurnLeaseTimeoutSeconds: z.number().positive().optional(),
    RunSettlementTimeoutSeconds: z.number().positive().max(300).optional(),
    PiSessions: z
      .object({
        RootDir: z.string().min(1).optional(),
        MaxCachedSessions: z.number().int().min(0).optional(),
        Compaction: AgentPiCompactionSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const TodosSchema = z
  .object({
    MaxItems: z.number().int().positive().optional(),
    MaxContentCharacters: z.number().int().positive().optional(),
    MaxResultCharacters: z.number().int().positive().optional(),
  })
  .strict();

export const InferenceBudgetSchema = z
  .object({
    Enabled: z.boolean().optional(),
    WindowSeconds: z.number().finite().positive().optional(),
    MaxRequests: z.number().int().positive().optional(),
    MaxEstimatedInputTokens: z.number().int().positive().optional(),
    MaxEstimatedOutputTokens: z.number().int().positive().optional(),
    MaxConcurrent: z.number().int().positive().optional(),
    ForegroundReserveFraction: z.number().finite().min(0).max(1).optional(),
    LaneWeights: z.record(z.string().trim().min(1), z.number().finite().positive()).optional(),
  })
  .strict();

export const ToolExecutionSchema = z
  .object({
    TimeoutSeconds: z.number().positive().optional(),
    MaxConcurrentCallsPerRun: z.number().int().min(1).max(1_000).optional(),
    MaxStdoutBytes: z.number().int().min(1).optional(),
    MaxStderrBytes: z.number().int().min(1).optional(),
    SemanticAudit: z
      .object({
        Mode: z.enum([AgentToolSemanticAuditModes.Disabled, AgentToolSemanticAuditModes.ApprovalSensitive]).optional(),
      })
      .strict()
      .optional(),
    Environment: z
      .object({
        Inherit: z.enum(["all", "allowlist", "none"]).optional(),
        IncludeOnly: z.array(z.string().min(1)).optional(),
        Exclude: z.array(z.string().min(1)).optional(),
        Set: z.record(z.string(), z.string()).optional(),
      })
      .strict()
      .optional(),
    Resources: z
      .object({
        MaxActive: z.number().int().min(1).max(1_000).optional(),
        MaxBufferedBytes: z.number().int().min(1_024).optional(),
        OutputBatchMaxBytes: z.number().int().min(1_024).optional(),
        OutputBatchMaxDelayMs: z.number().int().positive().max(5_000).optional(),
        MaxInputBytes: z.number().int().min(1).optional(),
        InitialYieldSeconds: z.number().positive().max(60).optional(),
        MaxWaitSeconds: z.number().positive().max(300).optional(),
        IdleTtlSeconds: z.number().positive().optional(),
        TerminalTtlSeconds: z.number().positive().optional(),
        SweepIntervalSeconds: z.number().positive().optional(),
        TerminationGraceSeconds: z.number().positive().max(60).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const SandboxRuntimeSchema = z
  .object({
    Enabled: z.boolean().optional(),
    Provider: z.enum(["auto", "gvisor", "docker-engine"]).optional(),
    BaseDir: z.string().min(1).optional(),
    Docker: z
      .object({
        WorkerEndpoint: z.string().trim().min(1).optional(),
        EngineEndpoint: z.string().trim().min(1).optional(),
        DetectionTimeoutSeconds: z.number().positive().max(30).optional(),
        PreparationTimeoutSeconds: z.number().positive().max(300).optional(),
        Image: z.string().trim().min(1).optional(),
        PullPolicy: z.enum(["always", "if-missing", "never"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const PresetsSchema = z
  .object({
    Enabled: z.boolean().optional(),
    RootDir: z.string().min(1).optional(),
    StateFile: z.string().min(1).optional(),
    PromptBudget: z
      .object({
        MaxExamples: z.number().int().positive().optional(),
        MaxLoreEntries: z.number().int().positive().optional(),
        MaxSupplementalCharacters: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ArtifactsSchema = z
  .object({
    RootDir: z.string().min(1).optional(),
    SummaryMaxChars: z.number().int().min(256).optional(),
    RawJsonMaxBytes: z.number().int().min(1024).optional(),
    TextFileMaxBytes: z.number().int().min(1024).optional(),
    MemoryReadMaxArtifacts: z.number().int().positive().optional(),
    MemoryReadMaxRefs: z.number().int().positive().optional(),
    MemoryReadMaxConcurrency: z.number().int().positive().optional(),
    MemoryReadStructuredJsonMaxTokens: z.number().int().positive().optional(),
    OutputCaptureMaxBytes: z.number().int().min(1024).optional(),
    MaxStoredBytes: z.number().int().positive().optional(),
    MaxArtifacts: z.number().int().positive().optional(),
    RetentionHours: z.number().positive().optional(),
    IncompleteRetentionHours: z.number().positive().optional(),
    MaintenanceIntervalMinutes: z.number().positive().optional(),
    MaintenanceMaxConcurrency: z.number().int().positive().optional(),
  })
  .strict();

export const UploadsSchema = z
  .object({
    RootDir: z.string().min(1).optional(),
    MaxFileBytes: z.number().int().min(1).optional(),
    MaxRequestBytes: z.number().int().min(1).optional(),
    MaxFilesPerRequest: z.number().int().min(1).optional(),
    MaxConcurrentUploads: z.number().int().min(1).optional(),
    MaxStoredBytes: z.number().int().min(1).optional(),
    RetentionHours: z.number().int().min(1).optional(),
    MaintenanceIntervalMinutes: z.number().int().min(1).optional(),
  })
  .strict();

export const ConfigStoreSchema = z
  .object({
    Enabled: z.boolean().optional(),
    Kind: z.literal("sqlite").optional(),
    MirrorJson: z.boolean().optional(),
    RevisionRetentionCount: z.number().int().min(1).max(10_000).optional(),
    CommandReceiptRetentionHours: z.number().int().min(1).max(8_760).optional(),
    CommandReceiptMaxCount: z.number().int().min(1).max(100_000).optional(),
  })
  .strict();

export const ServerSchema = z
  .object({
    Host: z.string().min(1).optional(),
    Port: z.number().int().min(1).max(65535).optional(),
    HotReload: z.boolean().optional(),
    RequestMaxBytes: z.number().int().min(1).optional(),
    AccessControl: z
      .object({
        Mode: z.enum(["auto", "required", "disabled"]).optional(),
        AccountFile: z.string().min(1).optional(),
        AllowedOrigins: z.array(z.string().url()).optional(),
        TrustedProxyAddresses: z.array(z.string().min(1)).optional(),
        AllowInsecureLoopback: z.boolean().optional(),
        AllowInsecureHttp: z.boolean().optional(),
        Session: z
          .object({
            AbsoluteTtlHours: z.number().int().min(1).max(72).optional(),
            IdleTtlHours: z.number().int().min(1).max(72).optional(),
            MaxSessions: z.number().int().min(1).max(100).optional(),
          })
          .strict()
          .optional(),
        Limits: z
          .object({
            MaxConnections: z.number().int().min(1).max(10_000).optional(),
            MaxConnectionsPerClient: z.number().int().min(1).max(1_000).optional(),
            MaxRateLimitClients: z.number().int().min(1).max(1_000_000).optional(),
            UpgradeRequestsPerMinute: z.number().int().min(1).max(100_000).optional(),
            HttpRequestsPerMinute: z.number().int().min(1).max(100_000).optional(),
            MessagesPerMinute: z.number().int().min(1).max(100_000).optional(),
            LoginAttemptsPerMinute: z.number().int().min(1).max(10_000).optional(),
            HeartbeatIntervalSeconds: z.number().int().min(5).max(3_600).optional(),
            IdleSocketTimeoutSeconds: z.number().int().min(10).max(86_400).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const PersistenceSchema = z
  .object({
    Kind: z.union([z.literal("sqlite"), z.literal("memory")]).optional(),
  })
  .strict();

export const PromptSchema = z
  .object({
    /** Wrap the user message in an attribution XML envelope at request time. */
    UserMessageEnvelope: z.boolean().optional(),
    /** Default request-local timezone; renders as <time> inside the envelope. */
    TimeZone: z.string().min(1).optional(),
    /** Rewrite the model-authored preface independently from roleplay presets. */
    PrefaceRewrite: z.boolean().optional(),
    /** Re-anchor the persona before the reference stage when a preset is active. */
    RoleCheck: z.boolean().optional(),
    /** Wrap BAML tool observations with attribution="tool" at the projection exit. */
    BamlToolAttribution: z.boolean().optional(),
  })
  .strict();

const AgentWorldLocalTimeSchema = z.string().regex(/^\d{2}:\d{2}$/u, "World phase time must use HH:mm.");

export const WorldSchema = z
  .object({
    Name: z.string().trim().min(1).optional(),
    TimeZone: z.string().trim().min(1).optional(),
    DayPhases: z
      .array(
        z
          .object({
            Id: z.string().trim().min(1),
            Label: z.string().trim().min(1),
            StartsAt: AgentWorldLocalTimeSchema,
            EndsAt: AgentWorldLocalTimeSchema,
          })
          .strict(),
      )
      .min(1)
      .optional(),
    RecordLimit: z.number().int().positive().optional(),
    TimelineLimit: z.number().int().positive().optional(),
    HabitCatchUpLimit: z.number().int().positive().optional(),
    GoalMicroLoop: z
      .object({
        Enabled: z.boolean().optional(),
        MaxCandidates: z.number().int().positive().optional(),
        ReviewDelaySeconds: z.number().finite().min(1).optional(),
        AllowedToolNames: z.array(z.string().trim().min(1)).optional(),
      })
      .strict()
      .optional(),
    ResidentIdle: z
      .object({
        Enabled: z.boolean().optional(),
        MinIntervalSeconds: z.number().finite().min(1).optional(),
        MaxIntervalSeconds: z.number().finite().min(1).optional(),
        BackoffMultiplier: z.number().finite().min(1).optional(),
        MaxPending: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    ActionBudget: z
      .object({
        MaxActionsPerWake: z.number().int().positive().optional(),
        MaxDecisionCandidatesPerWake: z.number().int().positive().optional(),
        RetryDelaySeconds: z.number().finite().min(1).optional(),
        LeaseDurationSeconds: z.number().finite().min(1).optional(),
        FairShare: z.boolean().optional(),
        SourceOrder: z.array(z.string().trim().min(1)).optional(),
        SourceCaps: z.record(z.string().trim().min(1), z.number().int().positive()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
