import { z } from "zod";
import { AgentLoopSchema } from "./AgentRuntimeConfigSchema.js";

const AgentDelegationRuntimeProfileSchema = z
  .object({
    Mode: z.enum(["directModel", "agentLoop"]).optional(),
    ModelProviderId: z.string().min(1).optional(),
    AgentLoop: AgentLoopSchema.optional(),
  })
  .strict();

export const AgentDelegationSchema = z
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
