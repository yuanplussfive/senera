import type { RunActivity } from "../../api/eventTypes";
import type { RunActivityRecord, RunRecord, TimelineStep } from "../../store/sessionStore";

/**
 * Projects the complete runtime trace into the user-facing workflow. Runtime
 * telemetry remains on the run for diagnostics and replay.
 */
export function projectWorkflowSteps(run: Pick<RunRecord, "steps">): TimelineStep[] {
  const detailedAnswers = new Set(
    run.steps
      .filter((step) => step.kind === "answer" && Boolean(step.description?.trim()))
      .map(answerSemanticKind),
  );
  const answerTraces = collectMeasuredAnswerTraces(run.steps);

  return run.steps
    .map((step, index) => projectModelDuration(run.steps, step, index))
    .map((step) => projectAnswerTraceDuration(step, answerTraces))
    .filter(isWorkflowStepVisible)
    .filter((step) => !isSupersededAnswerTrace(step, detailedAnswers));
}

export function projectWorkflowActivities(
  run: Pick<RunRecord, "activities">,
): RunActivityRecord[] {
  return (run.activities ?? []).filter(isWorkflowActivityVisible);
}

export function isWorkflowStepVisible(step: TimelineStep): boolean {
  switch (step.kind) {
    case "model":
      return false;
    default:
      return true;
  }
}

export function isWorkflowActivityVisible(activity: RunActivityRecord): boolean {
  return (
    activity.status === "failed" ||
    (activity.status !== "done" && isWorkflowLiveActivityVisible(activity.activity))
  );
}

export function isWorkflowLiveActivityVisible(activity: RunActivity | undefined): boolean {
  return activity === "compacting_context";
}

function isSupersededAnswerTrace(step: TimelineStep, detailedAnswers: ReadonlySet<string>): boolean {
  return step.kind === "answer" && !step.description?.trim() && detailedAnswers.has(answerSemanticKind(step));
}

function answerSemanticKind(step: TimelineStep): string {
  switch (step.decisionKind) {
    case "ask_user":
    case "AskUser":
      return "ask_user";
    case "final_answer":
    case "FinalAnswer":
    case "answer":
      return "final_answer";
    default:
      return "answer";
  }
}

function collectMeasuredAnswerTraces(steps: readonly TimelineStep[]): ReadonlyMap<string, TimelineStep[]> {
  const traces = new Map<string, TimelineStep[]>();
  for (const step of steps) {
    if (step.kind !== "answer" || step.description?.trim() || !hasMeasuredDuration(step)) continue;
    const kind = answerSemanticKind(step);
    const matches = traces.get(kind) ?? [];
    matches.push(step);
    traces.set(kind, matches);
  }
  return traces;
}

function projectAnswerTraceDuration(
  step: TimelineStep,
  traces: ReadonlyMap<string, readonly TimelineStep[]>,
): TimelineStep {
  if (step.kind !== "answer" || !step.description?.trim() || hasMeasuredDuration(step)) return step;
  const matches = traces.get(answerSemanticKind(step));
  if (matches?.length !== 1) return step;
  return { ...step, durationMs: readWorkflowStepDurationMs(matches[0]) };
}

function projectModelDuration(
  steps: readonly TimelineStep[],
  step: TimelineStep,
  index: number,
): TimelineStep {
  if ((step.kind !== "decision" && step.kind !== "answer") || hasMeasuredDuration(step)) return step;

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = steps[cursor];
    if (!sameWorkflowScope(candidate, step)) continue;
    if (candidate.kind === "tool" || candidate.kind === "decision" || candidate.kind === "answer") break;
    if (candidate.kind !== "model" || !hasMeasuredDuration(candidate)) continue;
    return { ...step, durationMs: readWorkflowStepDurationMs(candidate) };
  }
  return step;
}

function sameWorkflowScope(left: TimelineStep, right: TimelineStep): boolean {
  return (
    left.scope?.parentRequestId === right.scope?.parentRequestId &&
    left.scope?.childRunId === right.scope?.childRunId &&
    left.scope?.jobId === right.scope?.jobId &&
    left.scope?.role === right.scope?.role
  );
}

function hasMeasuredDuration(step: Pick<TimelineStep, "startedAt" | "endedAt" | "durationMs">): boolean {
  return readWorkflowStepDurationMs(step) !== undefined;
}

export function readWorkflowStepDurationMs(
  step: Pick<TimelineStep, "startedAt" | "endedAt" | "durationMs">,
): number | undefined {
  if (typeof step.durationMs === "number" && Number.isFinite(step.durationMs) && step.durationMs > 0) {
    return step.durationMs;
  }
  if (!step.endedAt) return undefined;
  const start = Date.parse(step.startedAt);
  const end = Date.parse(step.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
  return end - start;
}
