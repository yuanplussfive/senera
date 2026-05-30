import { z } from "zod";

const disabledOrPositiveInteger = (fieldName: string) => z.number().int().refine((value) => value === -1 || value >= 1, {
  message: `${fieldName} 必须为 -1，或大于等于 1。`,
});

const ModelProviderSchema = z
  .object({
    Id: z.string().min(1),
    Title: z.string().min(1).optional(),
    Icon: z.string().min(1).optional(),
    Kind: z.literal("OpenAICompatible"),
    Endpoint: z.union([
      z.literal("Responses"),
      z.literal("ChatCompletions"),
      z.literal("ClaudeMessages"),
      z.literal("GoogleGenerateContent"),
    ]),
    BaseUrl: z.string().url(),
    ApiKey: z.string().min(1),
    ApiVersion: z.string().min(1).optional(),
    Model: z.string().min(1),
    Temperature: z.number().min(0).max(2),
    MaxOutputTokens: z.number().int().refine((value) => value === -1 || value >= 1, {
      message: "MaxOutputTokens 必须为 -1，或大于等于 1。",
    }),
    Stream: z.boolean(),
    TimeoutMs: z.number().int().min(1),
    FirstTokenTimeoutMs: disabledOrPositiveInteger("FirstTokenTimeoutMs").optional(),
    MaxRequestMs: disabledOrPositiveInteger("MaxRequestMs").optional(),
    MaxNetworkRetries: z.number().int().min(0),
    Headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const LoadedToolsSchema = z.union([
  z.literal("all"),
  z.literal("dynamic"),
  z.array(z.string().min(1)),
]);

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
        MinScore: z.number().min(0).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const ActionPlannerSchema = z
  .object({
    Enabled: z.boolean().optional(),
    MaxRepairAttempts: z.number().int().min(0).optional(),
    MaxCatalogTools: z.number().int().min(1).optional(),
    RecentContextChars: z.number().int().min(0).optional(),
    ContextBudget: z
      .object({
        MaxRecentDeltas: z.number().int().min(0).optional(),
        MaxStateCalls: z.number().int().min(0).optional(),
        MaxEvidence: z.number().int().min(0).optional(),
        MaxPreviewChars: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
    Client: z
      .object({
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
        MaxTokens: disabledOrPositiveInteger("ActionPlanner.Client.MaxTokens").optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const AgentSystemConfigSchema = z
  .object({
    PluginRoots: z
      .object({
        System: z.array(z.string().min(1)),
        User: z.array(z.string().min(1)),
      })
      .strict(),
    PluginDiscovery: z
      .object({
        ManifestFileName: z.string().min(1),
      })
      .strict(),
    XmlProtocol: z
      .object({
        MaxDepth: z.number().int().min(1),
        MaxTextLength: z.number().int().min(1).optional(),
        MaxDecisionTokens: z.number().int().min(1).optional(),
        MaxToolCalls: z.number().int().min(1),
        ArrayElementNames: z.array(z.string().min(1)).optional(),
        ArrayElementNameSuffix: z.string().min(1).optional(),
      })
      .strict(),
    ToolExecution: z
      .object({
        Mode: z.literal("Process"),
        TimeoutMs: z.number().int().min(1),
        MaxStdoutBytes: z.number().int().min(1),
        MaxStderrBytes: z.number().int().min(1),
      })
      .strict(),
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
    ModelProviders: z.array(ModelProviderSchema).min(1),
    AgentLoop: z
      .object({
        MaxSteps: z.number().int().refine((value) => value === -1 || value >= 1, {
          message: "MaxSteps 必须是 -1 或大于等于 1 的整数。",
        }),
        MaxRepairAttempts: z.number().int().min(0),
        LoadedTools: LoadedToolsSchema,
      })
      .strict()
      .optional(),
    ToolSearch: ToolSearchSchema.optional(),
    ActionPlanner: ActionPlannerSchema.optional(),
    Server: z
      .object({
        Host: z.string().min(1),
        Port: z.number().int().min(1).max(65535),
        HotReload: z.boolean(),
        RequestMaxBytes: z.number().int().min(1),
      })
      .strict()
      .optional(),
    Persistence: z
      .object({
        Kind: z.union([z.literal("sqlite"), z.literal("memory")]),
        DatabasePath: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
