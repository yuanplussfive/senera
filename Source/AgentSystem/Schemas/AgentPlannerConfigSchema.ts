import { z } from "zod";
import { disabledOrPositiveInteger } from "./AgentConfigSchemaPrimitives.js";

export const ActionPlannerClientSchema = (path: string) =>
  z
    .object({
      ModelProviderId: z.string().min(1).optional(),
      Temperature: z.number().min(0).max(2).optional(),
      MaxTokens: disabledOrPositiveInteger(`${path}.MaxTokens`).optional(),
    })
    .strict();

export const ActionPlannerSchema = z
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
    PlanningClient: ActionPlannerClientSchema("ActionPlanner.PlanningClient").optional(),
    FinalAnswerClient: ActionPlannerClientSchema("ActionPlanner.FinalAnswerClient").optional(),
  })
  .strict();
