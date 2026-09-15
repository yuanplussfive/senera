import { useId, useMemo, useState, type ComponentType } from "react";
import { ChevronDown, Circle, CircleDot, X } from "lucide-react";
import { cn } from "../../lib/util";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import {
  type TimelineChildRunState,
  type TimelineChildRunTodoItem,
  type TimelineChildRunTodoStatus,
  type TimelineStep,
} from "../../store/sessionStore";
import { AppIcon } from "../../shared/ui/AppIcon";
import { MotionDisclosure } from "../../shared/motion";
import { LazyMarkdownRenderer } from "../../shared/code/LazyMarkdownRenderer";
import { ChildRunStatusPresentation } from "./ChildRunOverview";
import { projectToolBatchActivity, ToolBatchActivity } from "./ToolBatchActivity";

const LiveChildRunStatuses = new Set<TimelineChildRunState["status"]>([
  "queued",
  "running",
  "wrapping_up",
  "cancelling",
  "awaiting_supervisor",
]);

const SettledChildRunStatuses = new Set<TimelineChildRunState["status"]>([
  "completed",
  "partial_completed",
  "interrupted",
  "timed_out",
  "failed",
  "cancelled",
]);

const TodoCheckIcon: ComponentType<{ className?: string; "aria-hidden"?: boolean }> = ({ className, ...props }) => (
  <AppIcon icon="check" size={14} strokeWidth={1.8} className={className} {...props} />
);

const TodoStatusPresentation = {
  pending: {
    icon: Circle,
    iconClass: "text-content-muted",
    textClass: "text-content-secondary",
    label: "workflow.childRun.todo.status.pending",
  },
  in_progress: {
    icon: CircleDot,
    iconClass: "animate-pulse text-accent-strong",
    textClass: "text-content-primary",
    label: "workflow.childRun.todo.status.inProgress",
  },
  completed: {
    icon: TodoCheckIcon,
    iconClass: "text-moss-600",
    textClass: "text-content-muted line-through",
    label: "workflow.childRun.todo.status.completed",
  },
  cancelled: {
    icon: X,
    iconClass: "text-content-muted",
    textClass: "text-content-muted line-through",
    label: "workflow.childRun.todo.status.cancelled",
  },
} as const satisfies Record<
  TimelineChildRunTodoStatus,
  {
    icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
    iconClass: string;
    textClass: string;
    label: FrontendMessageKey;
  }
>;

interface ChildRunCardProps {
  childRun: TimelineChildRunState;
  agentName?: string;
  childToolSteps?: readonly TimelineStep[];
}

/**
 * A delegated run follows the same flat rhythm as the execution timeline.
 * Todo state is the primary surface; the report and tool trace remain opt-in
 * so a busy child run does not turn the conversation into a wall of logs.
 */
export function ChildRunActivity({ childRun, agentName, childToolSteps }: ChildRunCardProps): JSX.Element {
  const contentId = useId();
  const [open, setOpen] = useState(false);
  const presentation = ChildRunStatusPresentation[childRun.status];
  const live = LiveChildRunStatuses.has(childRun.status);
  const settled = SettledChildRunStatuses.has(childRun.status);
  const todoItems = childRun.todo?.items ?? [];

  const toolBatchActivity = useMemo(
    () =>
      childToolSteps && childToolSteps.length > 0 ? projectToolBatchActivity({ steps: childToolSteps }) : undefined,
    [childToolSteps],
  );

  const childMessages = childRun.messages.filter(
    (message) => message.direction === "child_to_parent" && message.content.trim(),
  );
  const finalReport = settled ? [...childMessages].reverse().find((message) => message.kind === "response") : undefined;
  const liveUpdate = live
    ? [...childMessages].reverse().find((message) => message.kind === "progress" || message.kind === "response")
    : undefined;
  const hasDetails = Boolean(finalReport || liveUpdate || toolBatchActivity);
  const name = agentName || frontendMessage("workflow.childRun.board.agentFallback");

  return (
    <section
      className="child-run-activity min-w-0"
      data-child-run-activity
      data-child-run-card
      data-child-run-status={childRun.status}
      aria-live="polite"
    >
      <button
        type="button"
        onClick={hasDetails ? () => setOpen((value) => !value) : undefined}
        aria-expanded={hasDetails ? open : undefined}
        aria-controls={hasDetails ? contentId : undefined}
        aria-label={`${name}: ${frontendMessage(presentation.label)}`}
        className={cn(
          "group flex w-full min-w-0 items-center gap-2 border-b border-line-subtle py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
          hasDetails && "cursor-pointer hover:bg-surface-hover/55",
        )}
        data-child-run-activity-trigger
        data-child-run-card-trigger
      >
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center" data-child-run-glyph>
          <AppIcon
            icon="delegation"
            size={15}
            className={cn("text-content-secondary", live && "text-accent-strong")}
            aria-hidden="true"
          />
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-surface-page",
              presentation.dotClass,
              live && "animate-pulse",
            )}
            aria-hidden="true"
          />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.75px] font-semibold leading-5 text-content-primary">
          {name}
        </span>
        <span className={cn("shrink-0 text-[10.5px]", presentation.textClass)}>
          {frontendMessage(presentation.label)}
        </span>
        {hasDetails ? (
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-content-muted transition-transform duration-200",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        ) : null}
      </button>

      {todoItems.length > 0 ? (
        <div className="ml-7 border-b border-line-subtle py-2 pl-3 pr-1" data-child-run-todo>
          <div className="mb-1.5 text-[10.5px] font-medium text-content-muted">
            {frontendMessage("chat.todoProgress.title")}
          </div>
          <ul className="flex min-w-0 flex-col gap-1.5" data-child-run-todo-items>
            {todoItems.map((item, index) => (
              <TodoRow key={todoItemKey(item, index)} item={item} />
            ))}
          </ul>
        </div>
      ) : null}

      <MotionDisclosure id={contentId} open={open} className="child-run-activity__disclosure">
        <div
          className="ml-7 min-w-0 border-b border-line-subtle py-2 pl-3 pr-1"
          data-child-run-activity-details
          data-child-run-card-body
        >
          <div className="flex min-w-0 flex-col gap-2.5">
            {finalReport ? (
              <div className="border-b border-line-subtle pb-2" data-child-run-final-report>
                <div className="mb-1 text-[10.5px] font-semibold text-content-muted">
                  {frontendMessage("workflow.childRun.card.reportTitle")}
                </div>
                <LazyMarkdownRenderer
                  className="mt-1 min-w-0"
                  contentClassName="text-[length:var(--theme-chat-assistant-font-size-scaled)] leading-[var(--theme-chat-assistant-line-height)] text-content-primary"
                  externalLinkPresentation="citation"
                >
                  {finalReport.content}
                </LazyMarkdownRenderer>
              </div>
            ) : null}

            {liveUpdate ? (
              <p className="whitespace-pre-wrap break-words text-[11.5px] leading-5 text-content-secondary">
                {liveUpdate.content}
              </p>
            ) : null}

            {toolBatchActivity ? <ToolBatchActivity activity={toolBatchActivity} defaultOpen={false} /> : null}
          </div>
        </div>
      </MotionDisclosure>
    </section>
  );
}

/** Compatibility export for hosts that still import the pre-activity name. */
export const ChildRunCard = ChildRunActivity;

function TodoRow({ item }: { item: TimelineChildRunTodoItem }): JSX.Element {
  const presentation = TodoStatusPresentation[item.status];
  const StatusIcon = presentation.icon;
  return (
    <li
      className="flex min-w-0 items-start gap-1.5"
      data-todo-row
      data-todo-status={item.status}
      aria-label={`${frontendMessage(presentation.label)}: ${item.content}`}
    >
      <StatusIcon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", presentation.iconClass)} aria-hidden={true} />
      <span className={cn("min-w-0 break-words text-[11.5px] leading-4", presentation.textClass)}>{item.content}</span>
    </li>
  );
}

function todoItemKey(item: TimelineChildRunTodoItem, index: number): string {
  // Status is mutable; keeping it out of the key prevents icon/text rows from
  // remounting and visibly flickering whenever the model advances a task.
  return `${item.content}:${index}`;
}
