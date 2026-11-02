import { z } from "zod";
import { AgentMemoryQualitySchema, AgentMemoryScoresSchema } from "./AgentMemoryRecallContract.js";
import { AgentToolModelOutputKeyword } from "../ToolContracts/AgentToolModelOutput.js";

/** The host result type and published tool schema are derived from this contract. */
export const AgentMemoryRecallToolResultSchema = z
  .object({
    query: z.string().optional(),
    range: z.object({ from: z.string(), to: z.string(), timeZone: z.string() }).strict().optional(),
    budget: z
      .object({
        maxTokens: z.number().int().nonnegative(),
        matchedRecords: z.number().int().nonnegative(),
        returnedRecords: z.number().int().nonnegative(),
      })
      .strict(),
    records: z
      .object({
        item: z
          .array(
            z
              .object({
                uri: z.string(),
                revision: z.string(),
                type: z.string(),
                content: z.string(),
                summary: z.string(),
                occurredAt: z.string(),
                score: z.number().finite(),
                quality: AgentMemoryQualitySchema.optional(),
                matchedBy: z.array(z.string()).readonly(),
                scores: AgentMemoryScoresSchema.optional(),
                period: z
                  .object({ granularity: z.enum(["day", "month"]), start: z.string(), end: z.string() })
                  .strict()
                  .optional(),
              })
              .strict(),
          )
          .readonly(),
      })
      .strict(),
  })
  .strict()
  .meta({
    [AgentToolModelOutputKeyword]: {
      omit: [
        "/query",
        "/budget/maxTokens",
        "/records/item/*/uri",
        "/records/item/*/revision",
        "/records/item/*/summary",
        "/records/item/*/score",
        "/records/item/*/quality",
        "/records/item/*/matchedBy",
        "/records/item/*/scores",
      ],
    },
  });

export const AgentMemoryRecallToolResultJsonSchema = z.toJSONSchema(AgentMemoryRecallToolResultSchema, {
  target: "draft-7",
});

export type AgentMemoryRecallToolResult = z.infer<typeof AgentMemoryRecallToolResultSchema>;
