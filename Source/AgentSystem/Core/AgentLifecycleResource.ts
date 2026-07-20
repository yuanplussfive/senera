export interface AgentLifecycleResource<TContext> {
  readonly id: string;
  release(context: TContext): Promise<unknown>;
}

export interface AgentLifecycleResourceFailure {
  readonly resourceId: string;
  readonly error: unknown;
}

export async function releaseAgentLifecycleResources<TContext>(
  resources: readonly AgentLifecycleResource<TContext>[],
  context: TContext,
): Promise<AgentLifecycleResourceFailure[]> {
  const settlements = await Promise.allSettled(resources.map((resource) => resource.release(context)));
  return settlements.flatMap((settlement, index) =>
    settlement.status === "rejected"
      ? [{ resourceId: resources[index]?.id ?? "unknown", error: settlement.reason }]
      : [],
  );
}
