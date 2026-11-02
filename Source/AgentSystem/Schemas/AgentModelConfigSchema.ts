import { z } from "zod";
import { disabledOrPositiveInteger, disabledOrPositiveNumber } from "./AgentConfigSchemaPrimitives.js";
import { AgentModelEndpointKinds, AgentModelToolPlanningModes } from "../ModelEndpoints/AgentModelEndpointContract.js";
import { AgentModelThinkingLevels } from "../ModelEndpoints/AgentModelThinking.js";
import { AgentModelCapabilityKeys, type AgentModelCapabilityKey } from "../Core/AgentModelCapabilityContract.js";
import { AgentImageGenerationConfigurationSchema } from "../Images/AgentImageGenerationContract.js";
import {
  AgentPortableStaticVisionInputMimeTypes,
  normalizeAgentImageMime,
} from "../Images/AgentImageNormalizationService.js";

const ThinkingLevelSchema = z.enum(AgentModelThinkingLevels);
const ThinkingProfileSchema = z.object({
  Id: z.string().trim().min(1),
  Label: z.string().trim().min(1),
  Level: ThinkingLevelSchema,
});

export const ModelEndpointSchema = z.enum(AgentModelEndpointKinds);

export const ModelVisionInputSchema = z
  .object({
    /** Omit to inherit the product's portable static image contract. */
    SupportedMimeTypes: z
      .array(
        z
          .string()
          .trim()
          .regex(/^image\/[a-z0-9.+-]+$/u),
      )
      .min(1)
      .optional(),
    /** Explicit opt-in for animated variants of accepted image MIME types. */
    SupportedAnimatedMimeTypes: z
      .array(
        z
          .string()
          .trim()
          .regex(/^image\/[a-z0-9.+-]+$/u),
      )
      .min(1)
      .optional(),
    MaxBytes: z.number().int().positive().optional(),
    MaxPixels: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.SupportedAnimatedMimeTypes) return;
    const staticOrDeclaredMimeTypes = value.SupportedMimeTypes ?? AgentPortableStaticVisionInputMimeTypes;
    const acceptedMimeTypes = new Set(
      staticOrDeclaredMimeTypes.map(normalizeAgentImageMime).filter((mime): mime is string => Boolean(mime)),
    );
    value.SupportedAnimatedMimeTypes.forEach((mime, index) => {
      const normalized = normalizeAgentImageMime(mime);
      if (normalized && acceptedMimeTypes.has(normalized)) return;
      context.addIssue({
        code: "custom",
        path: ["SupportedAnimatedMimeTypes", index],
        message:
          "Animated image MIME types must also appear in SupportedMimeTypes or the shared static image contract.",
      });
    });
  });

export const ModelCapabilitiesSchema = z
  .object({
    ...(Object.fromEntries(AgentModelCapabilityKeys.map((key) => [key, z.boolean().optional()])) as Record<
      AgentModelCapabilityKey,
      z.ZodOptional<z.ZodBoolean>
    >),
    VisionInput: ModelVisionInputSchema.optional(),
  })
  .strict();

export const ModelProviderSchema = z
  .object({
    ImageGeneration: AgentImageGenerationConfigurationSchema.optional(),
    Pricing: z
      .object({
        input: z.number().nonnegative().optional(),
        output: z.number().nonnegative().optional(),
        cacheRead: z.number().nonnegative().optional(),
        cacheWrite: z.number().nonnegative().optional(),
      })
      .strict()
      .optional(),
    Id: z.string().min(1),
    ProviderId: z.string().min(1),
    Icon: z.string().min(1).optional(),
    Capabilities: ModelCapabilitiesSchema.optional(),
    ThinkingProfiles: z.array(ThinkingProfileSchema).optional(),
    DefaultThinkingLevel: ThinkingLevelSchema.optional(),
    ToolPlanningMode: z.enum(AgentModelToolPlanningModes).optional(),
    ContextWindowTokens: z.number().int().positive().optional(),
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
    DefaultEndpoint: ModelEndpointSchema.optional(),
    BaseUrl: z.string().url().optional(),
    ApiKey: z.string().min(1).optional(),
    ApiVersion: z.string().min(1).optional(),
    Headers: z.record(z.string(), z.string()).optional(),
    ProviderId: z.string().min(1).optional(),
    Priority: z.number().int().min(0).optional(),
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
