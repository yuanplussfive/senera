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
  readonly state: "cleanup_failed";
  readonly requestedAt: string;
  readonly updatedAt: string;
  readonly attempts: number;
  readonly failures: readonly string[];
}

export interface AgentSessionLifecycleMetadata {
  readonly cancellation?: AgentSessionCancellationPendingMetadata;
  readonly close?: AgentSessionClosePendingMetadata;
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
