import {
  AgentChildRunMessageDirections,
  AgentChildRunMessageKinds,
  AgentChildRunProgressPhases,
  AgentChildRunStatuses,
  type AgentChildRunRecord,
  type AgentChildRunProgressProjection,
} from "./AgentChildRunTypes.js";
import { formatAgentTimeOffsetMillisecond } from "../Time/AgentTime.js";

export type AgentChildRunPublicState =
  | "not_found"
  | "queued"
  | "running"
  | "needs_input"
  | "stopping"
  | "completed"
  | "partial_completed"
  | "failed"
  | "cancelled";

export interface AgentChildRunPublicView {
  readonly runId: string;
  readonly state: AgentChildRunPublicState;
  readonly agent?: string;
  readonly joinGroup?: { readonly id: string; readonly mode: "any" | "all"; readonly expectedCount: number };
  readonly result?: { readonly content: string };
  readonly error?: string;
  readonly request?: { readonly id: string; readonly message: string };
  readonly progress?: AgentChildRunProgressProjection;
  readonly workItemId?: string;
  readonly taskDigest?: string;
  readonly resources?: {
    readonly coverage: "declared" | "unscoped" | "unknown";
    readonly claims: readonly {
      readonly domainId: string;
      readonly identity: string;
      readonly access: "shared" | "exclusive";
    }[];
  };
  readonly delivery?: { readonly parentResultDelivered: boolean };
}

export function projectAgentChildRunView(run: AgentChildRunRecord | undefined, runId: string): AgentChildRunPublicView {
  if (!run) {
    return {
      runId,
      state: "not_found",
      resources: { coverage: "unknown", claims: [] },
      delivery: { parentResultDelivered: false },
    };
  }
  const supervisorRequest =
    run.status === AgentChildRunStatuses.AwaitingSupervisor
      ? [...run.messages]
          .reverse()
          .find(
            (message) =>
              message.direction === AgentChildRunMessageDirections.ChildToParent &&
              message.kind === AgentChildRunMessageKinds.Decision,
          )
      : undefined;
  const progress = projectAgentChildRunProgress(run);
  return {
    runId: run.id,
    state: projectChildRunPublicState(run.status),
    agent: run.agentName,
    ...(run.workItemId ? { workItemId: run.workItemId } : {}),
    ...(run.taskDigest ? { taskDigest: run.taskDigest } : {}),
    resources: {
      coverage: run.executionContract.resourceCoverage ?? "unscoped",
      claims: run.executionContract.resourceClaims ?? [],
    },
    delivery: { parentResultDelivered: run.parentResultDeliveredAt !== undefined },
    ...(run.joinGroup ? { joinGroup: run.joinGroup } : {}),
    ...(run.finalAnswer !== undefined ? { result: { content: run.finalAnswer } } : {}),
    ...(run.error !== undefined ? { error: run.error } : {}),
    ...(supervisorRequest ? { request: { id: supervisorRequest.id, message: supervisorRequest.content } } : {}),
    ...(progress ? { progress } : {}),
  };
}

export function projectAgentChildRunProgress(run: AgentChildRunRecord): AgentChildRunProgressProjection | undefined {
  if (!run.snapshot && !run.checkpoint) return undefined;

  const snapshot = run.snapshot;
  const activeTools = snapshot?.activeTools ?? [];
  const phase = readAgentChildRunProgressPhase(run, activeTools);
  return {
    phase,
    ...(snapshot?.lastActivityAt ? { lastActivityAt: formatAgentTimeOffsetMillisecond(snapshot.lastActivityAt) } : {}),
    activeTools,
    toolCalls: snapshot?.toolCalls ?? { planned: 0, started: 0, completed: 0, failed: 0 },
    checkpointAvailable: run.checkpoint !== undefined,
    artifactCount: snapshot?.artifactUris.length ?? 0,
    ...(snapshot?.control?.todo ? { todo: structuredClone(snapshot.control.todo) } : {}),
  };
}

function readAgentChildRunProgressPhase(
  run: AgentChildRunRecord,
  activeTools: readonly string[],
): AgentChildRunProgressProjection["phase"] {
  switch (run.status) {
    case AgentChildRunStatuses.Queued:
      return AgentChildRunProgressPhases.Queued;
    case AgentChildRunStatuses.AwaitingSupervisor:
      return AgentChildRunProgressPhases.AwaitingSupervisor;
    case AgentChildRunStatuses.WrappingUp:
      return AgentChildRunProgressPhases.WrappingUp;
    case AgentChildRunStatuses.Cancelling:
      return AgentChildRunProgressPhases.Cancelling;
    case AgentChildRunStatuses.Completed:
    case AgentChildRunStatuses.PartialCompleted:
      return AgentChildRunProgressPhases.Completed;
    case AgentChildRunStatuses.Failed:
    case AgentChildRunStatuses.Interrupted:
    case AgentChildRunStatuses.TimedOut:
      return AgentChildRunProgressPhases.Failed;
    case AgentChildRunStatuses.Cancelled:
      return AgentChildRunProgressPhases.Cancelled;
    case AgentChildRunStatuses.Running:
      if (activeTools.length > 0) return AgentChildRunProgressPhases.ToolExecution;
      if (run.snapshot && run.snapshot.lastModelOutputAt === run.snapshot.lastActivityAt) {
        return AgentChildRunProgressPhases.ModelOutput;
      }
      return AgentChildRunProgressPhases.Starting;
  }
}

export function projectChildRunPublicState(status: AgentChildRunRecord["status"]): AgentChildRunPublicState {
  switch (status) {
    case AgentChildRunStatuses.Queued:
      return "queued";
    case AgentChildRunStatuses.Running:
    case AgentChildRunStatuses.WrappingUp:
      return "running";
    case AgentChildRunStatuses.AwaitingSupervisor:
      return "needs_input";
    case AgentChildRunStatuses.Cancelling:
      return "stopping";
    case AgentChildRunStatuses.Completed:
      return "completed";
    case AgentChildRunStatuses.PartialCompleted:
      return "partial_completed";
    case AgentChildRunStatuses.Interrupted:
    case AgentChildRunStatuses.TimedOut:
    case AgentChildRunStatuses.Failed:
      return "failed";
    case AgentChildRunStatuses.Cancelled:
      return "cancelled";
  }
}
