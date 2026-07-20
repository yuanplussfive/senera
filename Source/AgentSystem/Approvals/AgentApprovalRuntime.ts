import { AgentCancellationError } from "../Core/AgentCancellation.js";
import { createApprovalId } from "../Core/AgentIds.js";
import { AgentEventKinds, emitAgentEvent, type AgentEventSink } from "../Events/AgentEvent.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import {
  AgentApprovalDecisions,
  AgentApprovalDispositions,
  AgentApprovalStatuses,
  type AgentApprovalDecision,
  type AgentApprovalRequest,
  type AgentApprovalResolution,
  type AgentApprovalResolveCommand,
  type AgentApprovalRuntime as AgentApprovalRuntimePort,
  type AgentApprovalWaitOptions,
} from "./AgentApprovalTypes.js";

interface PendingApproval {
  readonly approval: AgentApprovalRequest;
  readonly promise: Promise<AgentApprovalResolution>;
  readonly resolve: (resolution: AgentApprovalResolution) => void;
  readonly reject: (error: unknown) => void;
  readonly eventSink?: AgentEventSink;
  readonly correlationKey?: string;
  readonly cleanup: () => void;
}

export interface AgentApprovalRuntimeOptions {
  defaultDeadlineMs?: number;
}

export const AgentApprovalDefaultDeadlineMs = 120_000;

interface ApprovalDecisionProjection {
  readonly status: Extract<AgentApprovalResolution["status"], "approved" | "denied">;
  readonly disposition: AgentApprovalResolution["disposition"];
  readonly scope: "once" | "session";
}

const ApprovalDecisionProjections = {
  [AgentApprovalDecisions.ApproveOnce]: {
    status: AgentApprovalStatuses.Approved,
    disposition: AgentApprovalDispositions.Proceed,
    scope: "once",
  },
  [AgentApprovalDecisions.ApproveSession]: {
    status: AgentApprovalStatuses.Approved,
    disposition: AgentApprovalDispositions.Proceed,
    scope: "session",
  },
  [AgentApprovalDecisions.Deny]: {
    status: AgentApprovalStatuses.Denied,
    disposition: AgentApprovalDispositions.Continue,
    scope: "once",
  },
  [AgentApprovalDecisions.DenyAndInterrupt]: {
    status: AgentApprovalStatuses.Denied,
    disposition: AgentApprovalDispositions.Interrupt,
    scope: "once",
  },
} as const satisfies Record<AgentApprovalDecision, ApprovalDecisionProjection>;

export class AgentApprovalRuntime implements AgentApprovalRuntimePort {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly pendingByCorrelation = new Map<string, string>();
  private eventSink?: AgentEventSink;

  private readonly defaultDeadlineMs: number;

  constructor(options: AgentApprovalRuntimeOptions = {}) {
    this.defaultDeadlineMs = normalizeDeadline(options.defaultDeadlineMs ?? AgentApprovalDefaultDeadlineMs);
  }

  setEventSink(eventSink: AgentEventSink | undefined): void {
    this.eventSink = eventSink;
  }

  async requestApproval(options: AgentApprovalWaitOptions): Promise<AgentApprovalResolution> {
    const correlationKey = approvalCorrelationKey(options.approval);
    const existingId = correlationKey ? this.pendingByCorrelation.get(correlationKey) : undefined;
    const existing = existingId ? this.pending.get(existingId) : undefined;
    if (existing) {
      return existing.promise;
    }

    const deadlineMs = normalizeDeadline(options.deadlineMs ?? this.defaultDeadlineMs);
    const approval: AgentApprovalRequest = {
      ...options.approval,
      approvalId: createApprovalId(),
      createdAt: new Date().toISOString(),
      deadlineAt: deadlineMs ? new Date(Date.now() + deadlineMs).toISOString() : undefined,
    };
    const pending = this.createPendingApproval(approval, correlationKey, options.onEvent, options.signal, deadlineMs);
    this.pending.set(approval.approvalId, pending);
    if (correlationKey) {
      this.pendingByCorrelation.set(correlationKey, approval.approvalId);
    }

    try {
      await this.emitRequested(pending);
    } catch (error) {
      this.removePending(pending);
      pending.reject(error);
      throw error;
    }

    if (options.signal?.aborted) {
      await this.cancelByRequestId(options.approval.requestId, options.signal.reason ?? new AgentCancellationError());
    }

    return pending.promise;
  }

  async resolve(command: AgentApprovalResolveCommand): Promise<AgentApprovalResolution> {
    const resolved = await this.tryResolve(command);
    if (!resolved) {
      throw new Error(
        agentErrorMessage("approval.requestNotPending", {
          approvalId: command.approvalId,
        }),
      );
    }
    return resolved;
  }

  async tryResolve(command: AgentApprovalResolveCommand): Promise<AgentApprovalResolution | undefined> {
    const pending = this.pending.get(command.approvalId);
    if (!pending) {
      return undefined;
    }
    if (!pending.approval.availableDecisions.includes(command.decision)) {
      throw new Error(agentErrorMessage("approval.decisionUnavailable", { decision: command.decision }));
    }

    const projection = ApprovalDecisionProjections[command.decision];
    return this.settle(pending, {
      approvalId: command.approvalId,
      decision: command.decision,
      status: projection.status,
      disposition: projection.disposition,
      scope: projection.scope,
      message: command.message,
      resolvedAt: new Date().toISOString(),
    });
  }

  async cancelByRequestId(requestId: string, error: unknown = new AgentCancellationError()): Promise<number> {
    const matches = [...this.pending.values()].filter((pending) => pending.approval.requestId === requestId);
    const message = error instanceof Error ? error.message : String(error);
    await Promise.all(
      matches.map((pending) =>
        this.settle(pending, {
          approvalId: pending.approval.approvalId,
          status: AgentApprovalStatuses.Cancelled,
          disposition: AgentApprovalDispositions.Interrupt,
          message,
          resolvedAt: new Date().toISOString(),
        }),
      ),
    );
    return matches.length;
  }

  async expire(
    approvalId: string,
    message = agentErrorMessage("approval.waitExpired"),
  ): Promise<AgentApprovalResolution | undefined> {
    const pending = this.pending.get(approvalId);
    return pending
      ? this.settle(pending, {
          approvalId,
          status: AgentApprovalStatuses.Expired,
          disposition: AgentApprovalDispositions.Continue,
          message,
          resolvedAt: new Date().toISOString(),
        })
      : undefined;
  }

  getPending(approvalId: string): AgentApprovalRequest | undefined {
    return this.pending.get(approvalId)?.approval;
  }

  listPending(sessionId?: string): AgentApprovalRequest[] {
    return [...this.pending.values()]
      .map((pending) => pending.approval)
      .filter((approval) => !sessionId || approval.sessionId === sessionId);
  }

  private createPendingApproval(
    approval: AgentApprovalRequest,
    correlationKey: string | undefined,
    eventSink: AgentEventSink | undefined,
    signal: AbortSignal | undefined,
    deadlineMs: number,
  ): PendingApproval {
    let resolvePromise!: (resolution: AgentApprovalResolution) => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<AgentApprovalResolution>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    void promise.catch(() => undefined);

    const abort = (): void => {
      void this.cancelByRequestId(approval.requestId, signal?.reason ?? new AgentCancellationError());
    };
    signal?.addEventListener("abort", abort, { once: true });

    const deadlineTimer = deadlineMs
      ? setTimeout(() => {
          void this.expire(approval.approvalId);
        }, deadlineMs)
      : undefined;
    deadlineTimer?.unref();

    return {
      approval,
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      eventSink,
      correlationKey,
      cleanup: () => {
        signal?.removeEventListener("abort", abort);
        if (deadlineTimer) clearTimeout(deadlineTimer);
      },
    };
  }

  private async settle(
    pending: PendingApproval,
    resolution: AgentApprovalResolution,
  ): Promise<AgentApprovalResolution> {
    if (this.pending.get(pending.approval.approvalId) !== pending) {
      return resolution;
    }

    this.removePending(pending);
    try {
      await this.emitResolved(pending, resolution);
    } finally {
      pending.resolve(resolution);
    }
    return resolution;
  }

  private removePending(pending: PendingApproval): void {
    pending.cleanup();
    this.pending.delete(pending.approval.approvalId);
    if (
      pending.correlationKey &&
      this.pendingByCorrelation.get(pending.correlationKey) === pending.approval.approvalId
    ) {
      this.pendingByCorrelation.delete(pending.correlationKey);
    }
  }

  private emitRequested(pending: PendingApproval): Promise<void> {
    const approval = pending.approval;
    return emitAgentEvent(this.eventSink ?? pending.eventSink, {
      kind: AgentEventKinds.ApprovalRequested,
      context: approvalEventContext(approval),
      data: {
        ...approvalEventData(approval),
        status: AgentApprovalStatuses.Pending,
      },
    });
  }

  private async emitResolved(pending: PendingApproval, resolution: AgentApprovalResolution): Promise<void> {
    const approval = pending.approval;
    try {
      await emitAgentEvent(this.eventSink ?? pending.eventSink, {
        kind: AgentEventKinds.ApprovalResolved,
        context: approvalEventContext(approval),
        data: {
          ...approvalEventData(approval),
          decision: resolution.decision,
          status: resolution.status,
          disposition: resolution.disposition,
          message: resolution.message,
          scope: resolution.scope,
          resolvedAt: resolution.resolvedAt,
        },
      });
    } catch {
      // A transport failure must not roll back a user decision. History/snapshot recovery remains authoritative.
    }
  }
}

function approvalCorrelationKey(approval: AgentApprovalWaitOptions["approval"]): string | undefined {
  return approval.toolCallId
    ? [approval.sessionId, approval.requestId, approval.batchId ?? "", approval.toolCallId, approval.kind].join(
        "\u0000",
      )
    : undefined;
}

function approvalEventContext(approval: AgentApprovalRequest) {
  return {
    sessionId: approval.sessionId,
    requestId: approval.requestId,
    step: approval.step,
  };
}

function approvalEventData(approval: AgentApprovalRequest) {
  return {
    approvalId: approval.approvalId,
    approvalKind: approval.kind,
    title: approval.title,
    reason: approval.reason,
    rule: approval.rule,
    riskSignals: approval.riskSignals,
    toolCallId: approval.toolCallId,
    batchId: approval.batchId,
    availableDecisions: approval.availableDecisions,
    subject: approval.subject,
    createdAt: approval.createdAt,
    deadlineAt: approval.deadlineAt,
  };
}

function normalizeDeadline(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Approval deadline must be a non-negative finite number.");
  }
  return Math.trunc(value);
}
