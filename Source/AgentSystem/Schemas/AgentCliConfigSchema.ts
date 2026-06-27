import { z } from "zod";

export const AgentCliConfigSchema = z
  .object({
    Connection: z
      .object({
        Url: z.string().min(1).optional(),
        SessionId: z.string().min(1).optional(),
        TimeoutSeconds: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    Display: z
      .object({
        EventDisplayMode: z.enum(["activity", "compact", "verbose"]).optional(),
        DetailMode: z.enum(["none", "errors", "tools", "xml", "all"]).optional(),
        ShowXml: z.boolean().optional(),
        StreamXml: z.boolean().optional(),
        LivePreview: z.boolean().optional(),
        PreviewMode: z.enum(["block", "line"]).optional(),
        PreviewTokenLimit: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
