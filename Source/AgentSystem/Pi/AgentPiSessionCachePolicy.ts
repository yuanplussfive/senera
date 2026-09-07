export const AgentPiSessionCacheDefaults = {
  Capacity: 8,
} as const;

export function resolveAgentPiSessionCacheCapacity(value: number | undefined): number {
  if (value === undefined) return AgentPiSessionCacheDefaults.Capacity;
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : AgentPiSessionCacheDefaults.Capacity;
}
