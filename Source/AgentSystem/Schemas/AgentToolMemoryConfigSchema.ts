import { z } from "zod";
import { AgentToolSearchChannelWeightKeys } from "../Types/AgentToolAndMemoryConfigTypes.js";

export const ToolSearchSchema = z
  .object({
    Fuzzy: z
      .object({
        Enabled: z.boolean().optional(),
        MinScore: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
    Embedding: z
      .object({
        Enabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
    Tokenize: z
      .object({
        Stopwords: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    Memory: z
      .object({
        MaxEpisodes: z.number().int().min(1).optional(),
        HalfLifeDays: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    Ranking: z
      .object({
        RrfK: z.number().positive().optional(),
        ChannelWeights: z.record(z.enum(AgentToolSearchChannelWeightKeys), z.number().min(0)).optional(),
      })
      .strict()
      .optional(),
    Disclosure: z
      .object({
        TokenBudget: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    Rerank: z
      .object({
        Enabled: z.boolean().optional(),
        ScoreScale: z.number().min(0).optional(),
        FeatureWeights: z.record(z.string(), z.number()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const StateCardSchema = z
  .object({
    Enabled: z.boolean().optional(),
    Client: z
      .object({
        ModelProviderId: z.string().min(1).optional(),
        Temperature: z.number().min(0).max(2).optional(),
      })
      .strict()
      .optional(),
    HistoryBudgetCharacters: z.number().int().positive().optional(),
  })
  .strict();

export const ContinuityLearningSchema = z
  .object({
    Enabled: z.boolean().optional(),
    Client: z
      .object({
        ModelProviderId: z.string().min(1).optional(),
        Temperature: z.number().min(0).max(2).optional(),
      })
      .strict()
      .optional(),
    Runtime: z
      .object({
        MaxAttempts: z.number().int().positive().optional(),
        RetryBaseDelaySeconds: z.number().positive().optional(),
        RetryMaxDelaySeconds: z.number().positive().optional(),
        MaxJobsPerDrain: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    MemOS: z
      .object({
        AutoLinkThreshold: z.number().min(0).max(1).optional(),
        RecallDedupeThreshold: z.number().min(0).max(1).optional(),
        RecallDedupeMaxPairs: z.number().int().positive().optional(),
        FragmentHistoryTurns: z.number().int().positive().optional(),
        KnowledgeCandidateLimit: z.number().int().positive().optional(),
        AssistantPreviewTokens: z.number().int().positive().optional(),
        DigestInputTokenBudget: z.number().int().positive().optional(),
        DigestSummaryTokenLimit: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    Recall: z
      .object({
        PromptBudget: z
          .object({
            MaxTokens: z.number().int().positive().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
