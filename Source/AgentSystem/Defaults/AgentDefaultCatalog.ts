import fs from "node:fs";
import path from "node:path";
import type { AgentDefaultsConfig, ResolvedAgentModelProviderEndpointConfig } from "../Types/AgentConfigTypes.js";
import type {
  AgentModelRuntimeDefaultsConfig,
  AgentVectorModelsDefaultsConfig,
  ResolvedAgentDefaultsConfig,
} from "./AgentDefaultValueTypes.js";
import { moduleDirPath } from "../Core/AgentPath.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import { SeneraDefaultTerminationGraceMs } from "../Execution/SeneraTerminationPolicy.js";
import { AgentPiSessionCacheDefaults } from "../Pi/AgentPiSessionCachePolicy.js";
import { AgentToolSearchMemoryExpansionModes } from "../Types/AgentToolAndMemoryConfigTypes.js";
import { AgentModelResponseBudgetDefaults } from "../ModelEndpoints/ModelResponseBudget.js";
import { SeneraDefaultProcessEnvironmentIncludeOnly } from "../Execution/SeneraProcessEnvironment.js";
import { AgentToolSemanticAuditModes } from "../Types/AgentRuntimeConfigTypes.js";
import {
  AgentContinuityPromptBudgetDefaults,
  AgentContinuityRecallRankingDefaults,
  AgentContinuitySemanticRecallDefaults,
} from "../Continuity/AgentContinuityRecallDefaults.js";
import {
  readAgentSandboxDistributionContract,
  resolveAgentSandboxDistributionTarget,
} from "../Sandbox/AgentSandboxDistributionContract.js";
import { AgentPresetPromptBudgetDefaults } from "../Presets/AgentPresetPromptBudget.js";

const Mebibyte = 1024 * 1024;
const DefaultLargePayloadBytes = 64 * Mebibyte;
const DefaultModelProviderEndpoints = parseJsonText(
  fs.readFileSync(path.join(moduleDirPath(import.meta.url), "AgentDefaultModelProviderEndpoints.json"), "utf8"),
  "Default model provider catalog",
) as ResolvedAgentModelProviderEndpointConfig[];
const DefaultSandboxRuntimeImage = resolveAgentSandboxDistributionTarget(
  readAgentSandboxDistributionContract(),
).registryImage;

export const AgentDefaults = {
  ModelProviderEndpoints: DefaultModelProviderEndpoints,
  ModelRuntime: {
    Kind: "OpenAICompatible",
    Endpoint: "ChatCompletions",
    Model: "mistral-large-latest",
    Capabilities: {
      Chat: true,
      Embedding: false,
      Rerank: false,
      Vision: false,
      ImageOutput: false,
      Reasoning: false,
      DeveloperRole: false,
      StreamingUsage: true,
      ToolCalling: true,
    },
    ToolPlanningMode: "native",
    ContextWindowTokens: 128_000,
    MaxModelOutputTokens: -1,
    Temperature: 0,
    MaxOutputTokens: -1,
    Stream: true,
    TimeoutSeconds: 480,
    FirstTokenTimeoutSeconds: 240,
    MaxRequestSeconds: -1,
    MaxNetworkRetries: 1,
    RetryBaseDelaySeconds: 0.25,
    RetryMaxDelaySeconds: 10,
    RetryAfterMaxDelaySeconds: 60,
    MaxResponseBytes: AgentModelResponseBudgetDefaults.maxResponseBytes,
    MaxSseEventBytes: AgentModelResponseBudgetDefaults.maxSseEventBytes,
    MaxSseEvents: AgentModelResponseBudgetDefaults.maxSseEvents,
  },
  InferenceBudget: {
    Enabled: true,
    WindowSeconds: 60,
    MaxRequests: 12,
    MaxEstimatedInputTokens: 120_000,
    MaxEstimatedOutputTokens: 24_000,
    MaxConcurrent: 2,
    ForegroundReserveFraction: 0.5,
    LaneWeights: {
      foreground: 100,
      goal: 4,
      autonomy: 2,
      resident: 1,
      continuity: 1,
      embedding: 1,
    },
  },
  ToolExecution: {
    TimeoutSeconds: 120,
    MaxConcurrentCallsPerRun: 10,
    MaxStdoutBytes: DefaultLargePayloadBytes,
    MaxStderrBytes: DefaultLargePayloadBytes,
    SemanticAudit: {
      Mode: AgentToolSemanticAuditModes.ApprovalSensitive,
    },
    Environment: {
      Inherit: "allowlist",
      IncludeOnly: [...SeneraDefaultProcessEnvironmentIncludeOnly],
      Exclude: [],
      Set: {},
    },
    Resources: {
      MaxActive: 8,
      MaxBufferedBytes: DefaultLargePayloadBytes,
      OutputBatchMaxBytes: 64 * 1024,
      OutputBatchMaxDelayMs: 50,
      MaxInputBytes: Mebibyte,
      InitialYieldSeconds: 1,
      MaxWaitSeconds: 30,
      IdleTtlSeconds: 1800,
      TerminalTtlSeconds: 300,
      SweepIntervalSeconds: 30,
      TerminationGraceSeconds: SeneraDefaultTerminationGraceMs / 1000,
    },
  },
  SandboxRuntime: {
    Enabled: true,
    Provider: "auto",
    BaseDir: ".senera/sandbox-runtime",
    Docker: {
      DetectionTimeoutSeconds: 3,
      PreparationTimeoutSeconds: 120,
      Image: DefaultSandboxRuntimeImage,
      PullPolicy: "if-missing",
    },
  },
  AgentLoop: {
    PiTurnLeaseTimeoutSeconds: 120,
    PiTurnLeaseTimeoutMs: 120000,
    RunSettlementTimeoutSeconds: 15,
    RunSettlementTimeoutMs: 15000,
    PiSessions: {
      RootDir: ".senera/pi-sessions",
      MaxCachedSessions: AgentPiSessionCacheDefaults.Capacity,
      Compaction: {
        Enabled: true,
      },
    },
  },
  ToolSearch: {
    Fuzzy: {
      Enabled: true,
      MinScore: 0.25,
      CandidateLimit: 8,
    },
    Embedding: {
      Enabled: false,
      ScoreThreshold: 0,
    },
    Memory: {
      MaxEpisodes: 5000,
      HalfLifeDays: 30,
    },
    Ranking: {
      RrfK: 60,
      MmrLambda: 0.72,
      MmrCandidateScoreRatio: 0.92,
      MinScore: 0,
      MaxResults: 6,
      MemoryExpansion: {
        Mode: AgentToolSearchMemoryExpansionModes.Fallback,
        MinConfidence: 0.8,
        MinEvidence: 3,
        MaxResults: 2,
      },
    },
    Rerank: {
      Enabled: false,
      CandidateLimit: 24,
      ScoreScale: 0.018,
      FeatureWeights: {},
    },
  },
  VectorModels: {
    Embedding: {
      Enabled: false,
      ProviderId: "openai",
      Model: "qwen3-embedding-0.6b",
      TimeoutSeconds: 20,
      MaxNetworkRetries: 1,
      Dimensions: -1,
      BatchSize: 64,
      InputMaxChars: -1,
    },
    Rerank: {
      Enabled: false,
      ProviderId: "openai",
      Model: "qwen3-reranker-0.6b",
      TimeoutSeconds: 20,
      MaxNetworkRetries: 1,
      EndpointPath: "/rerank",
      CandidateLimit: -1,
      TopK: -1,
    },
  },
  ToolLearning: {
    Enabled: true,
    MaxRepairAttempts: 1,
    Patterns: {
      MinSupport: 2,
      MaxPromptPatterns: 2,
    },
    Client: {
      Temperature: 0.1,
      MaxTokens: -1,
    },
  },
  Todos: {
    MaxItems: 256,
    MaxContentCharacters: 4_000,
    MaxResultCharacters: 512_000,
  },
  ContinuityLearning: {
    Enabled: true,
    Client: {
      Temperature: 0.1,
    },
    Runtime: {
      MaxAttempts: 3,
      RetryBaseDelaySeconds: 1,
      RetryMaxDelaySeconds: 60,
      MaxJobsPerDrain: 8,
    },
    LearningGate: {
      Enabled: true,
      DeferredDelaySeconds: 30,
    },
    LearningContext: {
      ReferentBudgetCharacters: 12_000,
      CatalogBudgetCharacters: 12_000,
      VerifiedExampleBudgetCharacters: 12_000,
    },
    TemporalMemory: {
      Enabled: true,
    },
    Recall: {
      TurnValueClassifier: {
        Enabled: true,
        ConfidenceThreshold: 0.82,
        MinimumExamplesPerLabel: 3,
        MaxTrainingEntries: 4096,
      },
      Prefetch: {
        Enabled: true,
        CacheTtlSeconds: 300,
      },
      PromptBudget: AgentContinuityPromptBudgetDefaults,
      Ranking: AgentContinuityRecallRankingDefaults,
      Semantic: AgentContinuitySemanticRecallDefaults,
    },
  },
  Presets: {
    Enabled: true,
    RootDir: ".senera/presets",
    StateFile: ".senera/presets-state.json",
    PromptBudget: AgentPresetPromptBudgetDefaults,
  },
  ActionPlanner: {
    Enabled: true,
    MaxRepairAttempts: 1,
    Evidence: {
      StalledStepLag: 2,
    },
    Client: {
      Temperature: 0.1,
      MaxTokens: -1,
    },
    PlanningClient: {
      Temperature: 0.1,
      MaxTokens: -1,
    },
    FinalAnswerClient: {
      Temperature: 0.1,
      MaxTokens: -1,
    },
  },
  Artifacts: {
    RootDir: ".senera/artifacts/runs",
    SummaryMaxChars: 2400,
    RawJsonMaxBytes: DefaultLargePayloadBytes,
    TextFileMaxBytes: DefaultLargePayloadBytes,
    MemoryReadMaxArtifacts: 16,
    MemoryReadMaxRefs: 8,
    MemoryReadMaxConcurrency: 4,
    // The active turn budget still caps each read. This ceiling lets artifact
    // projections use the same 64K-128K feedback range as system extensions.
    MemoryReadStructuredJsonMaxTokens: 128_000,
    OutputCaptureMaxBytes: DefaultLargePayloadBytes,
    MaxStoredBytes: 10 * 1024 * 1024 * 1024,
    MaxArtifacts: 10_000,
    RetentionHours: 720,
    IncompleteRetentionHours: 24,
    MaintenanceIntervalMinutes: 15,
    MaintenanceMaxConcurrency: 4,
  },
  Uploads: {
    RootDir: ".senera/uploads",
    MaxFileBytes: 52428800,
    MaxRequestBytes: 104857600,
    MaxFilesPerRequest: 8,
    MaxConcurrentUploads: 4,
    MaxStoredBytes: 2147483648,
    RetentionHours: 720,
    MaintenanceIntervalMinutes: 15,
  },
  Frontend: {
    DevServer: {
      Host: "127.0.0.1",
      Port: 5173,
      StrictPort: false,
    },
    PreviewServer: {
      Host: "127.0.0.1",
      Port: 4173,
      StrictPort: true,
    },
    Client: {
      WebSocketUrl: "",
      ModelLabel: "senera",
      UserName: "you",
      EmptySuggestions: ["整理今天的工作优先级", "分析一段错误日志", "把需求拆成可执行步骤"],
    },
  },
  Server: {
    Host: "127.0.0.1",
    Port: 8787,
    HotReload: true,
    RequestMaxBytes: DefaultLargePayloadBytes,
    AccessControl: {
      Mode: "auto",
      AccountFile: ".senera/access/admin-account.json",
      AllowedOrigins: [],
      TrustedProxyAddresses: [],
      AllowInsecureLoopback: false,
      AllowInsecureHttp: false,
      Session: {
        AbsoluteTtlHours: 72,
        IdleTtlHours: 12,
        MaxSessions: 8,
      },
      Limits: {
        MaxConnections: 64,
        MaxConnectionsPerClient: 8,
        MaxRateLimitClients: 4_096,
        UpgradeRequestsPerMinute: 30,
        HttpRequestsPerMinute: 60,
        MessagesPerMinute: 100,
        LoginAttemptsPerMinute: 5,
        HeartbeatIntervalSeconds: 30,
        IdleSocketTimeoutSeconds: 90,
      },
    },
  },
  Persistence: {
    Kind: "sqlite",
  },
  ConfigStore: {
    Enabled: true,
    Kind: "sqlite",
    MirrorJson: true,
    RevisionRetentionCount: 256,
    CommandReceiptRetentionHours: 168,
    CommandReceiptMaxCount: 4_096,
  },
  Prompt: {
    UserMessageEnvelope: true,
    TimeZone: "Asia/Shanghai",
    PrefaceRewrite: false,
    RoleCheck: true,
    BamlToolAttribution: true,
  },
  World: {
    Name: "Senera",
    TimeZone: "Asia/Shanghai",
    DayPhases: [
      { Id: "late_night", Label: "深夜", StartsAt: "00:00", EndsAt: "05:00" },
      { Id: "early_morning", Label: "清晨", StartsAt: "05:00", EndsAt: "08:00" },
      { Id: "morning", Label: "上午", StartsAt: "08:00", EndsAt: "12:00" },
      { Id: "afternoon", Label: "下午", StartsAt: "12:00", EndsAt: "18:00" },
      { Id: "evening", Label: "晚上", StartsAt: "18:00", EndsAt: "00:00" },
    ],
    RecordLimit: 128,
    TimelineLimit: 64,
    HabitCatchUpLimit: 256,
    GoalMicroLoop: {
      Enabled: true,
      MaxCandidates: 8,
      ReviewDelaySeconds: 900,
      AllowedToolNames: [],
    },
    ResidentIdle: {
      Enabled: true,
      MinIntervalSeconds: 900,
      MaxIntervalSeconds: 14_400,
      BackoffMultiplier: 2,
      MaxPending: 1,
    },
    ActionBudget: {
      MaxActionsPerWake: 8,
      MaxDecisionCandidatesPerWake: 8,
      RetryDelaySeconds: 30,
      LeaseDurationSeconds: 300,
      FairShare: true,
      SourceOrder: [],
      SourceCaps: {},
    },
  },
} as const satisfies Omit<ResolvedAgentDefaultsConfig, "ModelRuntime" | "ToolExecution" | "VectorModels"> & {
  ModelRuntime: AgentModelRuntimeDefaultsConfig;
  ToolExecution: Required<NonNullable<AgentDefaultsConfig["ToolExecution"]>>;
  SandboxRuntime: Required<NonNullable<AgentDefaultsConfig["SandboxRuntime"]>>;
  VectorModels: AgentVectorModelsDefaultsConfig;
};
