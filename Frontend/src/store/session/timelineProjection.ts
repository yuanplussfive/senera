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
): NonNullable<TimelineStep["toolBatch"]> {
  const eventData = readRecord(env.data);
  const batchId = typeof eventData.batchId === "string" && eventData.batchId.trim() ? eventData.batchId : undefined;
  const callId = typeof eventData.callId === "string" && eventData.callId.trim() ? eventData.callId : undefined;
  const executionMode =
    eventData.executionMode === "parallel" || eventData.executionMode === "sequential"
      ? eventData.executionMode
      : undefined;
  return {
    id: batchId ?? fallbackToolBatchId(env, callId),
    index: data?.index,
    size,
    executionMode,
  };
}

function fallbackToolBatchId(env: EventEnvelope, callId: string | undefined): string {
  return [
    env.scope?.parentRequestId,
    env.scope?.workflowName,
    env.scope?.role,
    env.scope?.jobId,
    env.requestId,
    env.step ?? 0,
    callId ? `call:${callId}` : `event:${env.sequence}`,
  ]
    .filter((value) => value !== undefined && value !== "")
    .join(":");
}

export function toolBatchForTrace(requestId: string, trace: StepTraceDto): NonNullable<TimelineStep["toolBatch"]> {
  return {
    id: trace.batchId ?? [requestId, trace.step, trace.callId ? `call:${trace.callId}` : trace.seq].join(":"),
    index: trace.seq,
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
