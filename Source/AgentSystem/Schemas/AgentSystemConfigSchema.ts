import { z } from "zod";
import { AgentCliConfigSchema } from "./AgentCliConfigSchema.js";

const disabledOrPositiveInteger = (fieldName: string) => z.number().int().refine((value) => value === -1 || value >= 1, {
  message: `${fieldName} 必须为 -1，或大于等于 1。`,
});

const ModelEndpointSchema = z.union([
  z.literal("Responses"),
  z.literal("ChatCompletions"),
  z.literal("ClaudeMessages"),
  z.literal("GoogleGenerateContent"),
]);

const ModelProviderSchema = z
  .object({
    Id: z.string().min(1),
    Title: z.string().min(1).optional(),
    Icon: z.string().min(1).optional(),
    Kind: z.literal("OpenAICompatible").optional(),
    Endpoint: ModelEndpointSchema,
    BaseUrl: z.string().url().optional(),
    ApiKey: z.string().min(1).optional(),
    ApiVersion: z.string().min(1).optional(),
    Model: z.string().min(1),
    Temperature: z.number().min(0).max(2).optional(),
    MaxOutputTokens: z.number().int().refine((value) => value === -1 || value >= 1, {
      message: "MaxOutputTokens 必须为 -1，或大于等于 1。",
    }).optional(),
    Stream: z.boolean().optional(),
    TimeoutMs: z.number().int().min(1).optional(),
    FirstTokenTimeoutMs: disabledOrPositiveInteger("FirstTokenTimeoutMs").optional(),
    MaxRequestMs: disabledOrPositiveInteger("MaxRequestMs").optional(),
    MaxNetworkRetries: z.number().int().min(0).optional(),
    Headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const ModelProviderDefaultsSchema = z
  .object({
    Kind: z.literal("OpenAICompatible").optional(),
    BaseUrl: z.string().url().optional(),
    ApiKey: z.string().min(1).optional(),
    ApiVersion: z.string().min(1).optional(),
    Temperature: z.number().min(0).max(2).optional(),
    MaxOutputTokens: z.number().int().refine((value) => value === -1 || value >= 1, {
      message: "ModelProviderDefaults.MaxOutputTokens 必须为 -1，或大于等于 1。",
    }).optional(),
    Stream: z.boolean().optional(),
    TimeoutMs: z.number().int().min(1).optional(),
    FirstTokenTimeoutMs: disabledOrPositiveInteger("ModelProviderDefaults.FirstTokenTimeoutMs").optional(),
    MaxRequestMs: disabledOrPositiveInteger("ModelProviderDefaults.MaxRequestMs").optional(),
    MaxNetworkRetries: z.number().int().min(0).optional(),
    Headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const ModelProviderRuntimeDefaultsSchema = ModelProviderDefaultsSchema.extend({
  Id: z.string().min(1).optional(),
  Title: z.string().min(1).optional(),
  Icon: z.string().min(1).optional(),
  Endpoint: ModelEndpointSchema.optional(),
  Model: z.string().min(1).optional(),
}).strict();

const LoadedToolsSchema = z.union([
  z.literal("all"),
  z.literal("dynamic"),
  z.array(z.string().min(1)),
]);

const AgentLoopSchema = z
  .object({
    MaxSteps: z.number().int().refine((value) => value === -1 || value >= 1, {
      message: "AgentLoop.MaxSteps 必须是 -1 或大于等于 1 的整数。",
    }).optional(),
    MaxRepairAttempts: z.number().int().min(0).optional(),
    LoadedTools: LoadedToolsSchema.optional(),
  })
  .strict();

const AgentDelegationRuntimeProfileSchema = z
  .object({
    Mode: z.enum(["directModel", "agentLoop"]).optional(),
    ModelProviderId: z.string().min(1).optional(),
    AgentLoop: AgentLoopSchema.optional(),
  })
  .strict();

const AgentDelegationSchema = z
  .object({
    RuntimeProfileDefaults: AgentDelegationRuntimeProfileSchema.optional(),
    RuntimeProfiles: z.record(z.string(), AgentDelegationRuntimeProfileSchema).optional(),
    Templates: z
      .object({
        ChildSystemPrompt: z.string().min(1).optional(),
        MergeSystemPrompt: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    Merge: z
      .object({
        ModelProviderId: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const ToolSearchSchema = z
  .object({
    Dynamic: z
      .object({
        BootstrapTools: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    Memory: z
      .object({
        Kind: z.union([z.literal("sqlite"), z.literal("memory")]).optional(),
        DatabasePath: z.string().min(1).optional(),
        MaxEpisodes: z.number().int().min(1).optional(),
        HalfLifeDays: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    Ranking: z
      .object({
        RrfK: z.number().positive().optional(),
        MmrLambda: z.number().min(0).max(1).optional(),
        MmrCandidateScoreRatio: z.number().min(0).max(1).optional(),
        MinScore: z.number().min(0).optional(),
      })
      .strict()
      .optional(),
    Rerank: z
      .object({
        Enabled: z.boolean().optional(),
        CandidateLimit: z.number().int().min(1).optional(),
        ScoreScale: z.number().min(0).optional(),
        FeatureWeights: z.record(z.string(), z.number()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const ActionPlannerClientSchema = (path: string) => z
  .object({
    ModelProviderId: z.string().min(1).optional(),
    Provider: z.enum([
      "auto",
      "openai-generic",
      "openai-responses",
      "anthropic",
      "google-ai",
    ]).optional(),
    BaseUrl: z.string().url().optional(),
    ApiKey: z.string().min(1).optional(),
    Model: z.string().min(1).optional(),
    Temperature: z.number().min(0).max(2).optional(),
    MaxTokens: disabledOrPositiveInteger(`${path}.MaxTokens`).optional(),
  })
  .strict();

const ActionPlannerSchema = z
  .object({
    Enabled: z.boolean().optional(),
    MaxRepairAttempts: z.number().int().min(0).optional(),
    Evidence: z
      .object({
        StalledStepLag: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
    Client: ActionPlannerClientSchema("ActionPlanner.Client").optional(),
    TaskFrameClient: ActionPlannerClientSchema("ActionPlanner.TaskFrameClient").optional(),
    EvidenceClient: ActionPlannerClientSchema("ActionPlanner.EvidenceClient").optional(),
  })
  .strict();

const ArtifactsSchema = z
  .object({
    RootDir: z.string().min(1).optional(),
    SummaryMaxChars: z.number().int().min(256).optional(),
    RawJsonMaxBytes: z.number().int().min(1024).optional(),
    TextFileMaxBytes: z.number().int().min(1024).optional(),
  })
  .strict();

const UploadsSchema = z
  .object({
    RootDir: z.string().min(1).optional(),
    MaxFileBytes: z.number().int().min(1).optional(),
  })
  .strict();

const FrontendSchema = z
  .object({
    DevServer: z
      .object({
        Host: z.string().min(1).optional(),
        Port: z.number().int().min(1).max(65535).optional(),
        StrictPort: z.boolean().optional(),
      })
      .strict()
      .optional(),
    PreviewServer: z
      .object({
        Host: z.string().min(1).optional(),
        Port: z.number().int().min(1).max(65535).optional(),
        StrictPort: z.boolean().optional(),
      })
      .strict()
      .optional(),
    Client: z
      .object({
        WebSocketUrl: z.string().min(1).optional(),
        ModelLabel: z.string().min(1).optional(),
        UserName: z.string().min(1).optional(),
        EmptySuggestions: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const AgentDefaultsSchema = z
  .object({
    PluginRoots: z
      .object({
        System: z.array(z.string().min(1)).optional(),
        User: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    PluginDiscovery: z
      .object({
        ManifestFileName: z.string().min(1).optional(),
        ConfigFileName: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    ModelProviderDefaults: ModelProviderRuntimeDefaultsSchema.optional(),
    Cli: AgentCliConfigSchema.optional(),
    ToolExecution: z
      .object({
        Mode: z.literal("Process").optional(),
        TimeoutMs: z.number().int().min(1).optional(),
        MaxStdoutBytes: z.number().int().min(1).optional(),
        MaxStderrBytes: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
    AgentLoop: AgentLoopSchema.optional(),
    AgentDelegation: AgentDelegationSchema.optional(),
    ToolSearch: ToolSearchSchema.optional(),
    Artifacts: ArtifactsSchema.optional(),
    Uploads: UploadsSchema.optional(),
    ActionPlanner: ActionPlannerSchema.optional(),
    Frontend: FrontendSchema.optional(),
    Server: z
      .object({
        Host: z.string().min(1).optional(),
        Port: z.number().int().min(1).max(65535).optional(),
        HotReload: z.boolean().optional(),
        RequestMaxBytes: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
    Persistence: z
      .object({
        Kind: z.union([z.literal("sqlite"), z.literal("memory")]).optional(),
        DatabasePath: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const AgentSystemConfigSchema = z
  .object({
    Defaults: AgentDefaultsSchema.optional(),
    PluginRoots: z
      .object({
        System: z.array(z.string().min(1)).optional(),
        User: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    PluginDiscovery: z
      .object({
        ManifestFileName: z.string().min(1).optional(),
        ConfigFileName: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    XmlProtocol: z
      .object({
        MaxDepth: z.number().int().min(1).optional(),
        MaxTextLength: z.number().int().min(1).optional(),
        MaxDecisionTokens: z.number().int().min(1).optional(),
        MaxToolCalls: z.number().int().min(1).optional(),
        ArrayElementNames: z.array(z.string().min(1)).optional(),
        ArrayElementNameSuffix: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    ToolExecution: z
      .object({
        Mode: z.literal("Process").optional(),
        TimeoutMs: z.number().int().min(1).optional(),
        MaxStdoutBytes: z.number().int().min(1).optional(),
        MaxStderrBytes: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
    PluginDocumentation: z
      .object({
        Markdown: z
          .object({
            MinNonEmptyLines: z.number().int().min(1),
            ExcludePathFragments: z.array(z.string().min(1)),
          })
          .strict()
          .optional(),
        ToolDescription: z
          .object({
            MinNonEmptyLines: z.number().int().min(1),
            SummarySection: z.string().min(1),
            TriggerSection: z.string().min(1),
            AvoidSection: z.string().min(1),
            RequiredSections: z.array(z.string().min(1)),
          })
          .strict(),
        DecisionActionDescription: z
          .object({
            MinNonEmptyLines: z.number().int().min(1),
            SummarySection: z.string().min(1),
            TriggerSection: z.string().min(1),
            AvoidSection: z.string().min(1),
            RequiredSections: z.array(z.string().min(1)),
          })
          .strict()
          .optional(),
        PromptXml: z
          .object({
            XmlFenceLanguages: z.array(z.string().min(1)).optional(),
            CodeFenceLanguages: z.array(z.string().min(1)).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    DefaultModelProviderId: z.string().min(1).optional(),
    ModelProviderDefaults: ModelProviderDefaultsSchema.optional(),
    ModelProviders: z.array(ModelProviderSchema).min(1),
    Cli: AgentCliConfigSchema.optional(),
    AgentLoop: AgentLoopSchema.optional(),
    AgentDelegation: AgentDelegationSchema.optional(),
    ToolSearch: ToolSearchSchema.optional(),
    Artifacts: ArtifactsSchema.optional(),
    Uploads: UploadsSchema.optional(),
    ActionPlanner: ActionPlannerSchema.optional(),
    Frontend: FrontendSchema.optional(),
    Server: z
      .object({
        Host: z.string().min(1).optional(),
        Port: z.number().int().min(1).max(65535).optional(),
        HotReload: z.boolean().optional(),
        RequestMaxBytes: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
    Persistence: z
      .object({
        Kind: z.union([z.literal("sqlite"), z.literal("memory")]).optional(),
        DatabasePath: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
