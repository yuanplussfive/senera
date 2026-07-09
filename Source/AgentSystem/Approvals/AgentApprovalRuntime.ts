import { AgentCancellationError } from "../Core/AgentCancellation.js";
import { createApprovalId } from "../Core/AgentIds.js";
import {
  AgentEventKinds,
  emitAgentEvent,
} from "../Events/AgentEvent.js";
import {
  AgentApprovalStatuses,
  type AgentApprovalRequest,
  type AgentApprovalResolution,
  type AgentApprovalRuntime as AgentApprovalRuntimePort,
  type AgentApprovalWaitOptions,
} from "./AgentApprovalTypes.js";

interface PendingApproval {
  approval: AgentApprovalRequest;
  resolve: (resolution: AgentApprovalResolution) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
}

interface PendingApprovalWait {
  promise: Promise<AgentApprovalResolution>;
  cancel: (error: unknown) => void;
}

export class AgentApprovalRuntime implements AgentApprovalRuntimePort {
  private readonly pending = new Map<string, PendingApproval>();

  async requestApproval(options: AgentApprovalWaitOptions): Promise<AgentApprovalResolution> {
    const approval: AgentApprovalRequest = {
      ...options.approval,
      approvalId: createApprovalId(),
      createdAt: new Date().toISOString(),
    };
    const wait = this.waitForResolution(approval, options.signal);
    void wait.promise.catch(() => undefined);

    try {
      await emitAgentEvent(options.onEvent, {
        kind: AgentEventKinds.ApprovalRequested,
        context: {
          requestId: approval.requestId,
          step: approval.step,
        },
        data: {
          approvalId: approval.approvalId,
          approvalKind: approval.kind,
          title: approval.title,
          reason: approval.reason,
          rule: approval.rule,
          riskSignals: approval.riskSignals,
          subject: approval.subject,
          createdAt: approval.createdAt,
          status: AgentApprovalStatuses.Pending,
        },
      });
    } catch (error) {
      wait.cancel(error);
      throw error;
    }

    return wait.promise;
  }

  resolve(
    resolution: Omit<AgentApprovalResolution, "resolvedAt">,
  ): AgentApprovalResolution {
    const resolved = this.tryResolve(resolution);
    if (!resolved) {
      throw new Error(`审批请求不存在或已结束：${resolution.approvalId}`);
    }

    return resolved;
  }

  tryResolve(
    resolution: Omit<AgentApprovalResolution, "resolvedAt">,
  ): AgentApprovalResolution | undefined {
    const pending = this.pending.get(resolution.approvalId);
    if (!pending) {
      return undefined;
    }

    const resolved = {
      ...resolution,
      resolvedAt: new Date().toISOString(),
    };
    pending.cleanup();
    this.pending.delete(resolution.approvalId);
    pending.resolve(resolved);
    return resolved;
  }

  cancelByRequestId(requestId: string, error: unknown = new AgentCancellationError()): number {
    const approvalIds = [...this.pending.values()]
      .filter((pending) => pending.approval.requestId === requestId)
      .map((pending) => pending.approval.approvalId);
    for (const approvalId of approvalIds) {
      const pending = this.pending.get(approvalId);
      pending?.cleanup();
      this.pending.delete(approvalId);
      pending?.reject(error);
    }
    return approvalIds.length;
  }

  getPending(approvalId: string): AgentApprovalRequest | undefined {
    return this.pending.get(approvalId)?.approval;
  }

  private waitForResolution(
    approval: AgentApprovalRequest,
    signal?: AbortSignal,
  ): PendingApprovalWait {
    if (signal?.aborted) {
      throw new AgentCancellationError();
    }

    let rejectWait: ((error: unknown) => void) | undefined;
    const abort = (): void => {
      cancel(new AgentCancellationError());
    };
    const cancel = (error: unknown): void => {
      const pending = this.pending.get(approval.approvalId);
      pending?.cleanup();
      this.pending.delete(approval.approvalId);
      rejectWait?.(error);
    };

    const promise = new Promise<AgentApprovalResolution>((resolve, reject) => {
      rejectWait = reject;
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(approval.approvalId, {
        approval,
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener("abort", abort),
      });
    });

    return {
      promise,
      cancel,
    };
  }
}
