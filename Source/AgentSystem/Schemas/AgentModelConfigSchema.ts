import { z } from "zod";
import { disabledOrPositiveInteger, disabledOrPositiveNumber } from "./AgentConfigSchemaPrimitives.js";
import { AgentModelEndpointKinds } from "../ModelEndpoints/AgentModelEndpointContract.js";

export const ModelEndpointSchema = z.enum(AgentModelEndpointKinds);

export const ModelCapabilitiesSchema = z
  .object({
    Chat: z.boolean().optional(),
    Embedding: z.boolean().optional(),
    Rerank: z.boolean().optional(),
    Vision: z.boolean().optional(),
    ImageOutput: z.boolean().optional(),
    Reasoning: z.boolean().optional(),
    DeveloperRole: z.boolean().optional(),
    StreamingUsage: z.boolean().optional(),
  })
  .strict();

export const ModelProviderSchema = z
  .object({
    Id: z.string().min(1),
    ProviderId: z.string().min(1),
    Icon: z.string().min(1).optional(),
    Capabilities: ModelCapabilitiesSchema.optional(),
    ContextWindowTokens: disabledOrPositiveInteger("ContextWindowTokens").optional(),
    MaxModelOutputTokens: disabledOrPositiveInteger("MaxModelOutputTokens").optional(),
    Endpoint: ModelEndpointSchema,
    Model: z.string().min(1),
    Temperature: z.number().min(0).max(2).optional(),
    MaxOutputTokens: disabledOrPositiveInteger("MaxOutputTokens").optional(),
    Stream: z.boolean().optional(),
    TimeoutSeconds: z.number().positive().optional(),
    FirstTokenTimeoutSeconds: disabledOrPositiveNumber("FirstTokenTimeoutSeconds").optional(),
    MaxRequestSeconds: disabledOrPositiveNumber("MaxRequestSeconds").optional(),
    MaxNetworkRetries: z.number().int().min(0).optional(),
    RetryBaseDelaySeconds: z.number().positive().optional(),
    RetryMaxDelaySeconds: z.number().positive().optional(),
    RetryAfterMaxDelaySeconds: z.number().positive().optional(),
    MaxResponseBytes: z.number().int().positive().optional(),
    MaxSseEventBytes: z.number().int().positive().optional(),
    MaxSseEvents: z.number().int().positive().optional(),
  })
  .strict();

export const ModelProviderEndpointSchema = z
  .object({
    Id: z.string().min(1),
    Icon: z.string().min(1).optional(),
    Enabled: z.boolean().optional(),
    Kind: z.literal("OpenAICompatible").optional(),
    BaseUrl: z.string().url().optional(),
    ApiKey: z.string().min(1).optional(),
    ApiVersion: z.string().min(1).optional(),
    Headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const ModelGroupStrategySchema = z
  .object({
    Match: z.enum(["exact", "prefix", "suffix", "includes"]),
    Values: z.array(z.string().min(1)),
  })
  .strict();

export const ModelGroupSchema = z
  .object({
    Id: z.string().min(1),
    Label: z.string().min(1),
    Icon: z.string().min(1).optional(),
    Match: z.enum(["exact", "prefix", "suffix", "includes"]).optional(),
    Values: z.array(z.string().min(1)).optional(),
    Strategies: z.array(ModelGroupStrategySchema).optional(),
  })
  .strict();
