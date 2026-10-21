import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/util";
import { type TimelineStep } from "../../store/sessionStore";
import { timelineToolExecutionKey } from "../../store/session/timelineProjection";
import { ActivityStatusIcon, AppIcon, ThinkingSteps, ThinkingStepsContent, ThinkingStepsHeader } from "../../shared/ui";
import {
  projectToolActivityInspection,
  type ToolActivityInspection,
  type ToolActivityRow,
} from "./toolActivityPresentation";
import { ToolActivityLabel } from "./ToolActivityLabel";
import {
  projectWorkspaceFileActivityRows,
  summarizeWorkspaceFileActivity,
  type WorkspaceFileActivitySummary,
} from "./workspaceChangeActivity";
import { collectToolWorkspaceChanges } from "./toolResourceProjection";
import { projectToolStagePresentation, type ToolStageStatus } from "./toolStagePresentation";
import type { ToolStageIconName } from "./toolStageIconContract";
import { ToolActionIcon } from "./ToolActionIcon";

export interface ToolBatchActivityModel {
  id: string;
  icon: ToolStageIconName;
  label: string;
  inspection?: ToolActivityInspection;
  status: ToolStageStatus;
  live: boolean;
  items: readonly ToolBatchActivityItem[];
  workspaceSummary?: WorkspaceFileActivitySummary;
}

export function ToolBatchActivityList({
  activities,
  keepOpenWhileRunActive = false,
  animateActivity = false,
}: {
  readonly activities: readonly ToolBatchActivityModel[];
  readonly keepOpenWhileRunActive?: boolean;
  readonly animateActivity?: boolean;
}): JSX.Element {
  return (
    <>
      {activities.map((activity) => (
        <ToolBatchActivity
          key={activity.id}
          activity={activity}
          defaultOpen={false}
          keepOpenWhileRunActive={keepOpenWhileRunActive}
          animateActivity={animateActivity}
        />
      ))}
    </>
  );
}

interface ToolBatchActivityItem {
  id: string;
  label: string;
  inspection?: ToolActivityInspection;
  status: TimelineStep["status"];
  rows?: readonly ToolActivityRow[];
  workspaceSummary?: WorkspaceFileActivitySummary;
}

export function ToolBatchActivity({
  activity,
  defaultOpen,
  keepOpenWhileRunActive = false,
  animateActivity = false,
}: {
  activity: ToolBatchActivityModel;
  defaultOpen: boolean;
  keepOpenWhileRunActive?: boolean;
  animateActivity?: boolean;
}): JSX.Element {
  const displayLabel = activity.workspaceSummary?.label ?? activity.label;
  const accessibleLabel = activity.workspaceSummary?.accessibleLabel ?? activity.label;
  const pinnedOpen = activity.live && keepOpenWhileRunActive;
  const expandable = activity.items.length > 1 || activity.items.some((item) => (item.rows?.length ?? 0) > 1);
  const [open, setOpen] = useState(expandable && (defaultOpen || pinnedOpen));
  const previousActivity = useRef({ id: activity.id, expandable });
  const latestActiveItem = activity.items.reduce<string | undefined>(
    (latest, item) => (isLiveStepStatus(item.status) ? item.id : latest),
    undefined,
  );
  const latestAnimatedItemId = latestActiveItem ?? (animateActivity ? activity.items.at(-1)?.id : undefined);

  useEffect(() => {
    const previous = previousActivity.current;
    const resetDisclosure = previous.id !== activity.id || (!previous.expandable && expandable);
    if (resetDisclosure) setOpen(expandable && (defaultOpen || pinnedOpen));
    else if (pinnedOpen && expandable) setOpen(true);
    previousActivity.current = { id: activity.id, expandable };
  }, [activity.id, defaultOpen, expandable, pinnedOpen]);

  const contents = (
    <>
      <ToolActionIcon icon={activity.icon} status={activity.status} size="sm" className="activity-feed-row__icon" />
      <span className="activity-feed-row__content min-w-0">
        <span
          className={cn("block min-w-0 truncate whitespace-nowrap font-medium text-content-primary")}
          data-tool-batch-activity-title
        >
          {activity.workspaceSummary ? (
            <WorkspaceActivitySummaryText summary={activity.workspaceSummary} />
          ) : (
            <ToolActivityLabel inspection={activity.inspection} fallback={displayLabel} />
          )}
        </span>
      </span>
    </>
  );

  return (
    <div
      className="tool-batch-activity flex min-w-0 flex-col text-[13px] leading-5 text-content-primary"
      data-tool-batch-activity
      data-state={activity.live ? "loading" : "done"}
    >
      {expandable ? (
        <ThinkingSteps
          open={open}
          onOpenChange={(nextOpen) => setOpen(pinnedOpen ? true : nextOpen)}
          className="min-w-0"
          data-tool-batch-steps
        >
          <ThinkingStepsHeader
            className="activity-feed-row group w-full rounded-md text-left transition-colors hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
            aria-label={accessibleLabel}
            data-tool-batch-activity-trigger
            data-activity-feed-row
          >
            {contents}
          </ThinkingStepsHeader>
          <ThinkingStepsContent className="tool-batch-activity__disclosure">
            <div
              className="tool-activity-viewport flex min-w-0 gap-2 pr-1"
              data-tool-batch-activity-items
              data-tool-batch-activity-viewport
            >
              <span className="ml-[6.5px] w-px shrink-0 bg-line-subtle" aria-hidden="true" />
              <ul className="flex min-w-0 flex-1 flex-col gap-1 py-1 pl-1" role="list">
                {activity.items.map((item) => (
                  <ToolBatchActivityItemRow
                    key={item.id}
                    item={item}
                    liveActivity={
                      isLiveStepStatus(item.status) || (animateActivity && open && item.id === latestAnimatedItemId)
                    }
                  />
                ))}
              </ul>
            </div>
          </ThinkingStepsContent>
        </ThinkingSteps>
      ) : (
        <div className="activity-feed-row w-full text-left" data-tool-batch-activity-trigger data-activity-feed-row>
          {contents}
          <span className="activity-feed-row__trailing" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

function ToolBatchActivityItemRow({
  item,
  liveActivity,
}: {
  item: ToolBatchActivityItem;
  liveActivity: boolean;
}): JSX.Element {
  return (
    <li
      className="group flex min-w-0 items-start gap-1.5 text-[12px] leading-[18px] text-content-secondary"
      data-tool-batch-activity-item
      data-state={readToolBatchActivityItemState(item.status)}
    >
      <ToolBatchActivityStatus status={item.status} liveActivity={liveActivity} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5" data-tool-activity-content>
        {item.rows?.length ? (
          item.rows.map((row) => (
            <ToolBatchFileChangeRow key={`${row.path ?? row.label}:${row.status ?? "change"}`} row={row} />
          ))
        ) : item.workspaceSummary ? (
          <span className="block min-h-[18px] min-w-0 truncate leading-[18px] text-content-primary" title={item.label}>
            <WorkspaceActivitySummaryText summary={item.workspaceSummary} />
          </span>
        ) : (
          <ToolActivityLabel
            inspection={item.inspection}
            fallback={item.label}
            className="w-full min-h-[18px] min-w-0 whitespace-nowrap leading-[18px] text-content-primary"
            title={item.label}
          />
        )}
      </span>
    </li>
  );
}

function isLiveStepStatus(status: TimelineStep["status"]): boolean {
  return status === "pending" || status === "running" || status === "cancelling";
}

function ToolBatchFileChangeRow({ row }: { row: ToolActivityRow }): JSX.Element {
  const displayPath = row.path ? fileName(row.path) : undefined;
  return (
    <span
      className="flex min-h-[18px] min-w-0 items-center gap-1.5 leading-[18px] text-content-secondary"
      data-tool-file-change-row
      data-workspace-file-status={row.status}
      aria-label={row.label}
      title={row.path ?? row.label}
    >
      {row.action && displayPath ? (
        <>
          <AppIcon
            icon="file-text"
            size={13}
            className="shrink-0 text-content-muted"
            data-tool-file-change-icon
            aria-hidden="true"
          />
          <span className="block min-w-0 truncate text-content-primary" data-tool-file-change-text>
            <span>{row.action}</span> <span className="text-[11px]">{displayPath}</span>
          </span>
          <ToolBatchFileChangeDelta addedLines={row.addedLines} removedLines={row.removedLines} />
        </>
      ) : (
        <span className="min-w-0 truncate text-content-primary">{row.label}</span>
      )}
    </span>
  );
}

function WorkspaceActivitySummaryText({ summary }: { summary: WorkspaceFileActivitySummary }): JSX.Element {
  return (
    <>
      <span>{summary.label}</span>{" "}
      <ToolBatchFileChangeDelta addedLines={summary.addedLines} removedLines={summary.removedLines} />
    </>
  );
}

function ToolBatchFileChangeDelta({
  addedLines,
  removedLines,
}: {
  addedLines?: number;
  removedLines?: number;
}): JSX.Element | null {
  if (addedLines === undefined && removedLines === undefined) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[10px] tabular-nums">
      {addedLines !== undefined ? (
        <span className="text-emerald-700 dark:text-emerald-300" data-workspace-added-lines>
          +{addedLines}
        </span>
      ) : null}
      {addedLines !== undefined && removedLines !== undefined ? " " : null}
      {removedLines !== undefined ? (
        <span className="text-rose-700 dark:text-rose-300" data-workspace-removed-lines>
          {"\u2212"}
          {removedLines}
        </span>
      ) : null}
    </span>
  );
}

function fileName(path: string): string {
  const normalized = path.replace(/\\/gu, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || path;
}

function ToolBatchActivityStatus({
  status,
  liveActivity,
}: {
  status: TimelineStep["status"];
  liveActivity: boolean;
}): JSX.Element {
  // The tone comes straight from the shared map, so a "done" row here is the
  // same green as a done row in the feed, and a "running" row the same olive as
  // the dock. Only in-flight rows spin.
  return (
    <span
      className="inline-flex h-[18px] w-3.5 shrink-0 items-center justify-center"
      data-workflow-live-marker={liveActivity || undefined}
      aria-hidden="true"
    >
      <ActivityStatusIcon status={status} motion="spin" size={14} />
    </span>
  );
}

export function projectToolBatchActivity(run: {
  readonly steps: readonly TimelineStep[];
}): ToolBatchActivityModel | undefined {
  return projectToolBatchActivityFromSteps(readToolSteps(run.steps));
}

/**
 * Projects each provider-declared tool batch as its own disclosure. A stage can
 * contain several model responses and approval pauses, so its steps must not be
 * rendered as one synthetic batch merely because they share a visual stage.
 */
export function projectToolBatchActivities(run: { readonly steps: readonly TimelineStep[] }): ToolBatchActivityModel[] {
  const groups = new Map<string, Array<TimelineStep & { toolName: string }>>();
  for (const step of readToolSteps(run.steps)) {
    const identity = timelineToolExecutionKey(step);
    const group = groups.get(identity) ?? [];
    group.push(step);
    groups.set(identity, group);
  }
  return [...groups.values()].flatMap((steps) => {
    const activity = projectToolBatchActivityFromSteps(steps);
    return activity ? [activity] : [];
  });
}

function projectToolBatchActivityFromSteps(
  toolSteps: readonly (TimelineStep & { toolName: string })[],
): ToolBatchActivityModel | undefined {
  if (toolSteps.length === 0) return undefined;

  const presentation = projectToolStagePresentation({ steps: toolSteps });
  if (!presentation) return undefined;

  const items = toolSteps.map((step) => {
    const inspection = projectToolActivityInspection({
      toolName: step.toolName,
      origin: step.toolOrigin,
      arguments: step.toolArgs,
      result: step.toolPresentation,
      durationMs: step.durationMs,
      status: readToolActivityStatus(step.status),
    });
    return {
      id: step.id,
      label: inspection.label,
      inspection,
      status: step.status,
      ...(inspection.rows ? { rows: inspection.rows } : {}),
      ...(inspection.workspaceSummary ? { workspaceSummary: inspection.workspaceSummary } : {}),
    };
  });
  const batchChanges = collectToolWorkspaceChanges(toolSteps);
  const batchWorkspaceRows = projectWorkspaceFileActivityRows(batchChanges);
  const batchWorkspaceSummary = summarizeWorkspaceFileActivity(batchWorkspaceRows, batchChanges);
  const label = items[0]!.label;

  return {
    id: `tool-batch:${toolSteps[0]!.toolBatch?.id ?? toolSteps[0]!.callId ?? toolSteps[0]!.id}`,
    icon: presentation.icon,
    label,
    inspection: items[0]?.inspection,
    status: presentation.status,
    live: toolSteps.some(
      (step) => step.status === "pending" || step.status === "running" || step.status === "cancelling",
    ),
    items,
    ...(batchWorkspaceSummary ? { workspaceSummary: batchWorkspaceSummary } : {}),
  };
}

function readToolSteps(steps: readonly TimelineStep[]): Array<TimelineStep & { toolName: string }> {
  return steps.filter(
    (step): step is TimelineStep & { toolName: string } => step.kind === "tool" && Boolean(step.toolName?.trim()),
  );
}

function readToolActivityStatus(status: TimelineStep["status"]): "active" | "completed" | "failed" | "cancelled" {
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return status === "pending" || status === "running" || status === "cancelling" ? "active" : "completed";
}

function readToolBatchActivityItemState(status: TimelineStep["status"]): "done" | "loading" | "failed" | "cancelled" {
  if (status === "done") return "done";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "loading";
}
