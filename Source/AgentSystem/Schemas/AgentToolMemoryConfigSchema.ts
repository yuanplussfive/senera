import { z } from "zod";
import { disabledOrPositiveInteger } from "./AgentConfigSchemaPrimitives.js";
import { ActionPlannerClientSchema } from "./AgentPlannerConfigSchema.js";
import { AgentToolSearchMemoryExpansionModes } from "../Types/AgentToolAndMemoryConfigTypes.js";

export const ToolSearchSchema = z
  .object({
    Fuzzy: z
      .object({
        Enabled: z.boolean().optional(),
        MinScore: z.number().min(0).max(1).optional(),
        CandidateLimit: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
    Embedding: z
      .object({
        Enabled: z.boolean().optional(),
        ScoreThreshold: z.number().min(-1).max(1).optional(),
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
        MmrLambda: z.number().min(0).max(1).optional(),
        MmrCandidateScoreRatio: z.number().min(0).max(1).optional(),
        MinScore: z.number().min(0).optional(),
        MaxResults: z.number().int().min(1).optional(),
        MemoryExpansion: z
          .object({
            Mode: z
              .enum([
                AgentToolSearchMemoryExpansionModes.Disabled,
                AgentToolSearchMemoryExpansionModes.Fallback,
                AgentToolSearchMemoryExpansionModes.Augment,
              ])
              .optional(),
            MinConfidence: z.number().min(0).max(1).optional(),
            MinEvidence: z.number().min(0).optional(),
            MaxResults: z.number().int().min(1).optional(),
          })
          .strict()
          .optional(),
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
      CandidateLimit: disabledOrPositiveInteger("VectorModels.Rerank.CandidateLimit").optional(),
      TopK: disabledOrPositiveInteger("VectorModels.Rerank.TopK").optional(),
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
    LearningGate: z
      .object({
        Enabled: z.boolean().optional(),
        DeferredDelaySeconds: z.number().nonnegative().optional(),
      })
      .strict()
      .optional(),
    LearningContext: z
      .object({
        ReferentBudgetCharacters: z.number().int().positive().optional(),
        CatalogBudgetCharacters: z.number().int().positive().optional(),
        VerifiedExampleBudgetCharacters: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    TemporalMemory: z
      .object({
        Enabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
    Recall: z
      .object({
        TurnValueClassifier: z
          .object({
            Enabled: z.boolean().optional(),
            ConfidenceThreshold: z.number().min(0).max(1).optional(),
            MinimumExamplesPerLabel: z.number().int().positive().optional(),
            MaxTrainingEntries: z.number().int().positive().optional(),
          })
          .strict()
          .optional(),
        Prefetch: z
          .object({
            Enabled: z.boolean().optional(),
            CacheTtlSeconds: z.number().positive().optional(),
          })
          .strict()
          .optional(),
        PromptBudget: z
          .object({
            MaxProfileEntries: z.number().int().positive().optional(),
            MaxFactEntries: z.number().int().positive().optional(),
            MaxRelationEntries: z.number().int().positive().optional(),
            MaxEventEntries: z.number().int().positive().optional(),
            MaxEvidenceEntries: z.number().int().positive().optional(),
            MaxCharacters: z.number().int().positive().optional(),
          })
          .strict()
          .optional(),
        Ranking: z
          .object({
            MinimumTextSimilarityScore: z.number().min(0).max(1).optional(),
            CandidateScore: z.number().min(0).max(1).optional(),
            DirectScore: z.number().min(0).max(1).optional(),
            DirectTextSimilarityScore: z.number().min(0).max(1).optional(),
            FactIdentityFuzzyScore: z.number().min(0).max(1).optional(),
            RecencyHalfLifeDays: z.number().positive().optional(),
            Weights: z
              .object({
                TextSimilarity: z.number().min(0).max(1).optional(),
                Lexical: z.number().min(0).max(1).optional(),
                Confidence: z.number().min(0).max(1).optional(),
                Authority: z.number().min(0).max(1).optional(),
                Scope: z.number().min(0).max(1).optional(),
                Recency: z.number().min(0).max(1).optional(),
                Semantic: z.number().min(0).max(1).optional(),
              })
              .strict()
              .optional(),
            NearMiss: z
              .object({
                MaxEntries: z.number().int().min(0).optional(),
                MinimumScore: z.number().min(0).max(1).optional(),
              })
              .strict()
              .optional(),
            Funnel: z
              .object({
                MinimumObservations: z.number().int().positive().optional(),
                MaxLexicalCandidates: z.number().int().positive().optional(),
              })
              .strict()
              .optional(),
            Graph: z
              .object({
                MaxHops: z.number().int().min(0).optional(),
              })
              .strict()
              .optional(),
            Lexical: z
              .object({
                SummaryBoost: z.number().positive().optional(),
                Prefix: z.boolean().optional(),
                Fuzzy: z.number().min(0).max(1).optional(),
                CombineWith: z.enum(["AND", "OR"]).optional(),
              })
              .strict()
              .optional(),
            Similarity: z
              .object({
                PhraseFloor: z.number().min(0).max(1).optional(),
                CoverageWeight: z.number().min(0).max(1).optional(),
                FuzzyWeight: z.number().min(0).max(1).optional(),
                CharacterWeight: z.number().min(0).max(1).optional(),
                StructuralMismatchWeight: z.number().min(0).max(1).optional(),
              })
              .strict()
              .optional(),
            Anchor: z
              .object({
                MinimumPhraseCharacters: z.number().int().positive().optional(),
                MinimumTokenLength: z.number().int().positive().optional(),
                MinimumQueryCoverage: z.number().min(0).max(1).optional(),
                MinimumLabelCoverage: z.number().min(0).max(1).optional(),
                MinimumInformativeTerms: z.number().int().positive().optional(),
              })
              .strict()
              .optional(),
            Evidence: z
              .object({
                MinimumRelatedScore: z.number().min(0).max(1).optional(),
                RelativeToBestScore: z.number().min(0).max(1).optional(),
                MinimumLifetimeMatchScore: z.number().min(0).max(1).optional(),
              })
              .strict()
              .optional(),
            Consolidation: z
              .object({
                MinimumEquivalentEffectScore: z.number().min(0).max(1).optional(),
                ActiveIndependentEvidence: z.number().int().positive().optional(),
                EstablishedIndependentEvidence: z.number().int().positive().optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
        Semantic: z
          .object({
            Enabled: z.boolean().optional(),
            TimeoutMs: z.number().int().positive().optional(),
            ScoreFloor: z.number().min(0).max(1).optional(),
            MinQueryCharacters: z.number().int().min(0).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
