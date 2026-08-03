import { AgentCancellationError, readAbortMessage, throwIfAborted } from "../Core/AgentCancellation.js";
import { createOpaqueId } from "../Core/AgentIds.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { AgentToolResourceClaimProjectorPort } from "./AgentToolResourceClaimProjector.js";
import {
  AgentToolResourceAccessModes,
  type AgentToolResourceClaim,
  type AgentToolResourceLeaseRequest,
} from "./AgentToolResourceClaimTypes.js";

type AgentToolResourceLease = () => void;

interface AgentToolResourceWaiter {
  readonly request: AgentToolResourceLeaseRequest;
  readonly resolve: (lease: AgentToolResourceLease) => void;
  readonly reject: (error: unknown) => void;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
}

export class AgentToolResourceScheduler {
  private readonly active = new Map<string, AgentToolResourceLeaseRequest>();
  private readonly waiters: AgentToolResourceWaiter[] = [];

  constructor(private readonly claims: AgentToolResourceClaimProjectorPort) {}

  async run<T>(
    tool: RegisteredTool,
    args: Readonly<Record<string, unknown>>,
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    throwIfAborted(signal);
    const request = await this.claims.project(tool, args);
    const release = await this.acquire(request, signal);
    try {
      throwIfAborted(signal);
      const result = await operation();
      throwIfAborted(signal);
      return result;
    } finally {
      release();
    }
  }

  private acquire(request: AgentToolResourceLeaseRequest, signal?: AbortSignal): Promise<AgentToolResourceLease> {
    throwIfAborted(signal);
    const conflictsWithWaitingRequest = this.waiters.some((waiter) =>
      resourceRequestsConflict(request, waiter.request),
    );
    if (!conflictsWithWaitingRequest && this.canAcquire(request)) return Promise.resolve(this.activate(request));

    return new Promise<AgentToolResourceLease>((resolve, reject) => {
      const onAbort = signal
        ? () => {
            const index = this.waiters.indexOf(waiter);
            if (index >= 0) this.waiters.splice(index, 1);
            reject(new AgentCancellationError(readAbortMessage(signal)));
            this.dispatch();
          }
        : undefined;
      const waiter: AgentToolResourceWaiter = {
        request,
        resolve,
        reject,
        signal,
        onAbort,
      };
      this.waiters.push(waiter);
      if (onAbort) signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort?.();
    });
  }

  private activate(request: AgentToolResourceLeaseRequest): AgentToolResourceLease {
    const leaseId = createOpaqueId("toollease");
    this.active.set(leaseId, request);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active.delete(leaseId);
      this.dispatch();
    };
  }

  private canAcquire(request: AgentToolResourceLeaseRequest): boolean {
    return [...this.active.values()].every((active) => !resourceRequestsConflict(request, active));
  }

  private dispatch(): void {
    for (let index = 0; index < this.waiters.length;) {
      const waiter = this.waiters[index];
      if (!waiter) break;
      const blockedByEarlierWaiter = this.waiters
        .slice(0, index)
        .some((earlier) => resourceRequestsConflict(waiter.request, earlier.request));
      if (!blockedByEarlierWaiter && this.canAcquire(waiter.request)) {
        this.waiters.splice(index, 1);
        if (waiter.onAbort) waiter.signal?.removeEventListener("abort", waiter.onAbort);
        waiter.resolve(this.activate(waiter.request));
        continue;
      }
      index += 1;
    }
  }
}

export function resourceRequestsConflict(
  left: AgentToolResourceLeaseRequest,
  right: AgentToolResourceLeaseRequest,
): boolean {
  if (left.mode === "exclusive" || right.mode === "exclusive") return true;
  return left.claims.some((leftClaim) =>
    right.claims.some((rightClaim) => resourceClaimsConflict(leftClaim, rightClaim)),
  );
}

function resourceClaimsConflict(left: AgentToolResourceClaim, right: AgentToolResourceClaim): boolean {
  if (left.domain.id !== right.domain.id || !left.domain.overlaps(left.identity, right.identity)) return false;
  return (
    left.access === AgentToolResourceAccessModes.Exclusive || right.access === AgentToolResourceAccessModes.Exclusive
  );
}
