import { z } from "zod";
import { AgentMcpProtocol } from "./AgentMcpProtocol.js";

export const AgentMcpToolOutputNotificationSchema = z.object({
  method: z.literal(AgentMcpProtocol.toolOutputNotification),
  params: z.object({
    outputToken: z.string().min(1),
    stream: z.enum(["stdout", "stderr"]),
    text: z.string(),
    byteLength: z.number().int().nonnegative(),
  }),
});

export type AgentMcpToolOutput = z.output<typeof AgentMcpToolOutputNotificationSchema>["params"];
