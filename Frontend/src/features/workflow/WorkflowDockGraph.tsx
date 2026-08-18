import { lazy, Suspense, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type {
  RunActivityRecord,
  RunRecord,
  TimelineStep,
  TimelineStepKind,
  TimelineStepStatus,
} from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendFeatureMessage } from "../../i18n/frontendFeatureMessageCatalog";
import { cn, formatDurationMs } from "../../lib/util";
import { AppIcon, type AppIconName, Spinner } from "../../shared/ui";
import { WorkflowStepDetail } from "./NodeDetailDrawer";
import { runActivityLabel } from "./runActivityPresentation";
import { readStepStatusLabel } from "./stepPresentation";
import { projectToolStagePresentation } from "./toolStagePresentation";
import { ToolActionIcon } from "./ToolActionIcon";
import {
  projectWorkflowActivities,
  projectWorkflowSteps,
  readWorkflowStepDurationMs,
} from "./workflowPresentationProjection";

type DockWorkflowEntry =
  | { kind: "step"; id: string; order: number; step: TimelineStep }
  | { kind: "batch"; id: string; order: number; steps: TimelineStep[]; tools: TimelineStep[] }
  | { kind: "activity"; id: string; order: number; activity: RunActivityRecord };

const ToolStepInspector = lazy(() =>
  import("./ToolStepInspector").then((module) => ({ default: module.ToolStepInspector })),
);

const StepKindIcon: Record<TimelineStepKind, AppIconName> = {
  understand: "message",
  prompt: "file-code",
  model: "brain",
  decision: "code",
  delegation: "git-branch",
  tool: "globe",
  retry: "activity",
  answer: "message",
  error: "cancel",
};

export function WorkflowDockGraph({ run }: { run: RunRecord }): JSX.Element {
  const entries = useMemo(() => projectDockWorkflow(run), [run]);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());

  if (entries.length === 0) {
    return (
      <div className="flex min-h-40 flex-1 items-center justify-center px-6 text-center text-[12px] leading-5 text-content-secondary">
        {frontendMessage("workflow.panel.emptyDescription")}
      </div>
    );
  }

  return (
    <div
      className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-8 pt-11"
      data-workflow-dock-graph
      aria-label={frontendMessage("workflow.dock.ariaLabel")}
    >
      <div className="relative min-w-0" role="list">
        <span
          className="pointer-events-none absolute bottom-4 left-[9px] top-4 w-px bg-line-subtle"
          aria-hidden="true"
        />
        {entries.map((entry) => {
          const expanded = expandedIds.has(entry.id);
          const onToggle = (): void => setExpandedIds((current) => toggleSetEntry(current, entry.id));
          if (entry.kind === "batch") {
            return <DockBatchNode key={entry.id} entry={entry} expanded={expanded} onToggle={onToggle} />;
          }
          if (entry.kind === "activity") {
            return <DockActivityNode key={entry.id} activity={entry.activity} />;
          }
          return <DockStepNode key={entry.id} step={entry.step} expanded={expanded} onToggle={onToggle} />;
        })}
      </div>
    </div>
  );
}

export function projectDockWorkflow(run: RunRecord): DockWorkflowEntry[] {
  const steps = projectWorkflowSteps(run);
  const activities = projectWorkflowActivities(run);
  const batches = collectDockToolBatches(steps);
  const emittedBatches = new Set<string>();
  const entries: DockWorkflowEntry[] = [];

  steps.forEach((step, index) => {
    const batchId = step.toolBatch?.id;
    const batch = batchId ? batches.get(batchId) : undefined;
    if (batch) {
      if (emittedBatches.has(batchId!)) return;
      emittedBatches.add(batchId!);
      entries.push({
        kind: "batch",
        id: `batch:${batchId}`,
        order: readEntryOrder(batch.steps[0]?.startedAt, index),
        steps: batch.steps,
        tools: batch.tools,
      });
      return;
    }
    entries.push({ kind: "step", id: `step:${step.id}`, order: readEntryOrder(step.startedAt, index), step });
  });

  for (const [index, activity] of activities.entries()) {
    entries.push({
      kind: "activity",
      id: `activity:${activity.id}`,
      order: readEntryOrder(activity.startedAt, steps.length + index),
      activity,
    });
  }

  return entries.sort((left, right) => left.order - right.order);
}

function DockStepNode({
  step,
  expanded,
  onToggle,
  nested = false,
}: {
  step: TimelineStep;
  expanded: boolean;
  onToggle: () => void;
  nested?: boolean;
}): JSX.Element {
  const icon = StepKindIcon[step.kind];
  const title = readDockStepTitle(step);
  const summary = readDockStepSummary(step);
  const contentId = `dock-step-detail-${step.id}`;
  const durationMs = readWorkflowStepDurationMs(step);
  const toolPresentation = step.kind === "tool" ? projectToolStagePresentation({ steps: [step] }) : undefined;

  return (
    <div
      className={cn("relative min-w-0", nested ? "py-0.5" : "py-1")}
      role="listitem"
      data-workflow-dock-step={step.id}
      data-workflow-dock-expanded={expanded ? "true" : "false"}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-label={frontendMessage(expanded ? "workflow.dock.collapseNode" : "workflow.dock.expandNode", {
          title,
        })}
        className={cn(
          "group flex min-h-11 w-full min-w-0 items-start gap-2.5 rounded-md py-2 text-left transition-colors",
          nested ? "px-2" : "pl-0 pr-1.5",
          "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
          expanded && "text-content-primary",
        )}
      >
        <DockNodeMarker status={step.status} preserveIcon={Boolean(toolPresentation)}>
          {toolPresentation ? (
            <ToolActionIcon icon={toolPresentation.icon} status={step.status} size="xs" />
          ) : (
            <AppIcon icon={icon} size={14} aria-hidden="true" />
          )}
        </DockNodeMarker>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium leading-5 text-content-primary">
              {title}
            </span>
            <span className={cn("shrink-0 text-[10.5px]", statusTextClass(step.status))}>
              {readStepStatusLabel(step.status)}
            </span>
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] leading-4 text-content-muted">
            {summary ? <span className="min-w-0 flex-1 truncate">{summary}</span> : <span className="flex-1" />}
            {durationMs !== undefined ? (
              <span className="shrink-0 tabular-nums">{formatDurationMs(durationMs)}</span>
            ) : null}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "mt-1 h-3.5 w-3.5 shrink-0 text-content-muted transition-transform duration-200",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      {expanded ? (
        <div
          id={contentId}
          className={cn("border-l border-line-subtle pb-3 pt-1", nested ? "ml-7 pl-3" : "ml-5 pl-4 pr-1")}
        >
          {step.kind === "tool" && step.toolName ? (
            <Suspense fallback={<DockInspectorLoading />}>
              <ToolStepInspector step={step} showHeader={false} />
            </Suspense>
          ) : (
            <div className="py-3">
              <WorkflowStepDetail step={step} />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DockInspectorLoading(): JSX.Element {
  return (
    <div className="flex min-h-16 items-center gap-2 px-4 py-3 text-[11.5px] text-content-muted" role="status">
      <Spinner size="xs" />
      <span>{frontendMessage("ui.loading")}</span>
    </div>
  );
}

function DockBatchNode({
  entry,
  expanded,
  onToggle,
}: {
  entry: Extract<DockWorkflowEntry, { kind: "batch" }>;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  const [expandedStepIds, setExpandedStepIds] = useState<ReadonlySet<string>>(() => new Set());
  const summary = summarizeBatchSteps(entry.tools);
  const status = aggregateStepStatus(entry.tools);
  const title = frontendFeatureMessage("workflow.stage.toolBatch.accessible", { count: entry.tools.length });
  const contentId = `dock-batch-${entry.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;

  return (
    <div
      className="relative min-w-0 py-1"
      role="listitem"
      data-workflow-dock-batch={entry.id}
      data-workflow-dock-expanded={expanded ? "true" : "false"}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-label={frontendMessage(expanded ? "workflow.dock.collapseNode" : "workflow.dock.expandNode", {
          title,
        })}
        className={cn(
          "group flex min-h-11 w-full min-w-0 items-start gap-2.5 rounded-md py-2 pl-0 pr-1.5 text-left transition-colors",
          "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
          expanded && "text-content-primary",
        )}
      >
        <DockNodeMarker status={status} batch>
          <AppIcon icon="git-branch" size={14} aria-hidden="true" />
        </DockNodeMarker>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium leading-5 text-content-primary">
              {title}
            </span>
            {summary.finished < summary.total ? (
              <span className="shrink-0 text-[10.5px] tabular-nums text-content-muted">
                {summary.finished}/{summary.total}
              </span>
            ) : null}
          </div>
          <div
            className="mt-1 flex h-1 overflow-hidden rounded-full bg-line-subtle"
            data-workflow-batch-progress
            aria-label={readBatchProgressLabel(summary)}
          >
            <BatchProgressSegment kind="done" count={summary.done} total={summary.total} />
            <BatchProgressSegment kind="failed" count={summary.failed} total={summary.total} />
            <BatchProgressSegment kind="running" count={summary.running} total={summary.total} />
            <BatchProgressSegment kind="cancelling" count={summary.cancelling} total={summary.total} />
          </div>
        </div>
        <ChevronDown
          className={cn(
            "mt-1 h-3.5 w-3.5 shrink-0 text-content-muted transition-transform duration-200",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      {expanded ? (
        <div id={contentId} className="relative ml-[9px] border-l border-accent-border pb-2 pl-4" role="list">
          {entry.steps.map((step) => (
            <DockStepNode
              key={step.id}
              step={step}
              nested
              expanded={expandedStepIds.has(step.id)}
              onToggle={() => setExpandedStepIds((current) => toggleSetEntry(current, step.id))}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DockActivityNode({ activity }: { activity: RunActivityRecord }): JSX.Element {
  return (
    <div
      className="relative flex min-h-10 min-w-0 items-start gap-2.5 py-2"
      role="listitem"
      data-workflow-dock-activity
    >
      <DockNodeMarker status={activity.status}>
        <AppIcon icon="brain" size={14} aria-hidden="true" />
      </DockNodeMarker>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium leading-5 text-content-primary">
          {runActivityLabel(activity.activity)}
        </div>
        <div className={cn("text-[10.5px]", statusTextClass(activity.status))}>
          {readStepStatusLabel(activity.status)}
        </div>
      </div>
    </div>
  );
}

function DockNodeMarker({
  status,
  batch = false,
  preserveIcon = false,
  children,
}: {
  status: TimelineStepStatus;
  batch?: boolean;
  preserveIcon?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <span
      className={cn(
        "relative z-10 mt-0.5 grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full bg-surface-canvas ring-[3px] ring-surface-canvas",
        statusTextClass(status),
        batch && status !== "failed" && "bg-accent-surface text-accent-content",
        batch && status === "failed" && "bg-brick-50 text-brick-600",
      )}
      aria-hidden="true"
    >
      {!preserveIcon && (status === "running" || status === "cancelling") ? <Spinner size="xs" /> : children}
    </span>
  );
}

function collectDockToolBatches(
  steps: readonly TimelineStep[],
): Map<string, { steps: TimelineStep[]; tools: TimelineStep[] }> {
  const candidates = new Map<string, TimelineStep[]>();
  for (const step of steps) {
    const batchId = step.toolBatch?.id;
    if (!batchId) continue;
    const batchSteps = candidates.get(batchId) ?? [];
    batchSteps.push(step);
    candidates.set(batchId, batchSteps);
  }

  const batches = new Map<string, { steps: TimelineStep[]; tools: TimelineStep[] }>();
  for (const [batchId, batchSteps] of candidates) {
    const tools = batchSteps.filter((step) => step.kind === "tool" && !!step.toolName);
    if (tools.length === 0) continue;
    batches.set(batchId, { steps: batchSteps, tools });
  }
  return batches;
}

function readDockStepTitle(step: TimelineStep): string {
  if (step.kind === "delegation" && step.scope?.agentName) {
    return frontendMessage("workflow.scope.agentNamed", { name: step.scope.agentName });
  }
  if (step.kind === "tool" && step.toolName) return step.toolName;
  return step.title;
}

function readDockStepSummary(step: TimelineStep): string | undefined {
  if (step.toolErrorMessage || step.errorMessage) return step.toolErrorMessage || step.errorMessage;
  if (step.kind === "tool") return undefined;
  if (step.childRun?.activeTools?.length) {
    return step.childRun.activeTools.join(" · ");
  }
  if (step.toolPresentation?.summary) return step.toolPresentation.summary;
  if (step.toolPresentation?.headline) return step.toolPresentation.headline;
  if (step.toolPreview) return step.toolPreview;
  const childMessage = step.childRun?.messages?.at(-1)?.content;
  return childMessage || step.description;
}

function readEntryOrder(timestamp: string | undefined, sequence: number): number {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
  return Number.isFinite(parsed) ? parsed + sequence / 1_000_000 : Number.MAX_SAFE_INTEGER - 1_000_000 + sequence;
}

function aggregateStepStatus(steps: readonly TimelineStep[]): TimelineStepStatus {
  if (steps.some((step) => step.status === "running")) return "running";
  if (steps.some((step) => step.status === "cancelling")) return "cancelling";
  if (steps.some((step) => step.status === "pending")) return "pending";
  if (steps.length > 0 && steps.every((step) => step.status === "failed")) return "failed";
  return "done";
}

interface BatchStepSummary {
  readonly total: number;
  readonly done: number;
  readonly failed: number;
  readonly running: number;
  readonly cancelling: number;
  readonly pending: number;
  readonly finished: number;
}

function summarizeBatchSteps(steps: readonly TimelineStep[]): BatchStepSummary {
  const summary = {
    total: steps.length,
    done: 0,
    failed: 0,
    running: 0,
    cancelling: 0,
    pending: 0,
  };
  for (const step of steps) summary[step.status] += 1;
  return { ...summary, finished: summary.done + summary.failed };
}

function BatchProgressSegment({
  kind,
  count,
  total,
}: {
  kind: "done" | "failed" | "running" | "cancelling";
  count: number;
  total: number;
}): JSX.Element | null {
  if (count === 0 || total === 0) return null;
  const className = {
    done: "bg-moss-500",
    failed: "bg-brick-500",
    running: "bg-umber-500",
    cancelling: "bg-accent-solid",
  }[kind];
  return (
    <span
      className={cn("block h-full transition-[width] duration-300", className)}
      style={{ width: `${(count / total) * 100}%` }}
      data-workflow-batch-segment={kind}
      data-count={count}
      aria-hidden="true"
    />
  );
}

function readBatchProgressLabel(summary: BatchStepSummary): string {
  return [
    frontendFeatureMessage("workflow.dock.batchSucceeded", { count: summary.done }),
    frontendFeatureMessage("workflow.dock.batchFailed", { count: summary.failed }),
    frontendFeatureMessage("workflow.dock.batchRunning", { count: summary.running + summary.cancelling }),
    frontendFeatureMessage("workflow.dock.batchPending", { count: summary.pending }),
  ].join(" · ");
}

function statusTextClass(status: TimelineStepStatus): string {
  if (status === "failed") return "text-brick-600";
  if (status === "running") return "text-umber-600";
  if (status === "cancelling") return "text-accent-content";
  if (status === "done") return "text-content-muted";
  return "text-content-muted";
}

function toggleSetEntry(values: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export default WorkflowDockGraph;
