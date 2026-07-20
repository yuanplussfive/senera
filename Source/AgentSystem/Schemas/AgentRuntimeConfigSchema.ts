import { z } from "zod";

export const LoadedToolsSchema = z.union([z.literal("all"), z.literal("dynamic"), z.array(z.string().min(1))]);

const AgentPiCompactionSchema = z
  .object({
    Enabled: z.boolean().optional(),
    TriggerRatio: z.number().min(0.5).max(0.95).optional(),
    HardLimitRatio: z.number().min(0.6).max(1).optional(),
    TargetRatio: z.number().min(0.2).max(0.8).optional(),
    SummaryMaxTokens: z.number().int().min(512).max(32_768).optional(),
    TimeoutSeconds: z.number().positive().optional(),
    UnknownContextWindowTokens: z.number().int().min(16_384).optional(),
    UnknownModelOutputTokens: z.number().int().min(512).max(131_072).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.TriggerRatio !== undefined &&
      value.TargetRatio !== undefined &&
      value.TargetRatio >= value.TriggerRatio
    ) {
      context.addIssue({
        code: "custom",
        path: ["TargetRatio"],
        message: "TargetRatio 必须小于 TriggerRatio。",
      });
    }
    if (
      value.TriggerRatio !== undefined &&
      value.HardLimitRatio !== undefined &&
      value.TriggerRatio >= value.HardLimitRatio
    ) {
      context.addIssue({
        code: "custom",
        path: ["HardLimitRatio"],
        message: "HardLimitRatio 必须大于 TriggerRatio。",
      });
    }
  });

export const AgentLoopSchema = z
  .object({
    LoadedTools: LoadedToolsSchema.optional(),
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

export const ToolExecutionSchema = z
  .object({
    TimeoutSeconds: z.number().positive().optional(),
    MaxStdoutBytes: z.number().int().min(1).optional(),
    MaxStderrBytes: z.number().int().min(1).optional(),
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
        MaxInputBytes: z.number().int().min(1).optional(),
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
    BaseDir: z.string().min(1).optional(),
    BundleDir: z.string().min(1).optional(),
    ImportBundlesOnStartup: z.boolean().optional(),
    Images: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const PresetsSchema = z
  .object({
    Enabled: z.boolean().optional(),
    RootDir: z.string().min(1).optional(),
    StateFile: z.string().min(1).optional(),
  })
  .strict();

export const ArtifactsSchema = z
  .object({
    RootDir: z.string().min(1).optional(),
    SummaryMaxChars: z.number().int().min(256).optional(),
    RawJsonMaxBytes: z.number().int().min(1024).optional(),
    TextFileMaxBytes: z.number().int().min(1024).optional(),
    MemoryReadStructuredJsonMaxBytes: z.number().int().min(1024).optional(),
    MemoryReadMaxArtifacts: z.number().int().positive().optional(),
    MemoryReadMaxRefs: z.number().int().positive().optional(),
    MemoryReadMaxConcurrency: z.number().int().positive().optional(),
    MemoryReadCacheMaxBytes: z.number().int().nonnegative().optional(),
    MemoryReadCacheMaxEntries: z.number().int().nonnegative().optional(),
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
    DatabasePath: z.string().min(1).optional(),
    MirrorJson: z.boolean().optional(),
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
    DatabasePath: z.string().min(1).optional(),
  })
  .strict();

export const PluginRootsSchema = z
  .object({
    System: z.array(z.string().min(1)).optional(),
    User: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const PluginDiscoverySchema = z
  .object({
    ManifestFileName: z.string().min(1).optional(),
    ConfigFileName: z.string().min(1).optional(),
  })
  .strict();
