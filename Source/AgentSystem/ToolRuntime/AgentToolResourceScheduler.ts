import { AgentCancellationError, readAbortMessage, throwIfAborted } from "../Core/AgentCancellation.js";
import { createOpaqueId } from "../Core/AgentIds.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { AgentToolResourceClaimProjectorPort } from "./AgentToolResourceClaimProjector.js";
import {
  AgentToolResourceAccessModes,
  type AgentToolResourceClaim,
  type AgentToolResourceLeaseRequest,
} from "./AgentToolResourceClaimTypes.js";

export interface AgentToolResourceLeaseOwner {
  readonly type: string;
  readonly id: string;
  readonly parent?: AgentToolResourceLeaseOwner;
}

export interface AgentToolResourceLeaseHandle {
  readonly request: AgentToolResourceLeaseRequest;
  readonly owner?: AgentToolResourceLeaseOwner;
  release(): void;
}

export interface AgentToolResourceConflict {
  readonly owner?: AgentToolResourceLeaseOwner;
  readonly claims: readonly AgentToolResourceClaim[];
}

interface AgentToolResourceWaiter {
  readonly request: AgentToolResourceLeaseRequest;
  readonly resolve: (lease: AgentToolResourceLeaseHandle) => void;
  readonly reject: (error: unknown) => void;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
  readonly owner?: AgentToolResourceLeaseOwner;
}

/**
 * Shared in-process resource coordinator. Tool calls and delegated child runs
 * use the same coordinator so a claim cannot be bypassed by crossing a
 * runtime/session boundary.
 */
export class AgentToolResourceLeaseCoordinator {
  private readonly active = new Map<string, AgentToolResourceLeaseHandle>();
  private readonly waiters: AgentToolResourceWaiter[] = [];

  acquire(
    request: AgentToolResourceLeaseRequest,
    signal?: AbortSignal,
    owner?: AgentToolResourceLeaseOwner,
  ): Promise<AgentToolResourceLeaseHandle> {
    throwIfAborted(signal);
    const reentrantOwner =
      owner !== undefined && [...this.active.values()].some((lease) => ownerCanReenter(owner, lease.owner));
    const conflictsWithWaitingRequest =
      !reentrantOwner &&
      this.waiters.some(
        (waiter) => !sameOwner(owner, waiter.owner) && resourceRequestsConflict(request, waiter.request),
      );
    if (!conflictsWithWaitingRequest && this.canAcquire(request, owner)) {
      return Promise.resolve(this.activate(request, owner));
    }

    return new Promise<AgentToolResourceLeaseHandle>((resolve, reject) => {
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
        owner,
      };
      this.waiters.push(waiter);
      if (onAbort) signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort?.();
    });
  }

  conflicts(
    request: AgentToolResourceLeaseRequest,
    owner?: AgentToolResourceLeaseOwner,
  ): readonly AgentToolResourceConflict[] {
    return [...this.active.values()]
      .filter((lease) => !sameOwner(owner, lease.owner) && resourceRequestsConflict(request, lease.request))
      .map((lease) => ({
        ...(lease.owner ? { owner: lease.owner } : {}),
        claims: lease.request.claims,
      }));
  }

  snapshot(): readonly AgentToolResourceLeaseHandle[] {
    return [...this.active.values()];
  }

  private activate(
    request: AgentToolResourceLeaseRequest,
    owner?: AgentToolResourceLeaseOwner,
  ): AgentToolResourceLeaseHandle {
    const leaseId = createOpaqueId("toollease");
    let released = false;
    const lease: AgentToolResourceLeaseHandle = {
      request,
      ...(owner ? { owner } : {}),
      release: () => {
        if (released) return;
        released = true;
        this.active.delete(leaseId);
        this.dispatch();
      },
    };
    this.active.set(leaseId, lease);
    return lease;
  }

  private canAcquire(request: AgentToolResourceLeaseRequest, owner?: AgentToolResourceLeaseOwner): boolean {
    return [...this.active.values()].every(
      (active) => ownerCanReenter(owner, active.owner) || !resourceRequestsConflict(request, active.request),
    );
  }

  private dispatch(): void {
    for (let index = 0; index < this.waiters.length;) {
      const waiter = this.waiters[index];
      if (!waiter) break;
      const blockedByEarlierWaiter = this.waiters
        .slice(0, index)
        .some(
          (earlier) =>
            !sameOwner(waiter.owner, earlier.owner) && resourceRequestsConflict(waiter.request, earlier.request),
        );
      if (!blockedByEarlierWaiter && this.canAcquire(waiter.request, waiter.owner)) {
        this.waiters.splice(index, 1);
        if (waiter.onAbort) waiter.signal?.removeEventListener("abort", waiter.onAbort);
        waiter.resolve(this.activate(waiter.request, waiter.owner));
        continue;
      }
      index += 1;
    }
  }
}

export class AgentToolResourceScheduler {
  constructor(
    private readonly claims: AgentToolResourceClaimProjectorPort,
    private readonly coordinator = new AgentToolResourceLeaseCoordinator(),
  ) {}

  async run<T>(
    tool: RegisteredTool,
    args: Readonly<Record<string, unknown>>,
    operation: () => Promise<T>,
    signal?: AbortSignal,
    owner?: AgentToolResourceLeaseOwner,
  ): Promise<T> {
    throwIfAborted(signal);
    const request = await this.claims.project(tool, args);
    const lease = await this.coordinator.acquire(request, signal, owner);
    try {
      throwIfAborted(signal);
      const result = await operation();
      throwIfAborted(signal);
      return result;
    } finally {
      lease.release();
    }
  }
}

function sameOwner(
  left: AgentToolResourceLeaseOwner | undefined,
  right: AgentToolResourceLeaseOwner | undefined,
): boolean {
  return left !== undefined && right !== undefined && left.type === right.type && left.id === right.id;
}

function ownerCanReenter(
  requestOwner: AgentToolResourceLeaseOwner | undefined,
  activeOwner: AgentToolResourceLeaseOwner | undefined,
): boolean {
  return (
    sameOwner(requestOwner, activeOwner) ||
    (requestOwner?.parent !== undefined && sameOwner(requestOwner.parent, activeOwner))
  );
}

export function resourceRequestsConflict(
  left: AgentToolResourceLeaseRequest,
  right: AgentToolResourceLeaseRequest,
): boolean {
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
