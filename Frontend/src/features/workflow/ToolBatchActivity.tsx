import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/util";
import { type TimelineStep, type RunRecord } from "../../store/sessionStore";
import { MotionDisclosure } from "../../shared/motion";
import { AppIcon } from "../../shared/ui/AppIcon";
import { Spinner } from "../../shared/ui/Spinner";
import { projectToolActivityInspection } from "./toolActivityPresentation";
import { projectToolStagePresentation, type ToolStageStatus } from "./toolStagePresentation";
import type { ToolStageIconName } from "./toolStageIconContract";
import { ToolActionIcon } from "./ToolActionIcon";

export interface ToolBatchActivityModel {
  id: string;
  icon: ToolStageIconName;
  label: string;
  status: ToolStageStatus;
  live: boolean;
  items: readonly ToolBatchActivityItem[];
}

interface ToolBatchActivityItem {
  id: string;
  label: string;
  status: TimelineStep["status"];
}

export function ToolBatchActivity({
  activity,
  defaultOpen,
  keepOpenWhileRunActive = false,
}: {
  activity: ToolBatchActivityModel;
  defaultOpen: boolean;
  keepOpenWhileRunActive?: boolean;
}): JSX.Element {
  const contentId = useId();
  const active = activity.live || keepOpenWhileRunActive;
  const [open, setOpen] = useState(defaultOpen || active);
  const previousActivity = useRef({ id: activity.id, active });

  useEffect(() => {
    const changedActivity = previousActivity.current.id !== activity.id;
    if (changedActivity) {
      setOpen(defaultOpen || active);
    } else if (active) {
      setOpen(true);
    } else if (previousActivity.current.active) {
      setOpen(false);
    }
    previousActivity.current = { id: activity.id, active };
  }, [active, activity.id, defaultOpen]);

  return (
    <div
      className="tool-batch-activity flex min-w-0 flex-col text-[13px] leading-5 text-content-primary"
      data-tool-batch-activity
      data-state={activity.live ? "loading" : "done"}
    >
      <button
        type="button"
        className="group flex min-w-0 items-center gap-1.5 rounded-md py-1 text-left transition-colors hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
        aria-expanded={open}
        aria-controls={contentId}
        aria-label={activity.label}
        onClick={() => setOpen((value) => !value)}
        data-tool-batch-activity-trigger
      >
        <ToolActionIcon icon={activity.icon} status={activity.status} size="xs" showLiveIndicator={false} />
        <span className="min-w-0 flex-1 truncate font-medium text-content-primary">{activity.label}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-content-muted transition-transform duration-200",
            !open && "-rotate-90",
          )}
          aria-hidden="true"
        />
      </button>
      <MotionDisclosure id={contentId} open={open} className="tool-batch-activity__disclosure">
        <div className="flex min-w-0 gap-2" data-tool-batch-activity-items>
          <span className="ml-[6.5px] w-px shrink-0 bg-line-subtle" aria-hidden="true" />
          <ul className="flex min-w-0 flex-1 flex-col gap-1 py-1 pl-1" role="list">
            {activity.items.map((item) => (
              <ToolBatchActivityItemRow key={item.id} item={item} />
            ))}
          </ul>
        </div>
      </MotionDisclosure>
    </div>
  );
}

function ToolBatchActivityItemRow({ item }: { item: ToolBatchActivityItem }): JSX.Element {
  return (
    <li
      className="group flex min-w-0 items-center gap-1.5 text-[12px] leading-[18px] text-content-secondary"
      data-tool-batch-activity-item
      data-state={readToolBatchActivityItemState(item.status)}
    >
      <ToolBatchActivityStatus status={item.status} />
      <span className="min-w-0 flex-1 truncate text-content-primary">{item.label}</span>
    </li>
  );
}

function ToolBatchActivityStatus({ status }: { status: TimelineStep["status"] }): JSX.Element {
  if (status === "done") {
    return (
      <span
        className="inline-flex h-[18px] w-3.5 shrink-0 items-center justify-center text-moss-600"
        aria-hidden="true"
      >
        <AppIcon icon="check" size={14} strokeWidth={1.8} />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex h-[18px] w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full border border-dashed border-content-muted" />
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-[18px] w-3.5 shrink-0 items-center justify-center text-content-muted"
      aria-hidden="true"
    >
      <Spinner size="xs" />
    </span>
  );
}

export function projectToolBatchActivity(run: RunRecord): ToolBatchActivityModel | undefined {
  const toolSteps = run.steps.filter(
    (step): step is TimelineStep & { toolName: string } => step.kind === "tool" && Boolean(step.toolName?.trim()),
  );
  if (toolSteps.length === 0) return undefined;

  const presentation = projectToolStagePresentation(run);
  if (!presentation) return undefined;

  const items = toolSteps.map((step) => ({
    id: step.id,
    label: projectToolActivityInspection({
      toolName: step.toolName,
      origin: step.toolOrigin,
      arguments: step.toolArgs,
      status: readToolActivityStatus(step.status),
    }).label,
    status: step.status,
  }));
  const singleTool = toolSteps.length === 1 ? toolSteps[0] : undefined;
  const label = singleTool
    ? projectToolActivityInspection({
        toolName: singleTool.toolName,
        origin: singleTool.toolOrigin,
        arguments: singleTool.toolArgs,
        status: readToolActivityStatus(singleTool.status),
      }).label
    : presentation.title;

  return {
    id: toolSteps.map((step) => step.id).join(":"),
    icon: presentation.icon,
    label,
    status: presentation.status,
    live: toolSteps.some(
      (step) => step.status === "pending" || step.status === "running" || step.status === "cancelling",
    ),
    items,
  };
}

function readToolActivityStatus(status: TimelineStep["status"]): "active" | "completed" | "failed" {
  if (status === "failed") return "failed";
  return status === "pending" || status === "running" || status === "cancelling" ? "active" : "completed";
}

function readToolBatchActivityItemState(status: TimelineStep["status"]): "done" | "loading" | "failed" {
  if (status === "done") return "done";
  if (status === "failed") return "failed";
  return "loading";
}
