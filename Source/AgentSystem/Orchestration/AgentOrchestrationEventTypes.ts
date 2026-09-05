import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type {
  AgentChildRunModelSelectionSource,
  AgentChildRunSelectedSkill,
  AgentChildRunSnapshot,
  AgentChildRunStatus,
} from "./AgentChildRunTypes.js";
import type { AgentWorkflowNodeStatus, AgentWorkflowStatus } from "./AgentWorkflowTypes.js";

export type AgentWorkflowEventKind =
  | typeof AgentEventKinds.WorkflowStarted
  | typeof AgentEventKinds.WorkflowSnapshotUpdated
  | typeof AgentEventKinds.WorkflowPaused
  | typeof AgentEventKinds.WorkflowCancelling
  | typeof AgentEventKinds.WorkflowCompleted
  | typeof AgentEventKinds.WorkflowPartialCompleted
  | typeof AgentEventKinds.WorkflowFailed
  | typeof AgentEventKinds.WorkflowCancelled;

export interface AgentWorkflowDomainEvent {
  readonly kind: AgentWorkflowEventKind;
  readonly context: AgentEventContext;
  readonly data: {
    readonly workflowId: string;
    readonly status: AgentWorkflowStatus;
    readonly definitionDigest: string;
    readonly nodes: ReadonlyArray<{
      readonly nodeId: string;
      readonly status: AgentWorkflowNodeStatus;
      readonly childRunId?: string;
      readonly error?: string;
    }>;
    readonly error?: string;
  };
}

export type AgentOrchestrationDomainEvent =
  | {
      kind:
        | typeof AgentEventKinds.ChildRunQueued
        | typeof AgentEventKinds.ChildRunStarted
        | typeof AgentEventKinds.ChildRunAwaitingSupervisor
        | typeof AgentEventKinds.ChildRunResumed
        | typeof AgentEventKinds.ChildRunCompleted
        | typeof AgentEventKinds.ChildRunPartialCompleted
        | typeof AgentEventKinds.ChildRunInterrupted
        | typeof AgentEventKinds.ChildRunTimedOut
        | typeof AgentEventKinds.ChildRunFailed
        | typeof AgentEventKinds.ChildRunCancelled;
      context: AgentEventContext;
      data: {
        childRunId: string;
        ownerRunId: string;
        nodeId: string;
        childSessionId: string;
        agentName: string;
        status: AgentChildRunStatus;
        contextMode: "fresh" | "fork";
        modelProviderId?: string;
        modelSelectionSource?: AgentChildRunModelSelectionSource;
        selectedSkills?: readonly AgentChildRunSelectedSkill[];
        error?: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ChildRunSnapshotUpdated;
      context: AgentEventContext;
      data: AgentChildRunEventIdentity & {
        snapshot: AgentChildRunSnapshot;
        checkpointAvailable: boolean;
      };
    }
  | {
      kind: typeof AgentEventKinds.ChildRunDeadlineExtended;
      context: AgentEventContext;
      data: AgentChildRunEventIdentity & {
        extensionMs: number;
        grantedExtensionMs: number;
        softDeadlineAt: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ChildRunWrappingUp;
      context: AgentEventContext;
      data: AgentChildRunEventIdentity & {
        hardDeadlineAt: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ChildRunCancelling;
      context: AgentEventContext;
      data: AgentChildRunEventIdentity & {
        reason: "parent_cancelled" | "deadline_exhausted" | "shutdown";
      };
    }
  | {
      kind: typeof AgentEventKinds.ChildRunMessageCreated;
      context: AgentEventContext;
      data: {
        childRunId: string;
        ownerRunId: string;
        nodeId: string;
        childSessionId: string;
        agentName: string;
        status: AgentChildRunStatus;
        messageId: string;
        direction: "child_to_parent" | "parent_to_child";
        messageKind: "decision" | "follow_up" | "progress" | "response" | "steering";
        content: string;
      };
    }
  | AgentWorkflowDomainEvent
  | {
      kind: typeof AgentEventKinds.ScheduledTaskChanged;
      context: AgentEventContext;
      data: {
        taskId: string;
        operation: "created" | "updated" | "deleted";
        enabled?: boolean;
        nextRunAt?: string;
      };
    }
  | {
      kind:
        | typeof AgentEventKinds.ScheduledTaskRunStarted
        | typeof AgentEventKinds.ScheduledTaskRunCompleted
        | typeof AgentEventKinds.ScheduledTaskRunFailed;
      context: AgentEventContext;
      data: {
        taskId: string;
        runId: string;
        sessionId: string;
        status: "running" | "success" | "error";
        error?: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.SchedulerStatusSnapshot;
      context: AgentEventContext;
      data: {
        active: boolean;
        taskCount: number;
        runningTaskIds: string[];
        pendingDeliveryCount?: number;
        recoveryMode: "database_claim";
        error?: string;
      };
    };

interface AgentChildRunEventIdentity {
  readonly childRunId: string;
  readonly ownerRunId: string;
  readonly nodeId: string;
  readonly childSessionId: string;
  readonly agentName: string;
  readonly status: AgentChildRunStatus;
}
