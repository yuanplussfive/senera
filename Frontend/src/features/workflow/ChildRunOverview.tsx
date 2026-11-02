import type { TimelineChildRunState } from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn, formatTime } from "../../lib/util";
import { ActivityStatusIcon } from "../../shared/ui";
import { childRunStatus, isChildRunActive } from "./childRunPresentation";
import "./childRuns.css";

export function ChildRunMetrics({ childRun }: { childRun: TimelineChildRunState }): JSX.Element {
  const tools = childRun.toolCalls;
  const todo = childRun.todo;
  return (
    <>
      {tools && tools.planned > 0 ? (
        <span>
          {frontendMessage("workflow.childRun.board.tools", {
            completed: tools.completed + tools.failed,
            total: tools.planned,
          })}
        </span>
      ) : null}
      {tools && tools.failed > 0 ? (
        <span className="text-brick-600">{frontendMessage("workflow.feed.failedCount", { count: tools.failed })}</span>
      ) : null}
      {todo?.planObserved && todo.counts.total > 0 ? (
        <span>
          {frontendMessage("workflow.childRun.card.todoProgress", {
            completed: todo.counts.completed,
            total: todo.counts.total,
          })}
        </span>
      ) : null}
    </>
  );
}

export function ChildRunOverview({ childRun }: { childRun: TimelineChildRunState }): JSX.Element {
  const presentation = childRunStatus(childRun.status);
  const activeTools = childRun.activeTools ?? [];
  return (
    <section className="child-run-overview" data-child-run-overview>
      <div className="flex min-w-0 items-center gap-2" role="status">
        <ActivityStatusIcon status={presentation.activity} size={15} motion="spin" />
        <span className={cn("text-[12px] font-medium", presentation.text)}>{frontendMessage(presentation.label)}</span>
        {childRun.lastActivityAt ? (
          <time
            className="ml-auto shrink-0 text-[11px] tabular-nums text-content-muted"
            dateTime={childRun.lastActivityAt}
          >
            {formatTime(childRun.lastActivityAt)}
          </time>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums text-content-muted">
        <ChildRunMetrics childRun={childRun} />
        {childRun.checkpointAvailable ? <span>{frontendMessage("workflow.childRun.board.checkpoint")}</span> : null}
      </div>
      {childRun.taskLabel ? (
        <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-content-primary">
          {childRun.taskLabel}
        </p>
      ) : null}
      {isChildRunActive(childRun.status) && activeTools.length > 0 ? (
        <p
          className="truncate text-[11px] text-content-secondary"
          title={activeTools.join(" · ")}
          data-child-run-active-tools
        >
          {frontendMessage("workflow.childRun.usingTool")} · {activeTools.join(" · ")}
        </p>
      ) : null}
      {childRun.todo?.items?.length ? (
        <ul className="child-run-todos">
          {childRun.todo.items.map((item, index) => (
            <li key={index} data-status={item.status}>
              <ActivityStatusIcon
                size={13}
                motion="none"
                status={
                  item.status === "in_progress"
                    ? "running"
                    : item.status === "completed"
                      ? "completed"
                      : item.status === "cancelled"
                        ? "cancelled"
                        : "pending"
                }
                aria-label={frontendMessage(
                  item.status === "in_progress"
                    ? "workflow.childRun.todo.status.inProgress"
                    : item.status === "completed"
                      ? "workflow.childRun.todo.status.completed"
                      : item.status === "cancelled"
                        ? "workflow.childRun.todo.status.cancelled"
                        : "workflow.childRun.todo.status.pending",
                )}
              />
              <span>{item.content}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {childRun.cancellation ? (
        <div className="flex justify-between gap-3 text-[11px] text-content-secondary">
          <span>{frontendMessage("workflow.childRun.stopProgress")}</span>
          <span>{cancellationLabel(childRun.cancellation.stage)}</span>
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
