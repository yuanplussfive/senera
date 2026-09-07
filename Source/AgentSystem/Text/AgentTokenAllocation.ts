export interface AgentTokenAllocationDemand {
  readonly identity: string;
  readonly minimumTokens: number;
  readonly desiredTokens: number;
}

export function allocateAgentTokenBudget(
  demands: readonly AgentTokenAllocationDemand[],
  totalTokens: number,
): ReadonlyMap<string, number> {
  const ordered = [...demands].map(normalizeDemand).sort((left, right) => left.identity.localeCompare(right.identity));
  assertUniqueIdentities(ordered);

  const allocations = new Map(ordered.map((demand) => [demand.identity, demand.minimumTokens]));
  let remaining = Math.max(
    0,
    normalizeTokenCount(totalTokens) - ordered.reduce((total, demand) => total + demand.minimumTokens, 0),
  );
  let active = ordered.filter((demand) => demand.desiredTokens > demand.minimumTokens);

  while (remaining > 0 && active.length > 0) {
    const share = Math.max(1, Math.floor(remaining / active.length));
    let granted = 0;
    for (const demand of active) {
      const unallocated = remaining - granted;
      if (unallocated <= 0) break;
      const allocated = allocations.get(demand.identity) ?? demand.minimumTokens;
      const grant = Math.min(share, demand.desiredTokens - allocated, unallocated);
      allocations.set(demand.identity, allocated + grant);
      granted += grant;
    }
    if (granted === 0) break;
    remaining -= granted;
    active = active.filter((demand) => (allocations.get(demand.identity) ?? 0) < demand.desiredTokens);
  }

  return allocations;
}

function normalizeDemand(demand: AgentTokenAllocationDemand): AgentTokenAllocationDemand {
  const minimumTokens = normalizeTokenCount(demand.minimumTokens);
  return {
    identity: demand.identity,
    minimumTokens,
    desiredTokens: Math.max(minimumTokens, normalizeTokenCount(demand.desiredTokens)),
  };
}

function normalizeTokenCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function assertUniqueIdentities(demands: readonly AgentTokenAllocationDemand[]): void {
  const identities = new Set<string>();
  for (const demand of demands) {
    if (identities.has(demand.identity)) {
      throw new Error(`Token allocation identity must be unique: ${demand.identity}`);
    }
    identities.add(demand.identity);
  }
}
