import { z } from "zod";
import { disabledOrPositiveInteger } from "./AgentConfigSchemaPrimitives.js";
import { ActionPlannerClientSchema } from "./AgentPlannerConfigSchema.js";

export const ToolSearchSchema = z
  .object({
    Embedding: z
      .object({
        Enabled: z.boolean().optional(),
        ModelProviderId: z.string().min(1).optional(),
        Model: z.string().min(1).optional(),
        Dimensions: disabledOrPositiveInteger("ToolSearch.Embedding.Dimensions").optional(),
        BatchSize: z.number().int().min(1).optional(),
        InputMaxChars: disabledOrPositiveInteger("ToolSearch.Embedding.InputMaxChars").optional(),
        ScoreThreshold: z.number().min(-1).max(1).optional(),
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

const VectorModelHttpSchema = z
  .object({
    Enabled: z.boolean().optional(),
    ProviderId: z.string().min(1).optional(),
    Model: z.string().min(1).optional(),
    TimeoutSeconds: z.number().positive().optional(),
    MaxNetworkRetries: z.number().int().min(0).optional(),
  })
  .strict();

export const VectorModelsSchema = z
  .object({
    Embedding: VectorModelHttpSchema.extend({
      Dimensions: disabledOrPositiveInteger("VectorModels.Embedding.Dimensions").optional(),
      BatchSize: z.number().int().min(1).optional(),
      InputMaxChars: disabledOrPositiveInteger("VectorModels.Embedding.InputMaxChars").optional(),
    })
      .strict()
      .optional(),
    Rerank: VectorModelHttpSchema.extend({
      EndpointPath: z.string().min(1).optional(),
      CandidateLimit: z.number().int().min(1).optional(),
      TopK: z.number().int().min(1).optional(),
    })
      .strict()
      .optional(),
  })
  .strict();

export const ToolLearningSchema = z
  .object({
    Enabled: z.boolean().optional(),
    MaxRepairAttempts: z.number().int().min(0).optional(),
    Client: ActionPlannerClientSchema("ToolLearning.Client").optional(),
    Patterns: z
      .object({
        MinSupport: z.number().int().min(1).optional(),
        MaxPromptPatterns: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const MemoryLearningSchema = z
  .object({
    Promotion: z
      .object({
        MinSupport: z.number().int().min(1).optional(),
        MaxClusterSize: z.number().int().min(1).optional(),
        MinSimilarity: z.number().min(-1).max(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
