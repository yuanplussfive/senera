import { z } from "zod";
import { parseNormalizedBamlOutput } from "../BamlClient/AgentBamlOutputNormalizer.js";
import type { AgentConversationBoundaryResult } from "./AgentTemporalMemoryTypes.js";

const ConversationBoundarySchema = z
  .object({
    relation: z.enum(["continue", "boundary"]),
    confidence: z.number().min(0).max(1),
    focus: z.string().trim().min(1),
  })
  .strict();

export function parseAgentConversationBoundary(value: unknown): AgentConversationBoundaryResult {
  const parsed = parseNormalizedBamlOutput(ConversationBoundarySchema, value);
  return { ...parsed, focus: parsed.focus.replace(/\s+/gu, " ") };
}
