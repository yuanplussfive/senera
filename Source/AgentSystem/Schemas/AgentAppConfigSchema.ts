import { z } from "zod";

export const FrontendSchema = z
  .object({
    DevServer: z
      .object({
        Host: z.string().min(1).optional(),
        Port: z.number().int().min(1).max(65535).optional(),
        StrictPort: z.boolean().optional(),
      })
      .strict()
      .optional(),
    PreviewServer: z
      .object({
        Host: z.string().min(1).optional(),
        Port: z.number().int().min(1).max(65535).optional(),
        StrictPort: z.boolean().optional(),
      })
      .strict()
      .optional(),
    Client: z
      .object({
        WebSocketUrl: z.string().min(1).optional(),
        ModelLabel: z.string().min(1).optional(),
        UserName: z.string().min(1).optional(),
        EmptySuggestions: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
