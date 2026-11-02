import { z } from "zod";
import { AgentExtensionLocalizedTextSchema } from "./AgentExtensionLocalization.js";

/** Settings-only documentation. Never merged into tool contracts or model context. */
export const AgentPluginUsageExamplesSchema = z
  .array(
    z
      .object({
        title: AgentExtensionLocalizedTextSchema,
        prompt: AgentExtensionLocalizedTextSchema,
        outcome: AgentExtensionLocalizedTextSchema,
      })
      .strict(),
  )
  .min(1)
  .max(6);

export type AgentPluginUsageExample = z.infer<typeof AgentPluginUsageExamplesSchema>[number];
