import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { RunRecord, TimelineChildRunState, TimelineStep } from "../../store/sessionStore";
import { cn, formatDuration, formatTime } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { FluidHoverHighlight, useFluidHover, useMotionLevel, type UseFluidHoverReturn } from "../../shared/motion";
import { summarizeRun } from "./runSummary";
import { RunSummaryStrip } from "./WorkflowRunControls";
import { ChildRunStatusPresentation, isChildRunActive } from "./ChildRunOverview";
import { NodeDetailDrawer } from "./NodeDetailDrawer";
import { textShimmerStyle } from "../../shared/motion";
import { AppIcon } from "../../shared/ui";

const CHILD_RUN_ACCENTS = [
  { rail: "bg-accent-solid", soft: "bg-accent-surface", text: "text-accent-content", progress: "bg-accent-solid" },
  { rail: "bg-umber-500", soft: "bg-umber-50", text: "text-umber-600", progress: "bg-umber-500" },
  { rail: "bg-moss-500", soft: "bg-moss-50", text: "text-moss-600", progress: "bg-moss-500" },
  { rail: "bg-brick-500", soft: "bg-brick-50", text: "text-brick-600", progress: "bg-brick-500" },
  { rail: "bg-ink-500", soft: "bg-ink-100", text: "text-ink-700", progress: "bg-ink-500" },
] as const;

export function ChildRunBoard({ run }: { run: RunRecord }): JSX.Element {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const childSteps = useMemo(() => readChildRunSteps(run.steps), [run.steps]);
  const selectedStep = childSteps.find((step) => step.id === selectedStepId) ?? null;
  const activeSteps = childSteps.filter((step) => isChildRunActive(step.childRun!.status));
  const settledSteps = childSteps.filter((step) => !isChildRunActive(step.childRun!.status));
  const { disableMotion } = useMotionLevel();
  const activeListRef = useRef<HTMLDivElement>(null);
  const settledListRef = useRef<HTMLDivElement>(null);
  const activeHover = useFluidHover(activeListRef, { axis: "y" });
  const settledHover = useFluidHover(settledListRef, { axis: "y" });
  const summary = summarizeRun(run);
  const runProgress = childSteps.length > 0 ? readRunProgress(childSteps) : undefined;

  useEffect(() => {
    if (!selectedStepId) return;
    if (selectedStep) return;
    setSelectedStepId(null);
  }, [selectedStep, selectedStepId]);

  return (
    <section
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent"
      aria-label={frontendMessage("workflow.childRun.board.title")}
      data-child-run-board
    >
      <header className="shrink-0 border-b border-line-subtle px-3 pb-3 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <AppIcon icon="git-branch" size={16} className="shrink-0 text-content-secondary" aria-hidden="true" />
          <h2 className="truncate text-[13px] font-semibold text-content-primary">
            {frontendMessage("workflow.childRun.board.title")}
          </h2>
          <span aria-live="polite" className="ml-auto shrink-0 text-[10.5px] tabular-nums text-content-muted">
            {frontendMessage("workflow.feed.running")} {activeSteps.length}
          </span>
        </div>
        <p className="mt-2 line-clamp-2 break-words text-[11.5px] leading-5 text-content-secondary">
          {run.input || frontendMessage("workflow.run.emptyInput")}
        </p>
        {runProgress !== undefined ? (
          <div className="mt-2 flex items-center gap-2">
            <RunSummaryStrip run={run} summary={summary} />
            <div className="ml-auto flex min-w-0 items-center gap-1.5">
              <div
                className="h-1.5 w-16 overflow-hidden rounded-full bg-line-subtle"
                role="progressbar"
                aria-label={`${frontendMessage("workflow.childRun.message.progress")} ${runProgress}%`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={runProgress}
              >
                <span
                  className="block h-full w-full origin-left rounded-full bg-moss-500 transition-transform duration-300"
                  style={{ transform: `scaleX(${runProgress / 100})` }}
                />
              </div>
              <span className="shrink-0 text-[10px] tabular-nums text-content-muted">{runProgress}%</span>
            </div>
          </div>
        ) : (
          <div className="mt-2">
            <RunSummaryStrip run={run} summary={summary} />
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {activeSteps.length > 0 ? (
          <BoardGroup
            label={frontendMessage("workflow.childRun.board.active")}
            listRef={activeListRef}
            hover={activeHover}
            disableMotion={disableMotion}
          >
            {activeSteps.map((step, index) => (
              <ChildRunTimelineItem
                key={step.id}
                itemRef={activeHover.getItemRef(index)}
                fluidHoverEnabled={!disableMotion}
                step={step}
                accentIndex={index}
                animateActivity
                onSelect={() => setSelectedStepId(step.id)}
              />
            ))}
          </BoardGroup>
        ) : null}

        {settledSteps.length > 0 ? (
          <BoardGroup
            label={frontendMessage("workflow.childRun.board.settled")}
            listRef={settledListRef}
            hover={settledHover}
            disableMotion={disableMotion}
          >
            {settledSteps.map((step, index) => (
              <ChildRunTimelineItem
                key={step.id}
                itemRef={settledHover.getItemRef(index)}
                fluidHoverEnabled={!disableMotion}
                step={step}
                accentIndex={activeSteps.length + index}
                animateActivity={false}
                onSelect={() => setSelectedStepId(step.id)}
              />
            ))}
          </BoardGroup>
        ) : null}

        {childSteps.length === 0 ? (
          <div className="flex min-h-[180px] items-center justify-center px-4 text-center text-[12px] leading-5 text-content-secondary">
            {frontendMessage("workflow.childRun.board.empty")}
          </div>
        ) : null}
      </div>

      <NodeDetailDrawer step={selectedStep} onClose={() => setSelectedStepId(null)} />
    </section>
  );
}

export default ChildRunBoard;

function BoardGroup({
  label,
  children,
  listRef,
  hover,
  disableMotion,
}: {
  label: string;
  children: ReactNode;
  listRef: RefObject<HTMLDivElement | null>;
  hover: UseFluidHoverReturn;
  disableMotion: boolean;
}): JSX.Element {
  return (
    <section className="space-y-1.5" aria-label={label}>
      <div className="flex items-center gap-2 px-1">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-content-muted">{label}</h3>
        <span className="h-px flex-1 bg-line-subtle" aria-hidden="true" />
      </div>
      <div
        ref={listRef}
        className="relative space-y-1.5 pl-4 before:absolute before:bottom-3 before:left-[5px] before:top-3 before:w-px before:bg-line-subtle"
        {...hover.handlers}
      >
        <FluidHoverHighlight hover={hover} hidden={disableMotion} className="rounded-md" />
        {children}
      </div>
    </section>
  );
}

function ChildRunTimelineItem({
  itemRef,
  fluidHoverEnabled,
  step,
  accentIndex,
  animateActivity,
  onSelect,
}: {
  itemRef: (element: HTMLElement | null) => void;
  fluidHoverEnabled: boolean;
  step: TimelineStep;
  accentIndex: number;
  animateActivity: boolean;
  onSelect: () => void;
}): JSX.Element {
  const childRun = step.childRun!;
  const presentation = ChildRunStatusPresentation[childRun.status];
  const totalTools = childRun.toolCalls?.planned ?? 0;
  const completedTools = childRun.toolCalls?.completed ?? 0;
  const failedTools = childRun.toolCalls?.failed ?? 0;
  const agentName = step.scope?.agentName || frontendMessage("workflow.childRun.board.agentFallback");
  const accent = CHILD_RUN_ACCENTS[accentIndex % CHILD_RUN_ACCENTS.length];
  const progress = readChildRunProgress(childRun);

  return (
    <button
      type="button"
      ref={itemRef}
      onClick={onSelect}
      className={cn(
        "group relative z-10 w-full border-b border-line-subtle border-l-[3px] bg-transparent px-2.5 py-2 text-left transition-[border-color,background-color,box-shadow] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
        fluidHoverEnabled ? "hover:bg-transparent" : "hover:bg-surface-hover",
        accent.rail,
        (childRun.status === "failed" || childRun.status === "timed_out") && "border-brick-300",
      )}
      data-child-run-item
      data-child-run-card
      data-child-run-status={childRun.status}
    >
      <span
        className={cn(
          "absolute -left-[18px] top-2 grid h-[11px] w-[11px] place-items-center rounded-full border-2 border-surface-raised",
          accent.soft,
          accent.text,
        )}
        aria-hidden="true"
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", accent.rail)} />
      </span>
      <div className="flex min-w-0 items-center gap-2">
        <ChildRunStatusIcon status={childRun.status} className={presentation.text} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-content-primary">{agentName}</span>
        <span className={cn("shrink-0 text-[10.5px] font-medium", presentation.text)}>
          {frontendMessage(presentation.label)}
        </span>
      </div>

      <div
        className={cn(
          "mt-1 line-clamp-1 break-words text-[11.5px] leading-5 text-content-secondary",
          animateActivity && "motion-safe:animate-text-shimmer",
        )}
        data-live-activity-text={animateActivity || undefined}
        style={textShimmerStyle(readChildRunActivity(childRun))}
      >
        {readChildRunActivity(childRun)}
      </div>

      {totalTools > 0 || !isChildRunActive(childRun.status) ? (
        <div className="mt-2 flex items-center gap-2">
          <div
            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line-subtle"
            role="progressbar"
            aria-label={`${frontendMessage("workflow.childRun.message.progress")} ${agentName} ${progress}%`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span
              className={cn(
                "block h-full w-full origin-left rounded-full transition-transform duration-300",
                accent.progress,
              )}
              style={{
                transform:
                  totalTools > 0 || !isChildRunActive(childRun.status) ? `scaleX(${progress / 100})` : "scaleX(0.5)",
              }}
            />
          </div>
          <span className="shrink-0 text-[10px] tabular-nums text-content-muted">
            {totalTools > 0
              ? frontendMessage("workflow.childRun.board.toolCompletion", {
                  completed: completedTools + failedTools,
                  total: totalTools,
                })
              : `${progress}%`}
          </span>
        </div>
      ) : null}

      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] tabular-nums text-content-muted">
        {totalTools > 0 ? (
          <span>
            {frontendMessage("workflow.summary.tools")} {totalTools}
          </span>
        ) : null}
        {failedTools > 0 ? (
          <span className="text-brick-600">{frontendMessage("workflow.feed.failedCount", { count: failedTools })}</span>
        ) : null}
        {childRun.checkpointAvailable ? (
          <span className="inline-flex items-center gap-1 text-moss-600">
            <AppIcon icon="flag" size={12} aria-hidden="true" />
            {frontendMessage("workflow.childRun.board.checkpoint")}
          </span>
        ) : null}
        {childRun.lastActivityAt ? <span>{formatTime(childRun.lastActivityAt)}</span> : null}
        {step.startedAt ? <span className="ml-auto">{formatDuration(step.startedAt, step.endedAt)}</span> : null}
      </div>
    </button>
  );
}

function ChildRunStatusIcon({
  status,
  className,
}: {
  status: TimelineChildRunState["status"];
  className: string;
}): JSX.Element {
  if (status === "awaiting_supervisor") {
    return <AppIcon icon="clock" size={14} className={className} />;
  }
  if (isChildRunActive(status)) return <AppIcon icon="circle" size={14} className={className} />;
  if (status === "failed" || status === "timed_out") return <AppIcon icon="warning" size={14} className={className} />;
  if (status === "completed" || status === "partial_completed" || status === "interrupted") {
    return <AppIcon icon="checkmark" size={14} className={className} />;
  }
  if (status === "cancelled") return <AppIcon icon="close" size={14} className={className} />;
  return <AppIcon icon="circle" size={14} className={className} />;
}

function readChildRunActivity(childRun: TimelineChildRunState): string {
  const activeTools = childRun.activeTools ?? [];
  if (activeTools.length === 1) {
    return `${frontendMessage("workflow.childRun.usingTool")} · ${activeTools[0]}`;
  }
  if (activeTools.length > 1) {
    return `${frontendMessage("workflow.childRun.parallelTools", { count: activeTools.length })} · ${activeTools.join(" · ")}`;
  }
  const latestMessage = [...childRun.messages]
    .reverse()
    .find((message) => message.direction === "child_to_parent" && message.content.trim());
  if (latestMessage) return latestMessage.content;
  return frontendMessage(
    childRun.status === "queued"
      ? "workflow.childRun.waitingToStart"
      : childRun.status === "cancelling"
        ? "workflow.childRun.stoppingActivity"
        : childRun.status === "awaiting_supervisor"
          ? "workflow.childRun.status.awaitingSupervisor"
          : "workflow.childRun.processing",
  );
}

function readChildRunSteps(steps: readonly TimelineStep[]): TimelineStep[] {
  const seen = new Set<string>();
  return steps.filter((step) => {
    const childRunId = step.childRun?.id;
    if (!childRunId || seen.has(childRunId)) return false;
    seen.add(childRunId);
    return true;
  });
}

function readChildRunProgress(childRun: TimelineChildRunState): number {
  const total = childRun.toolCalls?.planned ?? 0;
  if (total > 0) {
    const completed = Math.min(total, (childRun.toolCalls?.completed ?? 0) + (childRun.toolCalls?.failed ?? 0));
    return Math.round((completed / total) * 100);
  }
  return isChildRunActive(childRun.status) ? 8 : 100;
}

function readRunProgress(steps: readonly TimelineStep[]): number {
  if (steps.length === 0) return 0;
  const finished = steps.filter((step) => step.status === "done" || step.status === "failed").length;
  return Math.round((finished / steps.length) * 100);
}
