import type { TimelineChildRunState } from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn, formatTime } from "../../lib/util";

interface ChildRunOverviewProps {
  childRun: TimelineChildRunState;
}

export const ChildRunStatusPresentation = {
  queued: { label: "workflow.step.status.pending", dotClass: "bg-ink-300", textClass: "text-content-secondary" },
  running: { label: "workflow.run.status.running", dotClass: "bg-umber-500", textClass: "text-umber-600" },
  wrapping_up: {
    label: "workflow.childRun.status.wrappingUp",
    dotClass: "bg-umber-500",
    textClass: "text-umber-600",
  },
  cancelling: {
    label: "workflow.run.status.cancelling",
    dotClass: "bg-accent-content",
    textClass: "text-accent-content",
  },
  awaiting_supervisor: {
    label: "workflow.childRun.status.awaitingSupervisor",
    dotClass: "bg-accent-content",
    textClass: "text-accent-content",
  },
  completed: { label: "workflow.run.status.completed", dotClass: "bg-moss-500", textClass: "text-moss-600" },
  partial_completed: {
    label: "workflow.childRun.status.partialCompleted",
    dotClass: "bg-moss-500",
    textClass: "text-moss-600",
  },
  interrupted: {
    label: "workflow.childRun.status.interrupted",
    dotClass: "bg-umber-500",
    textClass: "text-umber-600",
  },
  timed_out: { label: "workflow.childRun.status.timedOut", dotClass: "bg-brick-500", textClass: "text-brick-600" },
  failed: { label: "workflow.run.status.failed", dotClass: "bg-brick-500", textClass: "text-brick-600" },
  cancelled: { label: "workflow.run.status.cancelled", dotClass: "bg-ink-400", textClass: "text-content-secondary" },
} as const satisfies Record<
  TimelineChildRunState["status"],
  {
    label: Parameters<typeof frontendMessage>[0];
    dotClass: string;
    textClass: string;
  }
>;

export function ChildRunOverview({ childRun }: ChildRunOverviewProps): JSX.Element {
  const presentation = ChildRunStatusPresentation[childRun.status];
  const activeTools = childRun.activeTools ?? [];
  const latestUpdate = [...childRun.messages]
    .reverse()
    .find((message) => message.direction === "child_to_parent" && message.content.trim());

  return (
    <section className="space-y-3" data-child-run-overview>
      <div
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-y border-line-subtle py-2.5"
        role="status"
        aria-live="polite"
      >
        <div className={cn("flex min-w-0 items-center gap-2 text-[12.5px] font-medium", presentation.textClass)}>
          <span className={cn("h-2 w-2 shrink-0 rounded-full", presentation.dotClass)} aria-hidden="true" />
          <span>{frontendMessage(presentation.label)}</span>
        </div>
        {childRun.lastActivityAt ? (
          <span className="text-[11px] text-content-muted">
            {frontendMessage("workflow.childRun.lastActivity", { time: formatTime(childRun.lastActivityAt) })}
          </span>
        ) : null}
      </div>

      <div className="space-y-2.5">
        <div className="text-[10.5px] font-medium text-content-muted">
          {frontendMessage("workflow.childRun.currentActivity")}
        </div>
        {activeTools.length > 0 ? (
          <div className="border-l-2 border-umber-400 pl-3" data-child-run-active-tools>
            <div className="text-[11.5px] text-content-secondary">
              {activeTools.length === 1
                ? frontendMessage("workflow.childRun.usingTool")
                : frontendMessage("workflow.childRun.parallelTools", { count: activeTools.length })}
            </div>
            <div className="mt-1 break-words font-mono text-[12px] text-content-primary">{activeTools.join(" · ")}</div>
          </div>
        ) : (
          <div className="text-[11.5px] text-content-secondary">
            {frontendMessage(
              childRun.status === "queued"
                ? "workflow.childRun.waitingToStart"
                : childRun.status === "cancelling"
                  ? "workflow.childRun.stoppingActivity"
                  : "workflow.childRun.processing",
            )}
          </div>
        )}
      </div>

      {latestUpdate ? (
        <div className="border-t border-line-subtle pt-3">
          <div className="mb-1 text-[10.5px] font-medium text-content-muted">
            {frontendMessage("workflow.childRun.latestUpdate")}
          </div>
          <p className="line-clamp-3 whitespace-pre-wrap break-words text-[11.5px] leading-5 text-content-primary">
            {latestUpdate.content}
          </p>
        </div>
      ) : null}

      {childRun.cancellation ? (
        <div className="flex items-center justify-between gap-3 border-t border-line-subtle pt-3 text-[11.5px]">
          <span className="text-content-muted">{frontendMessage("workflow.childRun.stopProgress")}</span>
          <span className="text-right text-content-primary">{cancellationLabel(childRun.cancellation.stage)}</span>
        </div>
      ) : null}
    </section>
  );
}

function cancellationLabel(stage: NonNullable<TimelineChildRunState["cancellation"]>["stage"]): string {
  return frontendMessage(
    stage === "completed"
      ? "run.cancellation.completed"
      : stage === "failed"
        ? "run.cancellation.failed"
        : stage === "settlement_delayed"
          ? "run.cancellation.delayed"
          : "run.cancellation.started",
  );
}
