import type { EventEnvelope, StepTraceDto } from "../../api/eventTypes";
import type { TimelineStep } from "./types";

/**
 * Terminal assistant messages can arrive both as a live event step and as a
 * durable answer trace. The two records have different storage ids, so the
 * semantic key is used when reconciling those projections.
 */
export function assistantTerminalStepKey(
  step: Pick<TimelineStep, "kind" | "decisionKind">,
): string | undefined {
  if (step.kind !== "answer") return undefined;
  return `answer:${step.decisionKind?.trim() || "final_answer"}`;
}

export function isAssistantMessageStep(step: Pick<TimelineStep, "detailJson">): boolean {
  if (!isRecord(step.detailJson)) return false;
  return typeof step.detailJson.messageId === "string" && typeof step.detailJson.kind === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function timelineScopeFromEvent(env: EventEnvelope): TimelineStep["scope"] | undefined {
  if (!env.scope) return undefined;
  return {
    parentSessionId: env.scope.parentSessionId,
    parentRequestId: env.scope.parentRequestId,
    parentAgentStep: env.scope.parentAgentStep,
    parentModelMessageIndex: env.scope.parentModelMessageIndex,
    parentModelContentIndex: env.scope.parentModelContentIndex,
    parentToolCallId: env.scope.parentToolCallId,
    workflowName: env.scope.workflowName,
    jobId: env.scope.jobId,
    childRunId: env.scope.childRunId,
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
    env.scope?.parentSessionId,
    env.scope?.parentRequestId,
    env.scope?.workflowName,
    env.scope?.role,
    env.scope?.jobId,
    env.scope?.childRunId,
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

import { unknownRecordOrEmpty as readRecord } from "../../lib/unknownValue";
