import { ToolCallCard, type ToolCallStatus } from "@vinyasa/ai-native/tool-call-card";
import { VinyasaProvider } from "@vinyasa/tokens";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  RunActivityRecord,
  RunRecord,
  TimelineStep,
  TimelineStepKind,
  TimelineStepStatus,
} from "../../store/sessionStore";
import { formatFrontendMessage, frontendMessage } from "../../i18n/frontendMessageCatalog";
import { resolveFrontendLocalizedText } from "../../i18n/frontendLocaleModel";
import { getFrontendLocale } from "../../i18n/frontendLocaleStore";
import { cn, formatDurationMs } from "../../lib/util";
import { ActivityStatusIcon, AppIcon, IconButton, useClipboardCopy, type AppIconName } from "../../shared/ui";
import { FluidHoverHighlight, useFluidHover, useMotionLevel } from "../../shared/motion";
import { DataView } from "./DataView";
import { WorkflowStepDetail } from "./NodeDetailDrawer";
import { runActivityLabel } from "./runActivityPresentation";
import { readStepStatusLabel } from "./stepPresentation";
import {
  projectToolActivityInspection,
  projectToolCallCardLabel,
  readTypedAtPointer,
} from "./toolActivityPresentation";
import { readToolResultValue } from "./toolResultProjection";
import { projectToolStagePresentation } from "./toolStagePresentation";
import { ToolActionIcon } from "./ToolActionIcon";
import { ToolRunOutputSummary } from "./ToolRunOutputSummary";
import {
  projectWorkflowActivities,
  projectWorkflowSteps,
  readWorkflowStepDurationMs,
} from "./workflowPresentationProjection";

type DockWorkflowEntry =
  | { kind: "step"; id: string; order: number; step: TimelineStep }
  | { kind: "batch"; id: string; order: number; tools: DockToolStep[] }
  | { kind: "activity"; id: string; order: number; activity: RunActivityRecord };

type DockToolStep = TimelineStep & { kind: "tool"; toolName: string };

const StepKindIcon: Record<TimelineStepKind, AppIconName> = {
  understand: "message",
  prompt: "file-code",
  model: "brain",
  decision: "code",
  delegation: "git-branch",
  tool: "globe",
  retry: "activity",
  answer: "pencil",
  error: "cancel",
  training: "brain",
  recall: "book-open",
  harness: "activity",
};

export function WorkflowDockGraph({ run }: { run: RunRecord }): JSX.Element {
  const entries = useMemo(() => projectDockWorkflow(run), [run]);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const { disableMotion } = useMotionLevel();
  const entryListRef = useRef<HTMLDivElement>(null);
  const entryHover = useFluidHover(entryListRef, { axis: "y", gapClick: false });

  if (entries.length === 0) {
    return (
      <div className="flex min-h-40 flex-1 items-center justify-center px-6 text-center text-[12px] leading-5 text-content-secondary">
        {frontendMessage("workflow.panel.emptyDescription")}
      </div>
    );
  }

  return (
    <div
      className="scrollbar-thin min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto pl-3 pr-2 pb-8 pt-11"
      data-workflow-dock-graph
      aria-label={frontendMessage("workflow.dock.ariaLabel")}
    >
      <div ref={entryListRef} className="relative min-w-0 w-full" role="list" {...entryHover.handlers}>
        <FluidHoverHighlight hover={entryHover} hidden={disableMotion} className="rounded-md" />
        <VinyasaProvider brand="dusk" density="compact">
          <span
            className="workflow-dock-rail pointer-events-none absolute bottom-4 left-[11px] top-4 w-px bg-line-subtle"
            data-workflow-dock-rail
            aria-hidden="true"
          />
          {entries.map((entry, index) => {
            const expanded = expandedIds.has(entry.id);
            const onToggle = (): void => setExpandedIds((current) => toggleSetEntry(current, entry.id));
            if (entry.kind === "batch") {
              return <DockBatchNode key={entry.id} itemRef={entryHover.getItemRef(index)} entry={entry} />;
            }
            if (entry.kind === "activity") {
              return (
                <DockActivityNode key={entry.id} itemRef={entryHover.getItemRef(index)} activity={entry.activity} />
              );
            }
            if (isDockToolStep(entry.step)) {
              return <DockToolCallNode key={entry.id} itemRef={entryHover.getItemRef(index)} step={entry.step} />;
            }
            return (
              <DockStepNode
                key={entry.id}
                itemRef={entryHover.getItemRef(index)}
                fluidHoverEnabled={!disableMotion}
                step={entry.step}
                expanded={expanded}
                onToggle={onToggle}
              />
            );
          })}
        </VinyasaProvider>
      </div>
      <ToolRunOutputSummary run={run} />
    </div>
  );
}

export function projectDockWorkflow(run: RunRecord): DockWorkflowEntry[] {
  const steps = projectWorkflowSteps(run);
  const activities = projectWorkflowActivities(run);
  const batches = collectDockToolBatches(steps);
  const toolBatchIds = collectDockToolBatchIds(steps);
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
        order: readEntryOrder(batch.tools[0]?.startedAt, index),
        tools: batch.tools,
      });
      return;
    }
    if (isDockToolPlanStep(step, toolBatchIds)) return;
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
  itemRef,
  fluidHoverEnabled,
  step,
  expanded,
  onToggle,
  nested = false,
}: {
  itemRef?: (element: HTMLElement | null) => void;
  fluidHoverEnabled?: boolean;
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
  const staticAnswer = step.kind === "answer";
  const statusLabel = step.status === "done" || staticAnswer ? undefined : readStepStatusLabel(step.status);

  const rowContent = (
    <>
      <DockNodeMarker status={step.status}>
        <AppIcon icon={icon} size={14} aria-hidden="true" />
      </DockNodeMarker>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium leading-5 text-content-primary">
            {title}
          </span>
          {statusLabel ? (
            <span className={cn("shrink-0 text-[10.5px]", statusTextClass(step.status))}>{statusLabel}</span>
          ) : null}
        </div>
        <div className="workflow-dock-step-summary mt-0.5 text-[11px] leading-4 text-content-muted">
          {summary ? <span className="min-w-0 truncate">{summary}</span> : <span aria-hidden="true" />}
          <span className="workflow-dock-duration" aria-hidden={durationMs === undefined ? "true" : undefined}>
            {durationMs !== undefined ? formatDurationMs(durationMs) : null}
          </span>
        </div>
      </div>
      {!staticAnswer ? (
        <AppIcon
          icon="chevron-down"
          size={14}
          className={cn(
            "mt-1 shrink-0 text-content-muted transition-transform duration-200",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  return (
    <div
      className={cn("relative min-w-0", nested ? "py-0.5" : "py-1")}
      role="listitem"
      data-workflow-dock-step={step.id}
      data-workflow-dock-expanded={expanded ? "true" : "false"}
    >
      {staticAnswer ? (
        <div
          ref={itemRef}
          className={cn(
            "relative z-10 flex min-h-11 w-full min-w-0 items-start gap-2.5 rounded-md py-2 text-left",
            nested ? "px-2" : "pl-0 pr-1.5",
          )}
          data-workflow-dock-answer
        >
          {rowContent}
        </div>
      ) : (
        <button
          type="button"
          ref={itemRef}
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-label={frontendMessage(expanded ? "workflow.dock.collapseNode" : "workflow.dock.expandNode", {
            title,
          })}
          className={cn(
            "group relative z-10 flex min-h-11 w-full min-w-0 items-start gap-2.5 rounded-md py-2 text-left transition-colors",
            nested ? "px-2" : "pl-0 pr-1.5",
            fluidHoverEnabled ? "hover:bg-transparent" : "hover:bg-surface-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
            expanded && "text-content-primary",
          )}
        >
          {rowContent}
        </button>
      )}
      {expanded && !staticAnswer ? (
        <div
          id={contentId}
          className={cn(
            "min-w-0 max-w-full border-l border-line-subtle pb-3 pt-1",
            nested ? "ml-7 pl-3 pr-0" : "ml-5 pl-3 pr-0",
          )}
        >
          <div className="py-3">
            <WorkflowStepDetail step={step} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DockToolCallNode({
  itemRef,
  step,
  nested = false,
}: {
  itemRef?: (element: HTMLElement | null) => void;
  step: DockToolStep;
  nested?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const inspection = projectToolActivityInspection({
    toolName: step.toolName,
    origin: step.toolOrigin,
    arguments: step.toolArgs,
    result: step.toolPresentation,
    durationMs: readWorkflowStepDurationMs(step),
    status: readToolActivityStatus(step.status),
  });
  const args = step.toolArgs === undefined ? undefined : <ToolCallPayload kind="arguments" value={step.toolArgs} />;
  const resultValue = readToolResultValue(step);
  const result = resultValue === undefined ? undefined : <ToolCallPayload kind="result" value={resultValue} />;
  const resultPreview = projectDockToolResultPreview(step, resultValue);
  const durationMs = readWorkflowStepDurationMs(step);
  const toolIcon = projectToolStagePresentation({ steps: [step] })?.icon ?? "tools";
  const cardHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trigger = cardHostRef.current?.querySelector<HTMLButtonElement>("button");
    if (!trigger) return;
    trigger.setAttribute(
      "aria-label",
      frontendMessage(open ? "workflow.dock.collapseNode" : "workflow.dock.expandNode", {
        title: inspection.identity ?? step.toolName,
      }),
    );
  }, [inspection.identity, open, step.toolName]);

  const card = (
    <ToolCallCard
      toolName={projectToolCallCardLabel({
        toolName: step.toolName,
        origin: step.toolOrigin,
        arguments: step.toolArgs,
        result: step.toolPresentation,
        durationMs,
        status: readToolActivityStatus(step.status),
      })}
      status={readToolCallStatus(step.status)}
      args={args}
      result={result}
      open={open}
      onOpenChange={setOpen}
    />
  );

  return (
    <div
      ref={itemRef}
      className={cn("relative min-w-0 py-1", nested && "pl-1")}
      role="listitem"
      data-workflow-dock-step={step.id}
      data-workflow-tool-call-card
      data-workflow-tool-status={step.status}
    >
      <div className="workflow-tool-call-row relative z-10">
        <DockNodeMarker status={step.status}>
          <ToolActionIcon
            icon={toolIcon}
            status={step.status}
            size="sm"
            showLiveIndicator={false}
            className="text-current"
          />
        </DockNodeMarker>
        <div ref={cardHostRef} className="min-w-0">
          {card}
          {!open && resultPreview ? <DockToolResultPreview preview={resultPreview} /> : null}
        </div>
        <span className="workflow-tool-call-duration" aria-hidden={durationMs === undefined ? "true" : undefined}>
          {durationMs !== undefined ? formatDurationMs(durationMs) : null}
        </span>
      </div>
    </div>
  );
}

interface DockToolResultPreviewRow {
  readonly title: string;
  readonly description?: string;
  readonly meta?: string;
}

interface DockToolResultPreviewModel {
  readonly rows: readonly DockToolResultPreviewRow[];
  readonly more?: string;
}

function projectDockToolResultPreview(step: DockToolStep, result: unknown): DockToolResultPreviewModel | undefined {
  const contract = step.toolOrigin?.presentation?.preview?.result;
  if (!contract || result === undefined) return undefined;

  const projectedRows = contract.rows.flatMap((declaration) =>
    readTypedAtPointer(result, declaration.pointer).flatMap((entry) => {
      const title = readPreviewScalar(entry, declaration.titlePath);
      if (!title) return [];
      const description = declaration.descriptionPath
        ? readPreviewScalar(entry, declaration.descriptionPath)
        : undefined;
      const meta = declaration.metaPath ? readPreviewScalar(entry, declaration.metaPath) : undefined;
      return [{ title, ...(description ? { description } : {}), ...(meta ? { meta } : {}) }];
    }),
  );
  const rows = (contract.maxRows ? projectedRows.slice(0, contract.maxRows) : projectedRows).filter(
    (row, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.title === row.title && candidate.description === row.description && candidate.meta === row.meta,
      ) === index,
  );
  const more = projectPreviewMore(result, contract.more, contract.rows, rows.length);
  if (rows.length === 0 && !more) return undefined;
  return { rows, ...(more ? { more } : {}) };
}

function readPreviewScalar(value: unknown, pointer: string): string | undefined {
  const candidate = readTypedAtPointer(value, pointer)[0];
  if (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean") {
    const text = String(candidate).replace(/\s+/gu, " ").trim();
    return text.length > 0 ? text : undefined;
  }
  return undefined;
}

function projectPreviewMore(
  result: unknown,
  declaration:
    | {
        readonly pointer: string;
        readonly countPath?: string;
        readonly label: Readonly<Record<string, string>>;
      }
    | undefined,
  rows: readonly { readonly pointer: string }[],
  visibleRowCount: number,
): string | undefined {
  if (!declaration) return undefined;
  const entries = readTypedAtPointer(result, declaration.pointer);
  const count = declaration.countPath
    ? entries
        .flatMap((entry) => readTypedAtPointer(entry, declaration.countPath!))
        .map(Number)
        .filter((value) => Number.isFinite(value) && value > 0)
        .reduce((total, value) => total + value, 0)
    : entries.flatMap((entry) => (Array.isArray(entry) ? entry : [entry])).length;
  const countsCollectionRows = rows.some((row) => collectionPointer(row.pointer) === declaration.pointer);
  const remaining = countsCollectionRows ? Math.max(0, count - visibleRowCount) : count;
  if (!remaining) return undefined;
  return formatFrontendMessage(resolveFrontendLocalizedText(declaration.label, getFrontendLocale()), {
    count: remaining,
  });
}

function collectionPointer(pointer: string): string {
  return pointer.endsWith("/*") ? pointer.slice(0, -2) : pointer;
}

function DockToolResultPreview({ preview }: { preview: DockToolResultPreviewModel }): JSX.Element {
  return (
    <div className="workflow-tool-call-preview" data-workflow-tool-call-preview>
      {preview.rows.map((row, index) => (
        <div className="workflow-tool-call-preview__row" key={`${row.title}:${index}`}>
          <span className="workflow-tool-call-preview__title" title={row.title}>
            {row.title}
          </span>
          {row.description ? (
            <span className="workflow-tool-call-preview__description" title={row.description}>
              {row.description}
            </span>
          ) : null}
          {row.meta ? <span className="workflow-tool-call-preview__meta">{row.meta}</span> : null}
        </div>
      ))}
      {preview.more ? <span className="workflow-tool-call-preview__more">{preview.more}</span> : null}
    </div>
  );
}

function ToolCallPayload({ kind, value }: { kind: "arguments" | "result"; value: unknown }): JSX.Element {
  const { copied, copyText } = useClipboardCopy();
  const text = serializeToolPayload(value);
  const label = frontendMessage(kind === "arguments" ? "workflow.dock.copyArguments" : "workflow.dock.copyResult");

  return (
    <div className="workflow-tool-call-payload" data-workflow-tool-call-payload={kind}>
      <div className="flex justify-end">
        <IconButton label={label} tooltip={label} size="sm" tone="muted" onClick={() => void copyText(text)}>
          <AppIcon icon={copied ? "checkmark" : "copy"} size={13} aria-hidden="true" />
        </IconButton>
      </div>
      <DataView value={value} />
    </div>
  );
}

function serializeToolPayload(value: unknown): string {
  if (typeof value === "string") return value;
  const serialized = JSON.stringify(value, null, 2);
  return serialized ?? String(value);
}

function readToolCallStatus(status: TimelineStepStatus): ToolCallStatus {
  if (status === "running" || status === "cancelling") return "running";
  if (status === "failed" || status === "cancelled") return "error";
  if (status === "done") return "success";
  return "pending";
}

function readToolActivityStatus(status: TimelineStepStatus): "active" | "completed" | "failed" | "cancelled" {
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return status === "pending" || status === "running" || status === "cancelling" ? "active" : "completed";
}

function DockBatchNode({
  itemRef,
  entry,
}: {
  itemRef?: (element: HTMLElement | null) => void;
  entry: Extract<DockWorkflowEntry, { kind: "batch" }>;
}): JSX.Element {
  const status = aggregateStepStatus(entry.tools);
  const durationMs = readToolBatchDurationMs(entry.tools);
  const contentId = `dock-batch-${entry.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;

  return (
    <div
      ref={itemRef}
      className="relative min-w-0 py-1"
      role="listitem"
      data-workflow-dock-batch={entry.id}
      data-workflow-dock-expanded="true"
    >
      <div
        className="relative z-10 flex min-h-7 w-full min-w-0 items-center gap-2.5 py-1 pl-0 pr-1.5"
        data-workflow-dock-batch-summary
      >
        <DockNodeMarker status={status} batch>
          <AppIcon icon="split" size={14} aria-hidden="true" />
        </DockNodeMarker>
        <BatchStatusSegments steps={entry.tools} />
        <span className="workflow-dock-duration" aria-hidden={durationMs === undefined ? "true" : undefined}>
          {durationMs !== undefined ? formatDurationMs(durationMs) : null}
        </span>
      </div>
      <div id={contentId} className="relative ml-[9px] border-l border-line-subtle pb-2 pl-4" role="list">
        {entry.tools.map((step) => (
          <DockToolCallNode key={step.id} step={step} nested />
        ))}
      </div>
    </div>
  );
}

function BatchStatusSegments({ steps }: { steps: readonly DockToolStep[] }): JSX.Element {
  const segments = projectBatchStatusSegments(steps);
  return (
    <span
      className="workflow-dock-batch-segments"
      data-workflow-batch-segments
      aria-label={frontendMessage("workflow.summary.parallelTools", { count: steps.length })}
    >
      {segments.map((segment, index) => (
        <span
          key={`${segment.status}:${index}`}
          className={cn(
            "workflow-dock-batch-segment",
            segment.status === "done" && "workflow-dock-batch-segment--done",
            (segment.status === "failed" || segment.status === "cancelled") && "workflow-dock-batch-segment--failed",
            (segment.status === "running" || segment.status === "cancelling") && "workflow-dock-batch-segment--running",
            segment.status === "pending" && "workflow-dock-batch-segment--pending",
          )}
          data-workflow-batch-segment={segment.status === "cancelled" ? "failed" : segment.status}
          data-count={segment.count}
          style={{ width: `${(segment.count / steps.length) * 100}%` }}
          title={readStepStatusLabel(segment.status)}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

interface DockBatchStatusSegment {
  readonly status: TimelineStepStatus;
  readonly count: number;
}

function projectBatchStatusSegments(steps: readonly DockToolStep[]): DockBatchStatusSegment[] {
  const segments: DockBatchStatusSegment[] = [];
  for (const step of steps) {
    const previous = segments.at(-1);
    if (previous?.status === step.status) {
      segments[segments.length - 1] = { ...previous, count: previous.count + 1 };
      continue;
    }
    segments.push({ status: step.status, count: 1 });
  }
  return segments;
}

function readToolBatchDurationMs(steps: readonly DockToolStep[]): number | undefined {
  const measured = steps
    .map((step) => readWorkflowStepDurationMs(step))
    .filter((duration): duration is number => duration !== undefined);
  if (measured.length > 0) return Math.max(...measured);

  const starts = steps.map((step) => Date.parse(step.startedAt)).filter(Number.isFinite);
  const ends = steps.map((step) => (step.endedAt ? Date.parse(step.endedAt) : Number.NaN)).filter(Number.isFinite);
  if (starts.length === 0 || ends.length === 0) return undefined;
  const duration = Math.max(...ends) - Math.min(...starts);
  return duration > 0 ? duration : undefined;
}

function DockActivityNode({
  itemRef,
  activity,
}: {
  itemRef?: (element: HTMLElement | null) => void;
  activity: RunActivityRecord;
}): JSX.Element {
  return (
    <div
      ref={itemRef}
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
  children,
}: {
  status: TimelineStepStatus;
  batch?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <span
      className={cn(
        "workflow-dock-marker relative z-10 mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-surface-canvas",
        status === "done" && "bg-moss-100 text-moss-600 dark:bg-moss-900/30 dark:text-moss-300",
        (status === "failed" || status === "cancelled") &&
          "bg-brick-100 text-brick-600 dark:bg-brick-900/30 dark:text-brick-300",
        (status === "running" || status === "cancelling" || status === "pending") &&
          "bg-accent-surface text-accent-content",
        batch && "workflow-dock-marker--batch",
      )}
      data-workflow-dock-marker-status={status}
      aria-hidden="true"
    >
      {status === "failed" ? <ActivityStatusIcon status="failed" motion="none" size={12} /> : null}
      {status === "cancelled" ? <ActivityStatusIcon status="cancelled" motion="none" size={12} /> : null}
      {status !== "failed" && status !== "cancelled" ? children : null}
    </span>
  );
}

function collectDockToolBatches(steps: readonly TimelineStep[]): Map<string, { tools: DockToolStep[] }> {
  const candidates = new Map<string, DockToolStep[]>();
  for (const step of steps) {
    const batchId = step.toolBatch?.id;
    if (!batchId || !isDockToolStep(step)) continue;
    const tools = candidates.get(batchId) ?? [];
    tools.push(step);
    candidates.set(batchId, tools);
  }

  return new Map(
    [...candidates]
      .filter(([, tools]) => tools.length > 1 && tools[0]?.toolBatch?.executionMode !== "sequential")
      .map(([batchId, tools]) => [batchId, { tools }]),
  );
}

function collectDockToolBatchIds(steps: readonly TimelineStep[]): Set<string> {
  return new Set(
    steps.flatMap((step) => {
      if (!isDockToolStep(step) || !step.toolBatch?.id) return [];
      return [step.toolBatch.id];
    }),
  );
}

function isDockToolPlanStep(step: TimelineStep, toolBatchIds: ReadonlySet<string>): boolean {
  return (
    step.kind === "tool" &&
    !step.toolName?.trim() &&
    Boolean(step.toolBatch?.id) &&
    toolBatchIds.has(step.toolBatch!.id)
  );
}

function isDockToolStep(step: TimelineStep): step is DockToolStep {
  return step.kind === "tool" && Boolean(step.toolName?.trim());
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
  if (step.kind === "tool" && step.toolName) {
    return projectToolActivityInspection({
      toolName: step.toolName,
      origin: step.toolOrigin,
      arguments: step.toolArgs,
      status: step.status === "failed" ? "failed" : step.status === "done" ? "completed" : "active",
    }).argumentPreview;
  }
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
