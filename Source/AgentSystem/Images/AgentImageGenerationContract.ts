import { z } from "zod";
import { AgentImageGenerationApis } from "../Core/AgentModelCapabilityContract.js";
import { AgentResourceSourceSchema, AgentLocalResourceSourceSchema } from "../Resources/AgentResourceSource.js";
export { AgentImageGenerationApis } from "../Core/AgentModelCapabilityContract.js";

/** Explicit wire protocols; neither provider names nor model names select an adapter. */
export const AgentImageGenerationConfigurationSchema = z
  .object({
    Api: z.enum(AgentImageGenerationApis),
    Editing: z.boolean().optional(),
    Mask: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.Mask && (!value.Editing || value.Api !== "openai-images")) {
      context.addIssue({
        code: "custom",
        path: ["Mask"],
        message: "Mask requires Editing and the openai-images protocol.",
      });
    }
  });

export type AgentImageGenerationConfiguration = z.output<typeof AgentImageGenerationConfigurationSchema>;

export const AgentImageGenerationOptionsSchema = z
  .object({
    aspectRatio: z.string().trim().min(1).optional(),
    imageSize: z.string().trim().min(1).optional(),
    size: z.string().trim().min(1).optional(),
    quality: z.string().trim().min(1).optional(),
    n: z.number().int().positive().optional(),
    outputFormat: z.enum(["png", "jpeg", "webp"]).optional(),
    outputCompression: z.number().int().min(0).max(100).optional(),
    background: z.enum(["auto", "opaque", "transparent"]).optional(),
    moderation: z.enum(["auto", "low"]).optional(),
  })
  .strict();

export type AgentImageGenerationOptions = z.output<typeof AgentImageGenerationOptionsSchema>;

export const AgentImageGenerateArgumentsSchema = z
  .object({
    prompt: z.string().trim().min(1),
    model: z.string().trim().min(1).optional(),
    images: z.array(AgentResourceSourceSchema).min(1).optional(),
    mask: AgentLocalResourceSourceSchema.optional(),
    options: AgentImageGenerationOptionsSchema.optional(),
  })
  .strict();

export const AgentImageGenerateResultSchema = z
  .object({
    model: z.string(),
    images: z
      .array(
        z
          .object({
            source: AgentLocalResourceSourceSchema,
            name: z.string(),
            mime: z.string(),
            size: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1),
    text: z.string().optional(),
  })
  .strict();

export const AgentImageModelsResultSchema = z
  .object({
    models: z.array(
      z
        .object({
          id: z.string(),
          model: z.string(),
          api: z.enum(AgentImageGenerationApis),
          editing: z.boolean(),
          mask: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
