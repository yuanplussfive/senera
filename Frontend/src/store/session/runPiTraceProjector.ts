import { EventKinds, type PiTraceData } from "../../api/eventTypes";
import { readCurrentRun, type RunEventHandlerMap } from "./runEventProjectionTypes";
import { upsertStep } from "./sessionProjectorCore";
import { timelineScopeFromEvent } from "./timelineProjection";
import type { TimelineStepStatus } from "./types";

type PiTraceLifecycle = {
  baseEventType: string;
  status: TimelineStepStatus;
  completed: boolean;
};

export const runPiTraceEventHandlers = {
  [EventKinds.PiTrace]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;

    const data = env.data as PiTraceData;
    const lifecycle = readPiTraceLifecycle(data.eventType);
    const stepId = buildPiTraceStepId(data, lifecycle);
    const existing = run.steps.find((step) => step.id === stepId);
    upsertStep(run, {
      id: stepId,
      kind: "pi",
      title: readPiTraceTitle(data),
      description: data.summary,
      status: lifecycle.status,
      startedAt: existing?.startedAt ?? env.timestamp,
      endedAt: lifecycle.completed ? env.timestamp : undefined,
      scope: timelineScopeFromEvent(env),
      traceSource: data.source,
      eventType: data.eventType,
      detailJson: data.payload ?? data,
    });
  },
} satisfies RunEventHandlerMap;

function buildPiTraceStepId(data: PiTraceData, lifecycle: PiTraceLifecycle): string {
  return ["pi", data.source, lifecycle.baseEventType].join(":");
}

function readPiTraceTitle(data: PiTraceData): string {
  return ["Pi", data.source, data.eventType].filter(Boolean).join(" · ");
}

function readPiTraceLifecycle(eventType: string): PiTraceLifecycle {
  const started = stripEventSuffix(eventType, ".started");
  if (started) {
    return {
      baseEventType: started,
      status: "running",
      completed: false,
    };
  }

  const completed = stripEventSuffix(eventType, ".completed") ?? stripEventSuffix(eventType, ".ended");
  if (completed) {
    return {
      baseEventType: completed,
      status: "done",
      completed: true,
    };
  }

  const failed = stripEventSuffix(eventType, ".failed");
  if (failed) {
    return {
      baseEventType: failed,
      status: "failed",
      completed: true,
    };
  }

  return {
    baseEventType: eventType,
    status: "done",
    completed: true,
  };
}

function stripEventSuffix(value: string, suffix: string): string | undefined {
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : undefined;
}
