import { z } from "zod";
import { AgentMcpProtocol } from "./AgentMcpProtocol.js";

const TaskEvents = AgentMcpProtocol.taskEvents;

const TaskOutputEventSchema = z.object({
  taskId: z.string().min(1),
  cursor: z.number().int().positive(),
  timestamp: z.string().datetime(),
  kind: z.literal("output"),
  output: z.object({
    stream: z.enum(["stdout", "stderr"]),
    text: z.string(),
    byteLength: z.number().int().nonnegative(),
  }),
});

const TaskProgressEventSchema = z.object({
  taskId: z.string().min(1),
  cursor: z.number().int().positive(),
  timestamp: z.string().datetime(),
  kind: z.literal("progress"),
  progress: z.object({
    completed: z.number().finite(),
    total: z.number().finite().optional(),
    message: z.string().optional(),
  }),
});

export const AgentMcpTaskEventSchema = z.discriminatedUnion("kind", [TaskOutputEventSchema, TaskProgressEventSchema]);

export const AgentMcpTaskEventNotificationSchema = z.object({
  method: z.literal(TaskEvents.notification),
  params: z.object({
    event: AgentMcpTaskEventSchema,
    outputToken: z.string().min(1).optional(),
    progressToken: z.string().min(1).optional(),
  }),
});

export const AgentMcpTaskEventsReadRequestSchema = z.object({
  method: z.literal(TaskEvents.read),
  params: z.object({
    taskId: z.string().min(1),
    afterCursor: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(TaskEvents.pageLimit).optional(),
  }),
});

export const AgentMcpTaskEventsReadResultSchema = z.object({
  events: z.array(AgentMcpTaskEventSchema).max(TaskEvents.pageLimit),
  nextCursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

export type AgentMcpTaskEvent = z.output<typeof AgentMcpTaskEventSchema>;

export function supportsAgentMcpTaskEvents(capabilities: unknown): boolean {
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return false;
  const experimental = Reflect.get(capabilities, "experimental");
  if (!experimental || typeof experimental !== "object" || Array.isArray(experimental)) return false;
  const capability = Reflect.get(experimental, TaskEvents.capability);
  return (
    capability !== null &&
    typeof capability === "object" &&
    !Array.isArray(capability) &&
    Reflect.get(capability, "version") === TaskEvents.version
  );
}
