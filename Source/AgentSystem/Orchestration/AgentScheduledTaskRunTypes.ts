import type { ScheduledTask } from "@amaster.ai/pi-task-scheduler";

export const AgentScheduledTaskExecutionModes = {
  AtDueTime: "at_due_time",
  ExecuteNowDeliverAt: "execute_now_deliver_at",
} as const;

export type AgentScheduledTaskExecutionMode =
  (typeof AgentScheduledTaskExecutionModes)[keyof typeof AgentScheduledTaskExecutionModes];

/**
 * A scheduled task keeps the durable turn boundary from which background work
 * must fork. The optional form only exists for records predating this field.
 */
export interface AgentScheduledTaskRecord extends ScheduledTask {
  readonly sourceRequestId?: string;
  /** Omission preserves the behavior of records created before this field. */
  readonly executionMode?: AgentScheduledTaskExecutionMode;
}

export function resolveAgentScheduledTaskExecutionMode(
  task: Pick<AgentScheduledTaskRecord, "executionMode">,
): AgentScheduledTaskExecutionMode {
  return task.executionMode ?? AgentScheduledTaskExecutionModes.AtDueTime;
}

export const AgentScheduledTaskExecutionStatuses = {
  Queued: "queued",
  Claimed: "claimed",
  Running: "running",
  Succeeded: "succeeded",
  Failed: "failed",
} as const;

export type AgentScheduledTaskExecutionStatus =
  (typeof AgentScheduledTaskExecutionStatuses)[keyof typeof AgentScheduledTaskExecutionStatuses];

export const AgentScheduledTaskDeliveryStatuses = {
  Pending: "pending",
  Delivered: "delivered",
  NotRequired: "not_required",
} as const;

export type AgentScheduledTaskDeliveryStatus =
  (typeof AgentScheduledTaskDeliveryStatuses)[keyof typeof AgentScheduledTaskDeliveryStatuses];

export interface AgentScheduledTaskRunRecord {
  readonly id: string;
  readonly taskId: string;
  readonly scheduledFor: string;
  readonly executionStatus: AgentScheduledTaskExecutionStatus;
  readonly deliveryStatus: AgentScheduledTaskDeliveryStatus;
  readonly executionSessionId: string;
  /** The earliest time at which this run may be reported to its owner. */
  readonly deliveryAt: string;
  readonly sourceRequestId?: string;
  readonly claimId?: string;
  readonly claimUntil?: string;
  readonly attempt: number;
  readonly result?: string;
  readonly error?: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly deliveredAt?: string;
  readonly updatedAt: string;
}

export interface AgentScheduledTaskRunClaim {
  readonly task: AgentScheduledTaskRecord;
  readonly run: AgentScheduledTaskRunRecord;
}

export interface AgentScheduledTaskDeliveryRequest {
  readonly deliveryId: string;
  readonly taskId: string;
  readonly sessionId: string;
  readonly content: string;
  readonly createdAt: string;
}

export interface AgentScheduledTaskDeliveryPort {
  deliver(request: AgentScheduledTaskDeliveryRequest): Promise<"delivered" | "busy" | "missing">;
}

/** Resolves a fork point for records created before source context was persisted. */
export interface AgentScheduledTaskSourceContextPort {
  sessionExists(sessionId: string): Promise<boolean>;
  resolveForkBoundary(sessionId: string): Promise<string | undefined>;
}

/** Releases a hidden scheduled-run fork once it is no longer executing. */
export interface AgentScheduledTaskExecutionSessionPort {
  dispose(sessionId: string): Promise<void>;
}

export class AgentScheduledTaskDeliveryGateway implements AgentScheduledTaskDeliveryPort {
  private delegate?: AgentScheduledTaskDeliveryPort;

  bind(delegate: AgentScheduledTaskDeliveryPort): () => void {
    if (this.delegate) throw new Error("Scheduled-task delivery gateway is already bound.");
    this.delegate = delegate;
    return () => {
      if (this.delegate === delegate) this.delegate = undefined;
    };
  }

  deliver(request: AgentScheduledTaskDeliveryRequest): Promise<"delivered" | "busy" | "missing"> {
    if (!this.delegate) return Promise.resolve("busy");
    return this.delegate.deliver(request);
  }
}

export class AgentScheduledTaskSourceContextGateway implements AgentScheduledTaskSourceContextPort {
  private delegate?: AgentScheduledTaskSourceContextPort;

  bind(delegate: AgentScheduledTaskSourceContextPort): () => void {
    if (this.delegate) throw new Error("Scheduled-task source context gateway is already bound.");
    this.delegate = delegate;
    return () => {
      if (this.delegate === delegate) this.delegate = undefined;
    };
  }

  resolveForkBoundary(sessionId: string): Promise<string | undefined> {
    return this.delegate?.resolveForkBoundary(sessionId) ?? Promise.resolve(undefined);
  }

  sessionExists(sessionId: string): Promise<boolean> {
    if (!this.delegate) throw new Error("Scheduled-task source context gateway is not bound.");
    return this.delegate.sessionExists(sessionId);
  }
}

export class AgentScheduledTaskExecutionSessionGateway implements AgentScheduledTaskExecutionSessionPort {
  private delegate?: AgentScheduledTaskExecutionSessionPort;

  bind(delegate: AgentScheduledTaskExecutionSessionPort): () => void {
    if (this.delegate) throw new Error("Scheduled-task execution session gateway is already bound.");
    this.delegate = delegate;
    return () => {
      if (this.delegate === delegate) this.delegate = undefined;
    };
  }

  dispose(sessionId: string): Promise<void> {
    return this.delegate?.dispose(sessionId) ?? Promise.resolve();
  }
}
