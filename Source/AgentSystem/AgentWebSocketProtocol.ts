import { z } from "zod";
import { createRequestId } from "./AgentIds.js";
import { AgentUserProfileInputSchema } from "./AgentUserProfile.js";

export const AgentWebSocketRequestSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("session.create"),
      sessionId: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.message"),
      sessionId: z.string().min(1),
      requestId: z.string().min(1).optional(),
      modelProviderId: z.string().min(1).optional(),
      input: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.close"),
      sessionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.cancel"),
      sessionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.truncate_from"),
      sessionId: z.string().min(1),
      requestId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.list"),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.history"),
      sessionId: z.string().min(1),
      refresh: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.rename"),
      sessionId: z.string().min(1),
      title: z.string().min(1).max(120),
    })
    .strict(),
  z
    .object({
      type: z.literal("model.list"),
    })
    .strict(),
  z
    .object({
      type: z.literal("profile.get"),
    })
    .strict(),
  z
    .object({
      type: z.literal("profile.update"),
      profile: AgentUserProfileInputSchema,
    })
    .strict(),
]);

export type AgentWebSocketRequest = z.infer<typeof AgentWebSocketRequestSchema>;
export { createRequestId };
