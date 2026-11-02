import type { RunRecord, TimelineStep } from "../../store/session/types";
import { frontendFeatureMessage as t } from "../../i18n/frontendFeatureMessageCatalog";
import { inspectionScopeId, inspectionSteps } from "./inspectionScopeModel";
import { projectDockToolSummary } from "../workflow/dockToolSummary";
import { readWorkflowStepDurationMs } from "../workflow/workflowPresentationProjection";

export type ExecutionFilter = "all" | "model" | "tool" | "failed";
interface ParallelExecution {
  id: string;
  count: number;
  failed: number;
  active: number;
  collapsed: boolean;
}

export type ExecutionInspectionRow =
  | {
      kind: "turn";
      id: string;
      run: RunRecord;
      turn: number;
      requests: number;
      tools: number;
      failed: number;
      collapsed: boolean;
    }
  | { kind: "scope"; id: string; label: string }
  | {
      kind: "step";
      id: string;
      run: RunRecord;
      step: TimelineStep;
      request?: number;
      nested: boolean;
      parallel?: ParallelExecution;
    };

const InspectableKinds = new Set<TimelineStep["kind"]>(["model", "delegation", "retry", "error"]);

export function isExecutionStep(step: TimelineStep): boolean {
  return InspectableKinds.has(step.kind) || Boolean(step.callId);
}

export function executionStepSummary(step: TimelineStep): string | undefined {
  if (step.errorMessage || step.toolErrorMessage) return step.errorMessage ?? step.toolErrorMessage;
  if (step.childRun) return step.childRun.taskLabel;
  if (step.kind === "tool") return step.toolPresentation?.headline;
  if (step.kind === "model") return undefined;
  return step.description;
}

/** Action and target come from the owning tool's declarative presentation. */
export function executionToolSummary(step: TimelineStep) {
  return step.toolName ? projectDockToolSummary({ ...step, toolName: step.toolName }) : undefined;
}

/** Group actual execution records. Prompt diagnostics and plan placeholders have their own surfaces. */
export function executionInspectionRows(
  runs: readonly RunRecord[],
  {
    scopeId,
    filter,
    search,
    turnNumbers,
    collapsedBatches = [],
    collapsedTurns = [],
    historyLimit,
  }: {
    scopeId?: string;
    filter: ExecutionFilter;
    search: string;
    turnNumbers?: ReadonlyMap<string, number>;
    collapsedBatches?: readonly string[];
    collapsedTurns?: readonly string[];
    historyLimit?: number;
  },
): ExecutionInspectionRow[] {
  const turns = turnNumbers ?? new Map(runs.map((run, index) => [run.requestId, index + 1]));
  const collapsed = new Set(collapsedBatches);
  const foldedTurns = new Set(collapsedTurns);
  const narrow = filter !== "all" || Boolean(search);
  const records = runs.map((run) => ({
    run,
    steps: inspectionSteps(run, scopeId).filter(isExecutionStep),
  }));
  let skip =
    narrow || historyLimit === undefined
      ? 0
      : Math.max(0, records.reduce((n, entry) => n + entry.steps.length, 0) - historyLimit);
  return records.flatMap(({ run, steps: allSteps }) => {
    const steps = allSteps.slice(Math.min(skip, allSteps.length));
    skip = Math.max(0, skip - allSteps.length);
    if (steps.length === 0) return [];
    const hidden = !narrow && foldedTurns.has(run.requestId);
    const scopes = new Map<string, TimelineStep[]>();
    for (const step of steps) {
      const id = inspectionScopeId(step.scope);
      const group = scopes.get(id) ?? [];
      group.push(step);
      scopes.set(id, group);
    }
    const rows: ExecutionInspectionRow[] = [];
    const requests = new Map<string, number>();
    const scopedRequests = new Map<string, number>();
    for (const step of allSteps) {
      if (step.kind !== "model") continue;
      const scope = inspectionScopeId(step.scope);
      const number = (scopedRequests.get(scope) ?? 0) + 1;
      scopedRequests.set(scope, number);
      requests.set(step.id, number);
    }
    for (const [id, scoped] of scopes) {
      const matches = scoped.flatMap((step): Extract<ExecutionInspectionRow, { kind: "step" }>[] => {
        if (filter !== "all" && step.kind !== filter && step.status !== filter) return [];
        const text = search
          ? [
              step.title,
              step.toolName,
              step.modelName,
              step.scope?.agentName,
              executionStepSummary(step),
              step.callId ? executionToolSummary(step)?.accessibleLabel : undefined,
            ].join(" ")
          : "";
        if (!text.toLocaleLowerCase().includes(search)) return [];
        return [
          {
            kind: "step",
            id: step.id,
            run,
            step,
            request: requests.get(step.id),
            nested: Boolean(step.callId),
          },
        ];
      });
      if (matches.length === 0) continue;
      if (scopes.size > 1)
        rows.push({
          kind: "scope",
          id: `${run.requestId}:scope:${id}`,
          label: scoped[0]?.scope?.agentName ?? t("insights.agent.main"),
        });
      rows.push(...(filter === "all" && !search ? groupParallelExecutions(matches, collapsed) : matches));
    }
    if (rows.length === 0) return [];
    return [
      {
        kind: "turn",
        id: `${run.requestId}:turn`,
        run,
        turn: turns.get(run.requestId)!,
        requests: allSteps.filter((step) => step.kind === "model").length,
        tools: allSteps.filter((step) => Boolean(step.callId)).length,
        failed: allSteps.filter((step) => step.status === "failed").length,
        collapsed: hidden,
      } satisfies ExecutionInspectionRow,
      ...(hidden ? [] : rows),
    ];
  });
}

export interface ExecutionTiming {
  readonly id: string;
  readonly kind: "model" | "tool";
  readonly step: TimelineStep;
  readonly start: number;
  readonly end?: number;
}

/** Recorded timing only: an in-flight call has a start marker, never an invented span. */
export function executionTimings(rows: readonly ExecutionInspectionRow[]): ExecutionTiming[] {
  return rows.flatMap((row) => {
    if (row.kind !== "step" || (row.step.kind !== "model" && !row.step.callId)) return [];
    const start = Date.parse(row.step.startedAt);
    if (!Number.isFinite(start)) return [];
    const duration = readWorkflowStepDurationMs(row.step);
    const end =
      duration !== undefined &&
      row.step.status !== "running" &&
      row.step.status !== "cancelling" &&
      row.step.status !== "pending"
        ? start + duration
        : undefined;
    return [{ id: row.id, kind: row.step.callId ? ("tool" as const) : ("model" as const), step: row.step, start, end }];
  });
}

/** A batch is declared by the host. Adjacent calls keep their actual execution order. */
function groupParallelExecutions(
  steps: readonly Extract<ExecutionInspectionRow, { kind: "step" }>[],
  collapsed: ReadonlySet<string>,
): ExecutionInspectionRow[] {
  const rows: ExecutionInspectionRow[] = [];
  for (let index = 0; index < steps.length;) {
    const first = steps[index]!;
    const batch = first.step.callId ? first.step.toolBatch : undefined;
    let end = index + 1;
    if (batch?.executionMode === "parallel") {
      while (
        end < steps.length &&
        steps[end]!.step.callId &&
        steps[end]!.step.toolBatch?.id === batch.id &&
        steps[end]!.step.toolBatch?.executionMode === "parallel"
      )
        end++;
    }
    if (end - index > 1) {
      const id = `${first.id}:parallel`;
      const hidden = collapsed.has(id);
      const calls = steps.slice(index, end);
      rows.push({
        ...first,
        parallel: {
          id,
          count: calls.length,
          failed: calls.filter(({ step }) => step.status === "failed").length,
          active: calls.filter(({ step }) => step.status === "running" || step.status === "cancelling").length,
          collapsed: hidden,
        },
      });
      if (!hidden) rows.push(...calls.slice(1));
    } else rows.push(first);
    index = end;
  }
  return rows;
}
