import { z } from "zod";

export const AgentCodemodeConfigurationSchema = z
  .object({
    memoryLimitMiB: z.number().int().positive().max(4096).default(128),
    maxConcurrentScripts: z.number().int().positive().default(2),
  })
  .strict();

export const AgentCodemodeResultSchema = z
  .object({
    status: z.enum(["completed", "failed"]),
    output: z.array(
      z.union([
        z.object({ type: z.literal("text"), text: z.string(), console: z.literal(true).optional() }).strict(),
        z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string() }).strict(),
      ]),
    ),
    value: z.json().optional(),
    calls: z.array(
      z
        .object({
          name: z.string(),
          status: z.enum(["ok", "error", "cancelled"]),
          durationMs: z.number().nonnegative(),
        })
        .strict(),
    ),
    durationMs: z.number().nonnegative(),
    error: z
      .object({
        kind: z.enum(["script", "timeout", "aborted", "sandbox"]),
        name: z.string().optional(),
        message: z.string(),
        stack: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
