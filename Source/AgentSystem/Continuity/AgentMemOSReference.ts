import { z } from "zod";

const ReferencePrefix = "memos:";

/** Public references are decoded once at the tool boundary; MemOS receives native node IDs. */
export const AgentMemOSReferenceSchema = z
  .string()
  .trim()
  .startsWith(ReferencePrefix)
  .min(ReferencePrefix.length + 1)
  .transform((reference) => reference.slice(ReferencePrefix.length));

export function agentMemOSReference(nodeId: string): string {
  return `${ReferencePrefix}${nodeId}`;
}
