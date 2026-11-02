import { z } from "zod";
import type { MemoryNode } from "@mem-os/sdk";

export const AgentMemoryRetentionPolicySchema = z
  .object({ FactDays: z.number().int().positive().safe(), ContextDays: z.number().int().positive().safe() })
  .strict();

export type AgentMemoryRetentionPolicy = z.infer<typeof AgentMemoryRetentionPolicySchema>;

export const AgentMemoryRetentionDefaults: AgentMemoryRetentionPolicy = { FactDays: 7, ContextDays: 1 };

/** Zero means no time-based expiry; supersession and source deletion still apply. */
export const AgentMemoryRetentionDecisionSchema = z.object({ days: z.number().int().nonnegative().safe() }).strict();

export const AgentMemoryRetentionSchema = AgentMemoryRetentionDecisionSchema.extend({
  confirmedAt: z.iso.datetime({ offset: true }),
}).strict();

export type AgentMemoryRetention = z.infer<typeof AgentMemoryRetentionSchema>;

const DayMilliseconds = 24 * 60 * 60 * 1_000;

export function agentMemoryRetentionDeadline(retention: AgentMemoryRetention): number | undefined {
  if (retention.days === 0) return undefined;
  const deadline = Date.parse(retention.confirmedAt) + retention.days * DayMilliseconds;
  if (!Number.isSafeInteger(deadline) || !Number.isFinite(new Date(deadline).getTime()))
    throw new Error("Memory retention exceeds the supported calendar range.");
  return deadline;
}

/** Legacy records inherit the declared policy from their original content time, never from a read. */
export function agentMemoryRetention(
  node: Pick<MemoryNode, "type" | "metadata" | "validFrom" | "createdAt">,
  policy: AgentMemoryRetentionPolicy,
): AgentMemoryRetention {
  const stored = node.metadata?.senera_retention;
  if (stored !== undefined) return AgentMemoryRetentionSchema.parse(stored);
  const days = node.type === "fact" ? policy.FactDays : node.type === "context" ? policy.ContextDays : 0;
  return { days, confirmedAt: new Date(node.validFrom ?? node.createdAt).toISOString() };
}

export function agentMemoryIsActive(
  node: MemoryNode,
  policy: AgentMemoryRetentionPolicy,
  input: { readonly taskId?: string; readonly sessionId?: string; readonly now?: number } = {},
): boolean {
  const now = input.now ?? Date.now();
  if ((node.validFrom != null && node.validFrom > now) || (node.validTo != null && node.validTo <= now)) return false;
  // Resuming the exact session task retains its working state, including after compaction.
  if (
    node.type === "context" &&
    input.taskId !== undefined &&
    node.metadata?.senera_task_id === input.taskId &&
    input.sessionId !== undefined &&
    Array.isArray(node.metadata?.senera_source_session_ids) &&
    node.metadata.senera_source_session_ids.includes(input.sessionId)
  )
    return true;
  const deadline = agentMemoryRetentionDeadline(agentMemoryRetention(node, policy));
  return deadline === undefined || now < deadline;
}
