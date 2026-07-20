import { z } from "zod";
import { ToolOutputNotificationMethod } from "@senera/tool-plugin-sdk/protocol";

export const AgentMcpToolOutputNotificationSchema = z.object({
  method: z.literal(ToolOutputNotificationMethod),
  params: z.object({
    outputToken: z.string().min(1),
    stream: z.enum(["stdout", "stderr"]),
    text: z.string(),
    byteLength: z.number().int().nonnegative(),
  }),
});

export type AgentMcpToolOutput = z.output<typeof AgentMcpToolOutputNotificationSchema>["params"];
