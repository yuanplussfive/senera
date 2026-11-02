import { z } from "zod";

/** Versioned independently of semantic content, so reassessment never duplicates knowledge. */
export const AgentMemoryUtilityVersion = 2;
export const AgentMemoryUtilityOutcomeSchema = z.enum(["helpful", "unhelpful", "unused", "uncertain"]);
export type AgentMemoryUtilityOutcome = z.infer<typeof AgentMemoryUtilityOutcomeSchema>;
export const AgentMemoryUtilityAssessmentSchema = z
  .object({
    candidate: z.number().int().nonnegative(),
    usefulness: AgentMemoryUtilityOutcomeSchema,
    reason: z.string().trim().min(1),
  })
  .strict();
