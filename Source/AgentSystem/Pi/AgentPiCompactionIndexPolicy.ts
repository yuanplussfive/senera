/**
 * Bounds only the compact index that Senera appends to Pi's native compaction
 * entry. The transcript and summary remain fully owned by Pi.
 */
export interface AgentPiCompactionIndexPolicy {
  readonly maxIndexedCalls: number;
  readonly argumentsPreviewTokenBudget: number;
}

export const DefaultAgentPiCompactionIndexPolicy: Readonly<AgentPiCompactionIndexPolicy> = Object.freeze({
  maxIndexedCalls: 64,
  argumentsPreviewTokenBudget: 200,
});

export function normalizeAgentPiCompactionLimit(value: number, name: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}
