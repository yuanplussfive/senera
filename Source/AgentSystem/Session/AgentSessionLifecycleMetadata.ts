import type { AgentSessionMetadata } from "../ModelEndpoints/AgentModelMetadata.js";

export interface AgentSessionCancellationPendingMetadata {
  readonly state: "cancellation_pending";
  readonly requestId: string;
  readonly input: string;
  readonly startedAt: string;
  readonly requestedAt: string;
  readonly timeoutMs: number;
}

export interface AgentSessionClosePendingMetadata {
  readonly state: "cleanup_pending" | "cleanup_failed";
  readonly requestedAt: string;
  readonly updatedAt: string;
  readonly attempts: number;
  readonly failures: readonly string[];
}

export interface AgentSessionRegenerationLineageMetadata {
  readonly sourceRequestId: string;
  readonly currentRequestId: string;
  readonly updatedAt: string;
}

export interface AgentSessionLifecycleMetadata {
  readonly cancellation?: AgentSessionCancellationPendingMetadata;
  readonly close?: AgentSessionClosePendingMetadata;
  readonly regeneration?: AgentSessionRegenerationLineageMetadata;
}

export function resolveAgentSessionLifecycle(
  metadata: AgentSessionMetadata | undefined,
): AgentSessionLifecycleMetadata {
  return metadata?.lifecycle ?? {};
}

export function withAgentSessionCancellationPending(
  metadata: AgentSessionMetadata | undefined,
  cancellation: Omit<AgentSessionCancellationPendingMetadata, "state">,
): AgentSessionMetadata {
  return {
    ...metadata,
    lifecycle: {
      ...metadata?.lifecycle,
      cancellation: { state: "cancellation_pending", ...cancellation },
    },
  };
}

export function clearAgentSessionCancellation(
  metadata: AgentSessionMetadata | undefined,
): AgentSessionMetadata | undefined {
  return projectLifecycle(metadata, { cancellation: undefined });
}

export function resolveAgentSessionRegenerationLineage(
  metadata: AgentSessionMetadata | undefined,
  requestId: string,
): AgentSessionRegenerationLineageMetadata | undefined {
  const lineage = metadata?.lifecycle?.regeneration;
  return lineage && (lineage.sourceRequestId === requestId || lineage.currentRequestId === requestId)
    ? lineage
    : undefined;
}

export function withAgentSessionRegenerationLineage(
  metadata: AgentSessionMetadata | undefined,
  lineage: Omit<AgentSessionRegenerationLineageMetadata, "updatedAt">,
): AgentSessionMetadata {
  return {
    ...metadata,
    lifecycle: {
      ...metadata?.lifecycle,
      regeneration: { ...lineage, updatedAt: new Date().toISOString() },
    },
  };
}

export function clearAgentSessionRegenerationLineage(
  metadata: AgentSessionMetadata | undefined,
): AgentSessionMetadata | undefined {
  return projectLifecycle(metadata, { regeneration: undefined });
}

export function withAgentSessionCloseFailure(
  metadata: AgentSessionMetadata | undefined,
  input: { requestedAt: string; failures: readonly string[] },
): AgentSessionMetadata {
  const current = metadata?.lifecycle?.close;
  return {
    ...metadata,
    lifecycle: {
      ...metadata?.lifecycle,
      close: {
        state: "cleanup_failed",
        requestedAt: current?.requestedAt ?? input.requestedAt,
        updatedAt: new Date().toISOString(),
        attempts: (current?.attempts ?? 0) + 1,
        failures: [...input.failures],
      },
    },
  };
}

export function withAgentSessionCloseIntent(
  metadata: AgentSessionMetadata | undefined,
  requestedAt: string,
): AgentSessionMetadata {
  const current = metadata?.lifecycle?.close;
  return {
    ...metadata,
    lifecycle: {
      ...metadata?.lifecycle,
      close: {
        state: "cleanup_pending",
        requestedAt: current?.requestedAt ?? requestedAt,
        updatedAt: requestedAt,
        attempts: current?.attempts ?? 0,
        failures: current?.failures ?? [],
      },
    },
  };
}

function projectLifecycle(
  metadata: AgentSessionMetadata | undefined,
  patch: Partial<AgentSessionLifecycleMetadata>,
): AgentSessionMetadata | undefined {
  if (!metadata) return undefined;
  const lifecycle = { ...metadata.lifecycle, ...patch };
  const compact = Object.fromEntries(Object.entries(lifecycle).filter(([, value]) => value !== undefined));
  const next = { ...metadata, lifecycle: Object.keys(compact).length > 0 ? compact : undefined };
  return Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)) as AgentSessionMetadata;
}
