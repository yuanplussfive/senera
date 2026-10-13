import type { TimelineChildRunState } from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn, formatTime } from "../../lib/util";
import { ExecutionStatusTones } from "../../shared/ui";

const ActiveChildRunStatuses = new Set<TimelineChildRunState["status"]>([
  "queued",
  "running",
  "wrapping_up",
  "cancelling",
  "awaiting_supervisor",
]);

export function isChildRunActive(status: TimelineChildRunState["status"]): boolean {
  return ActiveChildRunStatuses.has(status);
}

interface ChildRunOverviewProps {
  childRun: TimelineChildRunState;
}

export const ChildRunStatusPresentation = {
  queued: { label: "workflow.step.status.pending", ...ExecutionStatusTones.pending },
  running: { label: "workflow.run.status.running", ...ExecutionStatusTones.running },
  wrapping_up: { label: "workflow.childRun.status.wrappingUp", ...ExecutionStatusTones.running },
  cancelling: { label: "workflow.run.status.cancelling", ...ExecutionStatusTones.cancelling },
  awaiting_supervisor: { label: "workflow.childRun.status.awaitingSupervisor", ...ExecutionStatusTones.cancelling },
  completed: { label: "workflow.run.status.completed", ...ExecutionStatusTones.completed },
  partial_completed: { label: "workflow.childRun.status.partialCompleted", ...ExecutionStatusTones.completed },
  interrupted: { label: "workflow.childRun.status.interrupted", ...ExecutionStatusTones.running },
  timed_out: { label: "workflow.childRun.status.timedOut", ...ExecutionStatusTones.failed },
  failed: { label: "workflow.run.status.failed", ...ExecutionStatusTones.failed },
  cancelled: { label: "workflow.run.status.cancelled", ...ExecutionStatusTones.cancelled },
} as const satisfies Record<
  TimelineChildRunState["status"],
  {
    label: Parameters<typeof frontendMessage>[0];
    text: string;
    dot: string;
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
        <div className={cn("flex min-w-0 items-center gap-2 text-[12.5px] font-medium", presentation.text)}>
          <span className={cn("h-2 w-2 shrink-0 rounded-full", presentation.dot)} aria-hidden="true" />
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
          <div className="border-l-2 border-accent-400 pl-3" data-child-run-active-tools>
            <div className="text-[11.5px] text-content-secondary">
              {activeTools.length === 1
                ? frontendMessage("workflow.childRun.usingTool")
                : frontendMessage("workflow.childRun.parallelTools", { count: activeTools.length })}
            </div>
            <div className="mt-1 break-words text-[12px] text-content-primary">{activeTools.join(" · ")}</div>
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
