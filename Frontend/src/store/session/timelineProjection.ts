import type { EventEnvelope, StepTraceDto } from "../../api/eventTypes";
import type { TimelineStep } from "./types";

export function timelineScopeFromEvent(env: EventEnvelope): TimelineStep["scope"] | undefined {
  if (!env.scope) return undefined;
  return {
    parentRequestId: env.scope.parentRequestId,
    workflowName: env.scope.workflowName,
    jobId: env.scope.jobId,
    agentName: env.scope.agentName,
    role: env.scope.role,
  };
}

export function toolBatchFromEvent(
  env: EventEnvelope,
  data?: { index?: number },
  size?: number,
): TimelineStep["toolBatch"] {
  return {
    id: [
      env.scope?.parentRequestId,
      env.scope?.workflowName,
      env.scope?.role,
      env.scope?.jobId,
      env.requestId,
      env.step ?? 0,
    ]
      .filter((value) => value !== undefined && value !== "")
      .join(":"),
    index: data?.index,
    size,
  };
}

export function toolBatchForTrace(
  requestId: string,
  trace: StepTraceDto,
): TimelineStep["toolBatch"] {
  return {
    id: [requestId, trace.step].join(":"),
    index: trace.seq,
  };
}
