import { useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import "./WorkflowDockGraph.css";
import type { RunActivityRecord, RunRecord, TimelineStep, TimelineStepStatus } from "../../store/sessionStore";
import { formatFrontendMessage, frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn, formatDurationMs } from "../../lib/util";
import { OrganicTimelineRail } from "../../shared/motion";
import { NodeDetailDrawer } from "./NodeDetailDrawer";
import { projectDockToolSummary, type DockToolResultBody, type DockToolSummaryRow } from "./dockToolSummary";
import { runActivityLabel } from "./runActivityPresentation";
import { readStepStatusLabel } from "./stepPresentation";
import { ToolRunOutputSummary } from "./ToolRunOutputSummary";
import {
  projectWorkflowActivities,
  projectWorkflowSteps,
  readWorkflowStepDurationMs,
} from "./workflowPresentationProjection";

type DockWorkflowEntry =
  | { readonly kind: "step"; readonly id: string; readonly order: number; readonly step: TimelineStep }
  | { readonly kind: "batch"; readonly id: string; readonly order: number; readonly tools: readonly DockToolStep[] }
  | { readonly kind: "activity"; readonly id: string; readonly order: number; readonly activity: RunActivityRecord };

type DockToolStep = TimelineStep & { readonly kind: "tool"; readonly toolName: string };

// The dock is a scan surface, not the full result inspector. This is a single
// layout density constraint shared by every declared result shape; the drawer
// remains the authoritative view of the complete result.
const DockCompactPreviewRowCount = 2;

/**
 * The ordinal is the single stable visual anchor for every entry. State only
 * colors the ordinal only while its entry is inspected, keeping completed
 * history quiet and scannable at all dock widths.
 */
export function WorkflowDockGraph({ run }: { run: RunRecord }): JSX.Element {
  const entries = useMemo(() => projectDockWorkflow(run), [run]);
  const [selectedStep, setSelectedStep] = useState<TimelineStep | null>(null);
  const [hoveredEntryId, setHoveredEntryId] = useState<string | null>(null);
  // Parallel calls remain compact until the user asks for their individual
  // entries. Their first declared action stays visible in the summary.
  const [expandedBatchIds, setExpandedBatchIds] = useState<ReadonlySet<string>>(() => new Set());
  const [flow, setFlow] = useState<HTMLDivElement | null>(null);
  const updateEntryHover = (entryId: string | null): void => {
    setHoveredEntryId((current) => (current === entryId ? current : entryId));
  };
  const handleTimelinePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const target = event.target instanceof Element ? event.target : null;
    const entry = target?.closest<HTMLElement>("[data-workflow-dock-entry-id]");
    updateEntryHover(entry && event.currentTarget.contains(entry) ? (entry.dataset.workflowDockEntryId ?? null) : null);
  };

  if (entries.length === 0) {
    return (
      <div className="flex min-h-40 flex-1 items-center justify-center px-6 text-center text-[12px] leading-5 text-content-secondary">
        {frontendMessage("workflow.panel.emptyDescription")}
      </div>
    );
  }

  let ordinal = 0;
  return (
    <div
      className="min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-8 pt-4"
      data-workflow-dock-graph
      aria-label={frontendMessage("workflow.dock.ariaLabel")}
    >
      <div ref={setFlow} className="workflow-dock-flow">
        <div
          className="workflow-dock-timeline"
          role="list"
          onPointerMove={handleTimelinePointerMove}
          onPointerLeave={() => updateEntryHover(null)}
        >
          {entries.map((entry) => {
            if (entry.kind === "batch") {
              const firstOrdinal = ordinal + 1;
              ordinal += entry.tools.length;
              return (
                <DockBatchNode
                  key={entry.id}
                  entry={entry}
                  entryId={entry.id}
                  firstOrdinal={firstOrdinal}
                  expanded={expandedBatchIds.has(entry.id)}
                  onExpandedChange={() => setExpandedBatchIds((current) => toggleSetEntry(current, entry.id))}
                  selectedStepId={selectedStep?.id}
                  onSelect={setSelectedStep}
                  highlighted={hoveredEntryId === entry.id}
                  hoveredEntryId={hoveredEntryId}
                />
              );
            }
            ordinal += 1;
            if (entry.kind === "activity") {
              return (
                <DockActivityNode
                  key={entry.id}
                  activity={entry.activity}
                  entryId={entry.id}
                  ordinal={ordinal}
                  highlighted={hoveredEntryId === entry.id}
                />
              );
            }
            if (isDockToolStep(entry.step)) {
              return (
                <DockToolCallNode
                  key={entry.id}
                  step={entry.step}
                  entryId={entry.id}
                  ordinal={ordinal}
                  selected={selectedStep?.id === entry.step.id}
                  onSelect={setSelectedStep}
                  highlighted={hoveredEntryId === entry.id}
                />
              );
            }
            return (
              <DockStepNode
                key={entry.id}
                step={entry.step}
                entryId={entry.id}
                ordinal={ordinal}
                selected={selectedStep?.id === entry.step.id}
                onSelect={setSelectedStep}
                highlighted={hoveredEntryId === entry.id}
              />
            );
          })}
        </div>
        <OrganicTimelineRail
          root={flow}
          visible={entries.length > 0}
          originSelector="[data-workflow-dock-flow-node]"
          nodeSelector="[data-workflow-dock-flow-node]"
          activeNodeSelector="[data-workflow-dock-flow-node-active='true']"
          activeNodeKey={hoveredEntryId}
          contentSelector=".workflow-dock-entry-content"
          className="workflow-dock-flow__rail"
          endMarker="none"
          path="thread"
          testId="data-workflow-dock-rail"
          layoutVersion={entries}
        />
      </div>
      <ToolRunOutputSummary run={run} />
      <NodeDetailDrawer step={selectedStep} onClose={() => setSelectedStep(null)} />
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
  step,
  entryId,
  ordinal,
  selected,
  onSelect,
  highlighted,
}: {
  readonly step: TimelineStep;
  readonly entryId: string;
  readonly ordinal: number;
  readonly selected: boolean;
  readonly onSelect: (step: TimelineStep) => void;
  readonly highlighted: boolean;
}): JSX.Element {
  const title = readDockStepTitle(step);
  const summary = readDockStepSummary(step);
  const durationMs = readWorkflowStepDurationMs(step);
  const staticAnswer = step.kind === "answer";
  const status = staticAnswer || step.status === "done" ? undefined : readStepStatusLabel(step.status);
  const content = (
    <>
      <span className="workflow-dock-entry-phrase">
        <span className="workflow-dock-entry-title">{title}</span>
        {summary ? <span className="workflow-dock-entry-subject">{summary}</span> : null}
      </span>
      {status ? <span className={cn("workflow-dock-entry-status", statusTextClass(step.status))}>{status}</span> : null}
      <DockDuration durationMs={durationMs} status={step.status} />
    </>
  );

  return (
    <div
      className="workflow-dock-entry"
      role="listitem"
      data-workflow-dock-step={step.id}
      data-workflow-dock-entry-id={entryId}
      data-workflow-dock-expanded={selected}
    >
      <DockTimelineRail ordinal={ordinal} status={step.status} highlighted={highlighted} />
      <div className="workflow-dock-entry-content">
        {staticAnswer ? (
          <div className="workflow-dock-entry-row" data-workflow-dock-answer>
            {content}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onSelect(step)}
            aria-haspopup="dialog"
            aria-expanded={selected}
            aria-label={frontendMessage("workflow.dock.expandNode", {
              title,
            })}
            className="workflow-dock-entry-row"
          >
            {content}
          </button>
        )}
      </div>
    </div>
  );
}

function DockToolCallNode({
  step,
  entryId,
  ordinal,
  selected,
  onSelect,
  highlighted,
}: {
  readonly step: DockToolStep;
  readonly entryId: string;
  readonly ordinal: number;
  readonly selected: boolean;
  readonly onSelect: (step: TimelineStep) => void;
  readonly highlighted: boolean;
}): JSX.Element {
  const summary = projectDockToolSummary(step);
  const durationMs = readWorkflowStepDurationMs(step);
  return (
    <div
      className="workflow-dock-entry workflow-dock-tool-entry"
      role="listitem"
      data-workflow-dock-step={step.id}
      data-workflow-dock-entry-id={entryId}
      data-workflow-tool-call-card
      data-workflow-tool-status={step.status}
      data-workflow-dock-expanded={selected}
    >
      <DockTimelineRail ordinal={ordinal} status={step.status} highlighted={highlighted} />
      <div className="workflow-dock-entry-content">
        <button
          type="button"
          onClick={() => onSelect(step)}
          aria-haspopup="dialog"
          aria-expanded={selected}
          aria-label={frontendMessage("workflow.dock.expandNode", {
            title: summary.subject || summary.label,
          })}
          className="workflow-dock-entry-row workflow-dock-tool-row"
        >
          <span className="workflow-dock-entry-phrase">
            <span className="workflow-dock-entry-title">{summary.label}</span>
            {summary.subject ? <span className="workflow-dock-entry-subject">{summary.subject}</span> : null}
          </span>
          <DockDuration durationMs={durationMs} status={step.status} />
        </button>
        {summary.detail ? <span className="workflow-dock-entry-summary">{summary.detail}</span> : null}
        {summary.parameters?.length ? <DockToolParameters parameters={summary.parameters} /> : null}
        {summary.failure ? <span className="workflow-dock-failure">{summary.failure}</span> : null}
        {summary.result ? <DockToolResultBody result={summary.result} onOpenDetails={() => onSelect(step)} /> : null}
      </div>
    </div>
  );
}

function DockToolParameters({
  parameters,
}: {
  readonly parameters: NonNullable<ReturnType<typeof projectDockToolSummary>["parameters"]>;
}): JSX.Element {
  return (
    <span className="workflow-dock-parameters">
      {parameters.map((parameter) => (
        <span key={parameter.label} className="workflow-dock-parameter">
          <span className="workflow-dock-parameter-label">{parameter.label}</span>
          <span className="workflow-dock-parameter-value">{parameter.values.join(" · ")}</span>
        </span>
      ))}
    </span>
  );
}

function DockToolResultBody({
  result,
  onOpenDetails,
}: {
  readonly result: DockToolResultBody;
  readonly onOpenDetails: () => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  switch (result.kind) {
    case "text":
      return <span className="workflow-dock-result-text">{result.text}</span>;
    case "values": {
      const visibleValues = expanded ? result.values : result.values.slice(0, DockCompactPreviewRowCount);
      return (
        <span className="workflow-dock-result-values">
          {visibleValues.map((value, index) => (
            <span key={`${index}:${value}`}>{value}</span>
          ))}
          <DockResultOverflow
            count={result.values.length - visibleValues.length}
            expanded={expanded}
            onExpandedChange={() => setExpanded((current) => !current)}
          />
        </span>
      );
    }
    case "pairs": {
      const visiblePairs = expanded ? result.pairs : result.pairs.slice(0, DockCompactPreviewRowCount);
      return (
        <span className="workflow-dock-result-pairs">
          {visiblePairs.map((pair) => (
            <span key={pair.key} className="workflow-dock-result-pair">
              <span>{pair.key}</span>
              <span>{pair.value}</span>
            </span>
          ))}
          <DockResultOverflow
            count={result.pairs.length - visiblePairs.length}
            expanded={expanded}
            onExpandedChange={() => setExpanded((current) => !current)}
          />
        </span>
      );
    }
    case "resources": {
      const visibleResources = expanded ? result.resources : result.resources.slice(0, DockCompactPreviewRowCount);
      return (
        <span className="workflow-dock-result-values workflow-dock-result-resources">
          {visibleResources.map((resource) => (
            <span key={resource}>{resource}</span>
          ))}
          <DockResultOverflow
            count={result.resources.length - visibleResources.length}
            expanded={expanded}
            onExpandedChange={() => setExpanded((current) => !current)}
          />
        </span>
      );
    }
    case "rows": {
      const visibleRows = expanded ? result.rows : result.rows.slice(0, DockCompactPreviewRowCount);
      const hiddenRows = result.rows.length - visibleRows.length;
      const unavailableRows = result.more?.count ?? 0;
      const canCompactRows = result.rows.length > DockCompactPreviewRowCount;
      return (
        <span className="workflow-dock-result-rows">
          {visibleRows.map((row, index) => (
            <DockResultRow key={`${row.title}:${index}`} row={row}>
              <span className="workflow-dock-result-row-title">{row.title}</span>
              {row.meta ? (
                <span className="workflow-dock-result-row-locator">{formatDockLocator(row.meta)}</span>
              ) : null}
              {row.description ? <span className="sr-only">{row.description}</span> : null}
            </DockResultRow>
          ))}
          <DockResultOverflow
            count={hiddenRows + unavailableRows}
            label={result.more?.label}
            expanded={expanded}
            onExpandedChange={canCompactRows ? () => setExpanded((current) => !current) : undefined}
            onOpenDetails={!canCompactRows && unavailableRows > 0 ? onOpenDetails : undefined}
          />
        </span>
      );
    }
  }
}

function DockResultRow({
  row,
  children,
}: {
  readonly row: DockToolSummaryRow;
  readonly children: ReactNode;
}): JSX.Element {
  if (!row.href) return <span className="workflow-dock-result-row">{children}</span>;
  return (
    <a
      href={row.href}
      target="_blank"
      rel="noreferrer noopener"
      className="workflow-dock-result-row workflow-dock-result-row--link"
    >
      {children}
    </a>
  );
}

function DockResultOverflow({
  count,
  label,
  expanded,
  onExpandedChange,
  onOpenDetails,
}: {
  readonly count: number;
  readonly label?: string;
  readonly expanded: boolean;
  readonly onExpandedChange?: () => void;
  readonly onOpenDetails?: () => void;
}): JSX.Element | null {
  if (expanded && onExpandedChange) {
    return (
      <button type="button" className="workflow-dock-result-more" onClick={onExpandedChange}>
        {frontendMessage("workflow.dock.collapseResultPreview")}
      </button>
    );
  }
  if (count <= 0) return null;
  const text = label ? formatFrontendMessage(label, { count }) : frontendMessage("workflow.dock.moreItems", { count });
  if (onExpandedChange) {
    return (
      <button type="button" className="workflow-dock-result-more" aria-expanded="false" onClick={onExpandedChange}>
        {text}
      </button>
    );
  }
  if (onOpenDetails) {
    return (
      <button type="button" className="workflow-dock-result-more" onClick={onOpenDetails}>
        {text}
      </button>
    );
  }
  return null;
}

function formatDockLocator(value: string): string {
  try {
    const url = new URL(value);
    return url.hostname || value;
  } catch {
    return value;
  }
}

function DockBatchNode({
  entry,
  entryId,
  firstOrdinal,
  expanded,
  onExpandedChange,
  selectedStepId,
  onSelect,
  highlighted,
  hoveredEntryId,
}: {
  readonly entry: Extract<DockWorkflowEntry, { kind: "batch" }>;
  readonly entryId: string;
  readonly firstOrdinal: number;
  readonly expanded: boolean;
  readonly onExpandedChange: () => void;
  readonly selectedStepId?: string;
  readonly onSelect: (step: TimelineStep) => void;
  readonly highlighted: boolean;
  readonly hoveredEntryId: string | null;
}): JSX.Element {
  const firstToolStep = entry.tools[0]!;
  const firstTool = projectDockToolSummary(firstToolStep);
  const title = frontendMessage("workflow.dock.callTools", {
    toolName: firstToolStep.toolName,
    count: entry.tools.length,
  });
  const status = aggregateStepStatus(entry.tools);
  return (
    <section
      className="workflow-dock-batch"
      role="group"
      data-workflow-dock-batch
      data-workflow-dock-entry-id={entryId}
      data-workflow-dock-expanded={expanded}
    >
      {expanded ? (
        <button
          type="button"
          className="workflow-dock-batch-heading"
          aria-expanded="true"
          aria-label={frontendMessage("workflow.dock.collapseNode", { title })}
          onClick={onExpandedChange}
          data-workflow-dock-batch-summary
        >
          {title}
        </button>
      ) : (
        <div className="workflow-dock-entry workflow-dock-batch-entry" role="listitem">
          <DockTimelineRail ordinal={firstOrdinal} status={status} highlighted={highlighted} />
          <div className="workflow-dock-entry-content">
            <button
              type="button"
              className="workflow-dock-entry-row workflow-dock-batch-row"
              aria-expanded="false"
              aria-label={frontendMessage("workflow.dock.expandNode", { title })}
              onClick={onExpandedChange}
              data-workflow-dock-batch-summary
            >
              <span className="workflow-dock-entry-phrase">
                <span className="workflow-dock-entry-title">{firstToolStep.toolName}</span>
                {firstTool.subject ? <span className="workflow-dock-entry-subject">{firstTool.subject}</span> : null}
              </span>
              <span className="workflow-dock-batch-count">{title}</span>
              <DockDuration durationMs={readWorkflowStepDurationMs(firstToolStep)} status={firstToolStep.status} />
            </button>
          </div>
        </div>
      )}
      {expanded ? (
        <div role="list">
          {entry.tools.map((step, index) => (
            <DockToolCallNode
              key={step.id}
              step={step}
              entryId={`tool:${step.id}`}
              ordinal={firstOrdinal + index}
              selected={selectedStepId === step.id}
              onSelect={onSelect}
              highlighted={hoveredEntryId === `tool:${step.id}` || (index === 0 && hoveredEntryId === entryId)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DockActivityNode({
  activity,
  entryId,
  ordinal,
  highlighted,
}: {
  readonly activity: RunActivityRecord;
  readonly entryId: string;
  readonly ordinal: number;
  readonly highlighted: boolean;
}): JSX.Element {
  return (
    <div
      className="workflow-dock-entry"
      role="listitem"
      data-workflow-dock-activity
      data-workflow-dock-entry-id={entryId}
    >
      <DockTimelineRail ordinal={ordinal} status={activity.status} highlighted={highlighted} />
      <div className="workflow-dock-entry-content">
        <div className="workflow-dock-entry-row">
          <span className="workflow-dock-entry-phrase">
            <span className="workflow-dock-entry-title">{runActivityLabel(activity.activity)}</span>
          </span>
          <span className={cn("workflow-dock-entry-status", statusTextClass(activity.status))}>
            {readStepStatusLabel(activity.status)}
          </span>
        </div>
      </div>
    </div>
  );
}

function DockTimelineRail({
  ordinal,
  status,
  highlighted = false,
}: {
  readonly ordinal: number | string;
  readonly status: TimelineStepStatus;
  readonly highlighted?: boolean;
}): JSX.Element {
  return (
    <span className="workflow-dock-timeline-rail">
      <span
        className={cn("workflow-dock-ordinal", `workflow-dock-ordinal--${status}`)}
        data-workflow-dock-flow-node
        data-workflow-dock-flow-node-active={highlighted || undefined}
        aria-hidden="true"
      >
        {typeof ordinal === "number" ? String(ordinal).padStart(2, "0") : ordinal}
      </span>
    </span>
  );
}

function DockDuration({
  durationMs,
  status,
}: {
  readonly durationMs: number | undefined;
  readonly status: TimelineStepStatus;
}): JSX.Element | null {
  return durationMs === undefined ? null : (
    <span
      className={cn(
        "workflow-dock-duration",
        (status === "failed" || status === "cancelled") && "workflow-dock-duration--persistent",
      )}
    >
      {formatDurationMs(durationMs)}
    </span>
  );
}

function collectDockToolBatches(
  steps: readonly TimelineStep[],
): Map<string, { readonly tools: readonly DockToolStep[] }> {
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
  return new Set(steps.flatMap((step) => (isDockToolStep(step) && step.toolBatch?.id ? [step.toolBatch.id] : [])));
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
  return step.kind === "tool" && step.toolName ? step.toolName : step.title;
}

function readDockStepSummary(step: TimelineStep): string | undefined {
  if (step.toolErrorMessage || step.errorMessage) return step.toolErrorMessage || step.errorMessage;
  if (step.childRun?.activeTools?.length) return step.childRun.activeTools.join(" · ");
  if (step.toolPresentation?.summary) return step.toolPresentation.summary;
  if (step.toolPresentation?.headline) return step.toolPresentation.headline;
  if (step.toolPreview) return step.toolPreview;
  return step.childRun?.messages?.at(-1)?.content || step.description;
}

function readEntryOrder(timestamp: string | undefined, sequence: number): number {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
  return Number.isFinite(parsed) ? parsed + sequence / 1_000_000 : Number.MAX_SAFE_INTEGER - 1_000_000 + sequence;
}

function statusTextClass(status: TimelineStepStatus): string {
  if (status === "failed" || status === "cancelled") return "text-brick-600";
  if (status === "running" || status === "cancelling") return "text-accent-content";
  return "text-content-muted";
}

function aggregateStepStatus(steps: readonly DockToolStep[]): TimelineStepStatus {
  if (steps.some((step) => step.status === "running")) return "running";
  if (steps.some((step) => step.status === "cancelling")) return "cancelling";
  if (steps.some((step) => step.status === "pending")) return "pending";
  if (steps.length > 0 && steps.every((step) => step.status === "failed")) return "failed";
  return "done";
}

function toggleSetEntry(values: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export default WorkflowDockGraph;
