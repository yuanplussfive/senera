import fs from "node:fs";
import path from "node:path";
import type { AgentDefaultsConfig, ResolvedAgentModelProviderEndpointConfig } from "../Types/AgentConfigTypes.js";
import type { AgentModelRuntimeDefaultsConfig, ResolvedAgentDefaultsConfig } from "./AgentDefaultValueTypes.js";
import { moduleDirPath } from "../Core/AgentPath.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import { SeneraDefaultTerminationGraceMs } from "../Execution/SeneraTerminationPolicy.js";
import { AgentPiSessionCacheDefaults } from "../Pi/AgentPiSessionCachePolicy.js";
import { AgentModelResponseBudgetDefaults } from "../ModelEndpoints/ModelResponseBudget.js";
import { SeneraDefaultProcessEnvironmentIncludeOnly } from "../Execution/SeneraProcessEnvironment.js";
import { AgentToolSemanticAuditModes } from "../Types/AgentRuntimeConfigTypes.js";
import { AgentContinuityPromptBudgetDefaults } from "../Continuity/AgentContinuityRecallDefaults.js";
import {
  readAgentSandboxDistributionContract,
  resolveAgentSandboxDistributionTarget,
} from "../Sandbox/AgentSandboxDistributionContract.js";

const Mebibyte = 1024 * 1024;
const DefaultLargePayloadBytes = 64 * Mebibyte;
const DefaultToolObservationMaxTokens = 16_384;
const DefaultWorkspaceObserverIdleTtlMs = 30_000;
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
      continuity: 1,
      compaction: 1,
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
    },
    Embedding: {
      Enabled: true,
    },
    Tokenize: {
      Stopwords: [
        "a",
        "an",
        "the",
        "and",
        "or",
        "but",
        "of",
        "to",
        "in",
        "on",
        "at",
        "for",
        "with",
        "by",
        "from",
        "as",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "it",
        "its",
        "this",
        "that",
        "these",
        "those",
        "do",
        "does",
        "did",
        "have",
        "has",
        "had",
        "will",
        "would",
        "can",
        "could",
        "should",
        "may",
        "might",
        "must",
        "not",
        "so",
        "if",
        "then",
        "than",
        "too",
        "very",
        "just",
        "also",
        "about",
        "into",
        "over",
        "under",
        "again",
        "more",
        "most",
        "other",
        "some",
        "such",
        "only",
        "own",
        "same",
      ],
    },
    Memory: {
      MaxEpisodes: 5000,
      HalfLifeDays: 30,
    },
    Ranking: {
      RrfK: 30,
      ChannelWeights: {
        bm25: 1,
        exact: 0.9,
        example: 1.1,
        fuzzy: 0.7,
        semantic: 0.5,
        structural: 1,
        memory: 0.6,
      },
    },
    Disclosure: {
      TokenBudget: 640,
    },
    Rerank: {
      // Reranking is a deterministic comparison over the fused candidate set.
      // It does not invoke a model or network service,
      // and lets declared actions, targets, and resource syntax disambiguate
      // generic lexical matches before they reach the agent.
      Enabled: true,
      ScoreScale: 0.018,
      FeatureWeights: {},
    },
  },
  StateCard: {
    Enabled: true,
    HistoryBudgetCharacters: 4_000,
    Client: {
      Temperature: 0.1,
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
    MemOS: {
      AutoLinkThreshold: 0.75,
      RecallDedupeThreshold: 0.92,
      RecallDedupeMaxPairs: 10_000,
      FragmentHistoryTurns: 6,
      KnowledgeCandidateLimit: 8,
      AssistantPreviewTokens: 256,
      DigestInputTokenBudget: 8_192,
      DigestSummaryCharacterLimit: 50,
    },
    Recall: {
      PromptBudget: AgentContinuityPromptBudgetDefaults,
    },
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
    // Shared hard ceiling for one model-facing tool observation. Pi's active
    // turn reservation may impose a smaller limit for the current call.
    ToolObservationMaxTokens: DefaultToolObservationMaxTokens,
    RawJsonMaxBytes: DefaultLargePayloadBytes,
    TextFileMaxBytes: DefaultLargePayloadBytes,
    WorkspaceObserverMemoryMaxBytes: 67_108_864,
    WorkspaceObserverSettleMs: 80,
    WorkspaceObserverIdleTtlMs: DefaultWorkspaceObserverIdleTtlMs,
    WorkspaceObserverIgnoredPaths: [".git", ".agents", ".claude", ".codex"],
    WorkspacePatchContextLines: 3,
    MemoryReadMaxArtifacts: 16,
    MemoryReadMaxConcurrency: 4,
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
    EventWriter: {
      RestartDelayMs: 250,
      CloseTimeoutMs: 5_000,
      DrainBatchSize: 256,
      CommittedRetentionMs: 7 * 24 * 60 * 60 * 1_000,
    },
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
    CorePersona: "",
    LanguageStyle: "",
    PrefaceRewrite: false,
    FinalResponseRewrite: false,
    BamlToolAttribution: true,
  },
} as const satisfies Omit<ResolvedAgentDefaultsConfig, "ModelRuntime" | "ToolExecution"> & {
  ModelRuntime: AgentModelRuntimeDefaultsConfig;
  ToolExecution: Required<NonNullable<AgentDefaultsConfig["ToolExecution"]>>;
  SandboxRuntime: Required<NonNullable<AgentDefaultsConfig["SandboxRuntime"]>>;
};
