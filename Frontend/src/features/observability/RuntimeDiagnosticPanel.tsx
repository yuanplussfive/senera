import { useEffect, useMemo, useRef, useState } from "react";
import {
  AgentTimeline,
  type AgentTimelineEvent,
  type AgentTimelineEventStatus,
} from "@vinyasa/ai-native/agent-timeline";
import { ToolCallCard, type ToolCallStatus } from "@vinyasa/ai-native/tool-call-card";
import { VinyasaProvider } from "@vinyasa/tokens";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import {
  activeRunActivityLabel,
  runActivityLabel,
  runActivityPresentationPriority,
  RunActivityPresentationPriorities,
} from "../workflow/runActivityPresentation";
import { projectToolActivityInspection } from "../workflow/toolActivityPresentation";
import { useStore } from "../../store/sessionStore";
import { useEventJournalStore } from "./eventJournalStore";
import {
  projectRuntimeDiagnostic,
  projectRuntimeDiagnosticFromRun,
  projectRuntimeConversationSpans,
  projectRuntimeUsageFromSessionSnapshot,
  mergeRuntimeUsageSnapshots,
  RuntimeDiagnosticLanes,
  type RuntimeDiagnosticModel,
  type RuntimeDiagnosticSpan,
} from "./runtimeDiagnosticProjection";
import type { RunRecord } from "../../store/sessionStore";
import { summarizeRun } from "../workflow/runSummary";
import { FluidHoverHighlight, useFluidHover, useMotionLevel } from "../../shared/motion";
import { ActivityStatusIcon, AppIcon } from "../../shared/ui";

const SourceMessageKeys = {
  activity: "observability.diagnostic.source.activity",
  tool: "observability.diagnostic.source.tool",
} as const;

type TimelineSelection = "total" | "run";

const EMPTY_RUNS: RunRecord[] = [];

export function RuntimeDiagnosticPanel(): JSX.Element {
  const records = useEventJournalStore((state) => state.records);
  const viewPausedAt = useEventJournalStore((state) => state.viewPausedAt);
  const activeSessionId = useStore((state) => state.activeSessionId);
  const session = useStore((state) => (activeSessionId ? state.sessions[activeSessionId] : undefined));
  const viewedRunId = useStore((state) => (activeSessionId ? state.viewedRunIdBySession[activeSessionId] : undefined));
  const setViewedRun = useStore((state) => state.setViewedRun);
  const [nowEpoch, setNowEpoch] = useState(() => Date.now());
  const [timelineSelection, setTimelineSelection] = useState<TimelineSelection>("run");
  const runs = session?.runs ?? EMPTY_RUNS;
  const latestRun = runs.at(-1);
  const selectedRun = runs.find((run) => run.requestId === viewedRunId) ?? latestRun;
  const isHistorical = selectedRun !== undefined && selectedRun.requestId !== latestRun?.requestId;
  const journalModel = useMemo(
    () =>
      projectRuntimeDiagnostic(records, {
        nowEpoch,
        pausedAt: viewPausedAt,
        activeSessionId,
        requestId: selectedRun?.requestId,
      }),
    [activeSessionId, nowEpoch, records, selectedRun?.requestId, viewPausedAt],
  );
  const sessionRuntimeUsage = useMemo(
    () => projectRuntimeUsageFromSessionSnapshot(session?.runtimeSnapshot),
    [session?.runtimeSnapshot],
  );
  const model = useMemo(() => {
    const liveUsage = mergeRuntimeUsageSnapshots(journalModel, sessionRuntimeUsage);
    const contextUsage = liveUsage.contextUsage;
    const sessionUsage = liveUsage.sessionUsage;
    if (!selectedRun) return { ...journalModel, contextUsage, sessionUsage };
    return projectRuntimeDiagnosticFromRun(selectedRun, {
      nowEpoch,
      contextUsage,
      sessionUsage,
    });
  }, [journalModel, nowEpoch, selectedRun, sessionRuntimeUsage]);
  const hasRunningSpan = model.spans.some((span) => span.status === "running");
  const conversationSpans = useMemo(
    () =>
      projectRuntimeConversationSpans(records, runs, {
        pausedAt: viewPausedAt,
        activeSessionId,
      }),
    [activeSessionId, records, runs, viewPausedAt],
  );
  const showTotalTimeline = conversationSpans.length > 0 && (timelineSelection === "total" || runs.length === 0);
  const visibleTimelineSpans = showTotalTimeline ? conversationSpans : model.spans;

  useEffect(() => {
    if (!hasRunningSpan) return undefined;
    const timer = window.setInterval(() => setNowEpoch(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [hasRunningSpan]);

  useEffect(() => {
    setTimelineSelection("run");
  }, [activeSessionId]);

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-surface-panel"
      aria-label={frontendMessage("observability.diagnostic.title")}
      data-runtime-diagnostic
    >
      <div
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]"
        data-runtime-diagnostic-scroll
      >
        <RunHistoryStrip
          runs={runs}
          selectedRun={selectedRun}
          selection={showTotalTimeline ? "total" : "run"}
          hasTotalStream={conversationSpans.length > 0}
          historical={isHistorical}
          onSelect={(requestId) => activeSessionId && setViewedRun(activeSessionId, requestId)}
          onSelectTotal={() => {
            setTimelineSelection("total");
            if (activeSessionId) setViewedRun(activeSessionId, undefined);
          }}
          onFollowLatest={() => {
            setTimelineSelection("run");
            if (activeSessionId) setViewedRun(activeSessionId, undefined);
          }}
          onSelectRun={() => setTimelineSelection("run")}
        />
        <SessionUsageConsole contextUsage={model.contextUsage} usage={model.sessionUsage} />
        {visibleTimelineSpans.length === 0 ? (
          <EmptyDiagnostic />
        ) : showTotalTimeline ? (
          <ConversationEventConsole spans={conversationSpans} />
        ) : (
          <RuntimeConsole model={model} />
        )}
      </div>
    </section>
  );
}

function RunHistoryStrip({
  runs,
  selectedRun,
  selection,
  hasTotalStream,
  historical,
  onSelect,
  onSelectTotal,
  onFollowLatest,
  onSelectRun,
}: {
  runs: readonly RunRecord[];
  selectedRun?: RunRecord;
  selection: TimelineSelection;
  hasTotalStream: boolean;
  historical: boolean;
  onSelect: (requestId: string) => void;
  onSelectTotal: () => void;
  onFollowLatest: () => void;
  onSelectRun: () => void;
}): JSX.Element | null {
  const { disableMotion } = useMotionLevel();
  const historyListRef = useRef<HTMLDivElement>(null);
  const historyHover = useFluidHover(historyListRef, { axis: "y" });
  // The selected run paints its own wash; the hover layer yields on that row.
  const selectedRunPosition = runs.findIndex((run) => run.requestId === selectedRun?.requestId);
  const selectedRunIndex =
    selection === "total" ? 0 : selectedRunPosition >= 0 ? selectedRunPosition + (hasTotalStream ? 1 : 0) : -1;
  if (runs.length === 0 && !hasTotalStream) return null;
  return (
    <section className="border-b border-line-subtle px-3 pb-2 pt-2.5 sm:px-4" data-run-history>
      <div className="mb-1 flex items-center gap-2 text-[10px] text-content-muted">
        <AppIcon icon="history" size={12} aria-hidden="true" />
        <span>{frontendMessage("observability.diagnostic.runHistory")}</span>
        <span className="ml-auto font-mono tabular-nums text-content-disabled">{runs.length}</span>
      </div>
      <div
        ref={historyListRef}
        className="relative max-h-[144px] min-w-0 overflow-y-auto"
        role="list"
        {...historyHover.handlers}
      >
        <FluidHoverHighlight
          hover={historyHover}
          hidden={disableMotion || historyHover.activeIndex === selectedRunIndex}
          className="rounded-md"
        />
        {hasTotalStream ? (
          <TimelineHistoryItem
            itemRef={historyHover.getItemRef(0)}
            fluidHoverEnabled={!disableMotion}
            selected={selection === "total"}
            onSelect={onSelectTotal}
          />
        ) : null}
        {runs.map((run, index) => (
          <RunHistoryItem
            key={run.requestId}
            itemRef={historyHover.getItemRef(index + (hasTotalStream ? 1 : 0))}
            fluidHoverEnabled={!disableMotion}
            run={run}
            index={index}
            total={runs.length}
            selected={selection === "run" && run.requestId === selectedRun?.requestId}
            onSelect={() => {
              onSelectRun();
              onSelect(run.requestId);
            }}
          />
        ))}
      </div>
      {historical ? (
        <button
          type="button"
          className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-content-secondary hover:text-content-primary"
          onClick={onFollowLatest}
        >
          <AppIcon icon="refresh" size={12} aria-hidden="true" />
          {frontendMessage("workflow.panel.followLatest")}
        </button>
      ) : null}
    </section>
  );
}

function TimelineHistoryItem({
  itemRef,
  fluidHoverEnabled,
  selected,
  onSelect,
}: {
  itemRef: (element: HTMLElement | null) => void;
  fluidHoverEnabled: boolean;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const label = frontendMessage("observability.diagnostic.timeline.total");
  return (
    <button
      type="button"
      ref={itemRef}
      aria-pressed={selected}
      aria-label={label}
      onClick={onSelect}
      className={cn(
        "group relative z-10 grid min-h-[42px] w-full min-w-0 grid-cols-[16px_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        selected
          ? "bg-surface-hover text-content-primary"
          : cn("text-content-secondary", fluidHoverEnabled ? "hover:bg-transparent" : "hover:bg-surface-hover/70"),
      )}
    >
      <span className="grid h-4 w-4 place-items-center text-accent-content">
        <AppIcon icon="list" size={14} aria-hidden="true" />
      </span>
      <span className="min-w-0 truncate text-[11px] font-medium text-content-primary">{label}</span>
    </button>
  );
}

function RunHistoryItem({
  itemRef,
  fluidHoverEnabled,
  run,
  index,
  total,
  selected,
  onSelect,
}: {
  itemRef: (element: HTMLElement | null) => void;
  fluidHoverEnabled: boolean;
  run: RunRecord;
  index: number;
  total: number;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const summary = summarizeRun(run);
  const status = run.status;
  const label = run.input || frontendMessage("workflow.run.emptyInput");
  return (
    <button
      type="button"
      ref={itemRef}
      aria-pressed={selected}
      aria-label={`${frontendMessage("workflow.run.index", { index: index + 1, total })}: ${label}`}
      onClick={onSelect}
      className={cn(
        "group relative z-10 grid min-h-[42px] w-full min-w-0 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        selected
          ? "bg-surface-hover text-content-primary"
          : cn("text-content-secondary", fluidHoverEnabled ? "hover:bg-transparent" : "hover:bg-surface-hover/70"),
      )}
    >
      <span className="grid h-4 w-4 place-items-center">
        <RunHistoryStatus status={status} />
      </span>
      <div className="min-w-0">
        <span className="block truncate text-[11px] font-medium text-content-primary">{label}</span>
        <span className="mt-0.5 block truncate font-mono text-[9px] tabular-nums text-content-muted">
          {frontendMessage("workflow.run.index", { index: index + 1, total })}
          <span className="px-1 text-content-disabled">·</span>
          {summary.startedAt}
          {summary.tools > 0 ? (
            <>
              <span className="px-1 text-content-disabled">·</span>
              {summary.tools} {frontendMessage("workflow.summary.tools")}
            </>
          ) : null}
        </span>
      </div>
      <span
        className={cn(
          "shrink-0 font-mono text-[9.5px] tabular-nums",
          summary.failed > 0 ? "text-brick-600" : "text-content-muted",
        )}
      >
        {summary.failed > 0
          ? frontendMessage("workflow.feed.failedCount", { count: summary.failed })
          : summary.duration || frontendMessage("workflow.run.inProgress")}
      </span>
    </button>
  );
}

function RunHistoryStatus({ status }: { status: RunRecord["status"] }): JSX.Element {
  if (status === "running" || status === "cancelling") {
    return <ActivityStatusIcon status={status} size={13} className="text-accent-content" />;
  }
  if (status === "failed")
    return <AppIcon icon="alert-circle" size={12} className="text-brick-600" aria-hidden="true" />;
  if (status === "cancelled")
    return <AppIcon icon="close" size={12} className="text-content-muted" aria-hidden="true" />;
  return <AppIcon icon="checkmark" size={12} className="text-moss-600" aria-hidden="true" />;
}

function SessionUsageConsole({
  contextUsage,
  usage,
}: {
  contextUsage: RuntimeDiagnosticModel["contextUsage"];
  usage: RuntimeDiagnosticModel["sessionUsage"];
}): JSX.Element | null {
  const hasContextTokens = contextUsage?.tokens !== null && contextUsage?.tokens !== undefined;
  const used = hasContextTokens ? Math.max(0, contextUsage.tokens) : 0;
  const percent = contextUsage
    ? Math.max(
        0,
        Math.min(100, contextUsage.percent ?? (hasContextTokens ? (used / contextUsage.contextWindow) * 100 : 0)),
      )
    : 0;
  const contextValue =
    contextUsage && hasContextTokens
      ? frontendMessage("observability.diagnostic.usage.used", { count: formatTokenCount(used) })
      : undefined;
  const stats = [
    ["observability.diagnostic.usage.totalTokens", usage ? formatTokenCount(usage.tokens.total) : "--"],
    ["observability.diagnostic.usage.input", usage ? formatTokenCount(usage.tokens.input) : "--"],
    ["observability.diagnostic.usage.output", usage ? formatTokenCount(usage.tokens.output) : "--"],
    ["observability.diagnostic.usage.cacheRead", usage ? formatTokenCount(usage.tokens.cacheRead) : "--"],
    ["observability.diagnostic.usage.cacheWrite", usage ? formatTokenCount(usage.tokens.cacheWrite) : "--"],
    ["observability.diagnostic.usage.toolCalls", usage ? formatInteger(usage.toolCalls) : "--"],
    ["observability.diagnostic.usage.messages", usage ? formatInteger(usage.totalMessages) : "--"],
    ["observability.diagnostic.usage.cost", usage ? formatCost(usage.cost) : "--"],
  ] as const satisfies readonly (readonly [FrontendMessageKey, string])[];

  if (!contextValue && !usage) return null;

  return (
    <section
      className="px-3 pb-3 pt-1 sm:px-4"
      data-session-usage-board
      aria-label={frontendMessage("observability.diagnostic.usage.title")}
    >
      {contextValue ? (
        <>
          <div className="flex min-w-0 items-baseline text-[10px]">
            <strong className="min-w-0 truncate text-[12px] font-semibold tabular-nums text-content-primary">
              {contextValue}
            </strong>
          </div>
          <div
            className="mt-1.5 h-1 overflow-hidden bg-line-subtle"
            role="progressbar"
            aria-label={frontendMessage("observability.diagnostic.usage.prompt")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            data-context-usage-meter
          >
            <span
              className={cn(
                "block h-full w-full origin-left transition-[transform,background-color] duration-300",
                percent >= 90 ? "bg-brick-500" : percent >= 75 ? "bg-umber-500" : "bg-moss-500",
              )}
              style={{ transform: `scaleX(${percent / 100})` }}
            />
          </div>
        </>
      ) : null}
      {usage ? (
        <div className="mt-2 grid min-w-0 grid-cols-2 gap-x-4 gap-y-1 text-[9.5px] text-content-muted">
          {stats.map(([label, value]) => (
            <span key={label} className="inline-flex min-w-0 items-baseline justify-between gap-2">
              <span className="truncate">{frontendMessage(label)}</span>
              <span className="shrink-0 tabular-nums text-content-secondary">{value}</span>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RuntimeConsole({ model }: { model: RuntimeDiagnosticModel }): JSX.Element | null {
  const spans = readTimelineSpans(model);
  if (spans.length === 0) return null;
  const events = spans.map(runtimeTimelineEvent);
  return (
    <section aria-label={frontendMessage("observability.diagnostic.timeline")} data-runtime-event-stream>
      <div className="flex h-8 items-center justify-between border-y border-line-subtle bg-surface-panel/95 px-3 text-[9px] text-content-muted backdrop-blur sm:px-4">
        <span>{frontendMessage("observability.diagnostic.timeline.current")}</span>
      </div>
      <div className="relative px-3 pb-3 pt-2 sm:px-4" data-runtime-event-stream-list>
        <VinyasaProvider brand="dusk" density="compact">
          <AgentTimeline events={events} />
        </VinyasaProvider>
      </div>
    </section>
  );
}

function ConversationEventConsole({ spans }: { spans: readonly RuntimeDiagnosticSpan[] }): JSX.Element | null {
  const events = readTimelineEventSpans(spans, { includeForegroundActivities: true }).map(runtimeTimelineEvent);
  if (events.length === 0) return null;
  return (
    <section aria-label={frontendMessage("observability.diagnostic.timeline.total")} data-runtime-total-event-stream>
      <div className="flex h-8 items-center border-y border-line-subtle bg-surface-panel/95 px-3 text-[9px] text-content-muted backdrop-blur sm:px-4">
        <span>{frontendMessage("observability.diagnostic.timeline.total")}</span>
      </div>
      <div className="relative px-3 pb-3 pt-2 sm:px-4" data-runtime-total-event-stream-list>
        <VinyasaProvider brand="dusk" density="compact">
          <AgentTimeline events={events} />
        </VinyasaProvider>
      </div>
    </section>
  );
}

function runtimeTimelineEvent(span: RuntimeDiagnosticSpan): AgentTimelineEvent {
  return {
    id: span.id,
    type: runtimeTimelineType(span),
    label: span.source === "tool" ? <RuntimeToolTimelineLabel span={span} /> : <RuntimeStepTimelineLabel span={span} />,
    timestamp: new Date(span.startedAtEpoch),
    status: runtimeTimelineStatus([span]),
  };
}

function RuntimeStepTimelineLabel({ span }: { span: RuntimeDiagnosticSpan }): JSX.Element {
  const title = spanLabel(span);
  const preview = span.operation
    ? runActivityLabel(span.operation)
    : span.eventKind
      ? compactEventText(span.description)
      : undefined;
  return (
    <span className="runtime-vinyasa-step-label" data-runtime-event={span.id} data-runtime-span={span.id}>
      {runtimeStepUsesToolCard(span) ? (
        <ToolCallCard
          toolName={runtimeStepCardTitle(span)}
          status={runtimeToolStatus(span.status)}
          args={runtimeStepCardArgs(span)}
          result={runtimeStepCardResult(span)}
        />
      ) : (
        <span className="runtime-vinyasa-step-label__static" aria-label={title}>
          <span className="min-w-0 truncate">{title}</span>
          {preview && preview !== title ? <span className="runtime-vinyasa-step-label__preview">{preview}</span> : null}
        </span>
      )}
    </span>
  );
}

function runtimeStepUsesToolCard(span: RuntimeDiagnosticSpan): boolean {
  return (
    span.isThinking === true ||
    span.kind === "understand" ||
    span.kind === "prompt" ||
    span.kind === "decision" ||
    span.kind === "answer"
  );
}

function runtimeStepCardTitle(span: RuntimeDiagnosticSpan): string {
  const detail = compactEventText(span.description);
  if (span.isThinking) return span.label ?? detail ?? "";
  if (span.kind === "understand") {
    return detail
      ? frontendMessage("observability.diagnostic.timeline.userDetail", { text: detail })
      : frontendMessage("observability.diagnostic.timeline.userRequest");
  }
  if (span.kind === "prompt") {
    return detail
      ? frontendMessage("observability.diagnostic.timeline.promptDetail", { text: detail })
      : frontendMessage("observability.diagnostic.timeline.prompt");
  }
  if (span.kind === "decision") return detail ?? frontendMessage("observability.diagnostic.timeline.preResponse");
  if (span.kind === "answer") return detail ?? frontendMessage("observability.diagnostic.timeline.response");
  return detail ?? frontendMessage("observability.diagnostic.timeline.runtime");
}

function runtimeStepCardArgs(span: RuntimeDiagnosticSpan): string | undefined {
  return span.kind === "understand" || span.kind === "prompt" ? span.description?.trim() : undefined;
}

function runtimeStepCardResult(span: RuntimeDiagnosticSpan): string | undefined {
  return span.isThinking || span.kind === "decision" || span.kind === "answer" ? span.description?.trim() : undefined;
}

function RuntimeToolTimelineLabel({ span }: { span: RuntimeDiagnosticSpan }): JSX.Element {
  return (
    <span className="runtime-vinyasa-tool-label" data-runtime-vinyasa-tool-event data-runtime-tool-call={span.id}>
      <ToolCallCard
        toolName={compactEventText(toolCallTitle(span)) ?? frontendMessage(SourceMessageKeys.tool)}
        status={runtimeToolStatus(span.status)}
        args={compactEventText(toolCallPreview(span))}
        result={compactEventText(toolCallResult(span))}
      />
    </span>
  );
}

function runtimeTimelineType(span: RuntimeDiagnosticSpan): string {
  if (span.source === "tool") return frontendMessage(SourceMessageKeys.tool);
  if (span.isThinking) return span.label ?? "";
  if (span.kind === "model") {
    return frontendMessage("observability.diagnostic.timeline.requestModel", {
      model: compactEventText(span.modelName) ?? "",
    });
  }
  if (span.kind === "understand") return frontendMessage("observability.diagnostic.timeline.userRequest");
  if (span.kind === "prompt") return frontendMessage("observability.diagnostic.timeline.prompt");
  if (span.kind === "decision") return frontendMessage("observability.diagnostic.timeline.preResponse");
  if (span.kind === "answer") return frontendMessage("observability.diagnostic.timeline.response");
  if (span.lane === RuntimeDiagnosticLanes.Context) return frontendMessage("observability.diagnostic.lane.context");
  if (span.lane === RuntimeDiagnosticLanes.Model) return frontendMessage("observability.diagnostic.lane.model");
  if (span.lane === RuntimeDiagnosticLanes.Response) return frontendMessage("observability.diagnostic.lane.response");
  if (span.lane === RuntimeDiagnosticLanes.Runtime) return frontendMessage("observability.diagnostic.lane.runtime");
  return frontendMessage(SourceMessageKeys.activity);
}

function runtimeTimelineStatus(spans: readonly RuntimeDiagnosticSpan[]): AgentTimelineEventStatus {
  if (spans.some((span) => span.status === "running")) return "running";
  if (spans.some((span) => span.status === "failed" || span.status === "cancelled")) return "error";
  return "success";
}

function runtimeToolStatus(status: RuntimeDiagnosticSpan["status"]): ToolCallStatus {
  if (status === "running") return "running";
  if (status === "failed" || status === "cancelled") return "error";
  if (status === "completed") return "success";
  return "pending";
}

function EmptyDiagnostic(): JSX.Element {
  return (
    <div className="flex items-center gap-2 px-3 py-4 text-[10.5px] text-content-muted sm:px-4">
      <span className="text-content-disabled">›</span>
      <span>{frontendMessage("observability.diagnostic.noRun")}</span>
    </div>
  );
}

function toolCallInspection(span: RuntimeDiagnosticSpan) {
  return projectToolActivityInspection({
    toolName: span.toolName ?? toolOriginLabel(span),
    origin: span.toolOrigin,
    arguments: span.toolArguments,
    result: span.toolPresentation,
    status:
      span.status === "running"
        ? "active"
        : span.status === "failed" || span.status === "cancelled"
          ? "failed"
          : "completed",
  });
}

function toolCallTitle(span: RuntimeDiagnosticSpan): string {
  const inspection = toolCallInspection(span);
  return inspection.identity ?? inspection.label;
}

function toolCallPreview(span: RuntimeDiagnosticSpan): string {
  const inspection = toolCallInspection(span);
  return inspection.argumentPreview ?? span.purpose ?? "";
}

function toolCallResult(span: RuntimeDiagnosticSpan): string | undefined {
  if (span.toolErrorMessage?.trim()) return span.toolErrorMessage.trim();
  if (span.toolResult !== undefined && span.toolResult !== null) {
    if (typeof span.toolResult === "string") return span.toolResult.trim() || undefined;
    try {
      const serialized = JSON.stringify(span.toolResult);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // A result that cannot be serialized is still represented by its status.
    }
  }
  return span.toolPreview?.trim() || undefined;
}

function readTimelineSpans(model: RuntimeDiagnosticModel): readonly RuntimeDiagnosticSpan[] {
  return readTimelineEventSpans(model.spans);
}

function readTimelineEventSpans(
  spans: readonly RuntimeDiagnosticSpan[],
  options: { readonly includeForegroundActivities?: boolean } = {},
): readonly RuntimeDiagnosticSpan[] {
  return spans.filter((span) => {
    // Ambient activity labels duplicate concrete steps. Keep only foreground
    // lifecycle activity in the complete session stream.
    if (span.source === "activity") {
      return (
        options.includeForegroundActivities &&
        span.operation !== undefined &&
        runActivityPresentationPriority(span.operation) === RunActivityPresentationPriorities.Foreground
      );
    }
    if (span.source === "tool" && isUnidentifiedToolSpan(span)) return false;
    return true;
  });
}

function isUnidentifiedToolSpan(span: RuntimeDiagnosticSpan): boolean {
  if (!span.callId?.trim()) return true;
  const toolIdentity = span.toolName?.trim() || span.toolOrigin?.tool?.trim() || span.toolOrigin?.name?.trim();
  return !toolIdentity;
}

function spanLabel(span: RuntimeDiagnosticSpan): string {
  if (span.source === "tool") return toolCallTitle(span);
  if (span.eventKind && span.label) return span.label;
  if (span.isThinking) return span.label ?? "";
  if (span.kind === "model") {
    const model = compactEventText(span.modelName ?? span.description);
    return model
      ? frontendMessage("observability.diagnostic.timeline.requestModel", { model })
      : (compactEventText(span.label) ?? "");
  }
  if (span.kind === "answer") {
    const detail = compactEventText(span.description);
    return detail ?? frontendMessage("observability.diagnostic.timeline.response");
  }
  if (span.kind === "decision") {
    const detail = compactEventText(span.description);
    return detail ?? frontendMessage("observability.diagnostic.timeline.preResponse");
  }
  if (span.source === "step" && span.label) return span.label;
  if (!span.operation) return frontendMessage("observability.diagnostic.currentNone");
  return span.status === "running" ? activeRunActivityLabel(span.operation) : runActivityLabel(span.operation);
}

function toolOriginLabel(span: RuntimeDiagnosticSpan): string {
  if (span.toolOrigin?.kind === "mcp") {
    return `MCP${span.toolOrigin.server ? ` / ${span.toolOrigin.server}` : ""}`;
  }
  return span.toolOrigin?.name ?? frontendMessage(SourceMessageKeys.tool);
}

function compactEventText(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/gu, " ").trim();
  if (!text) return undefined;
  return text.length > 96 ? `${text.slice(0, 93).trimEnd()}...` : text;
}

function formatTokenCount(tokens: number): string {
  const value = Math.max(0, tokens);
  if (value >= 100_000_000) return formatCompactUnit(value / 100_000_000, "亿");
  if (value >= 10_000) return formatCompactUnit(value / 10_000, "w");
  if (value >= 1_000) return formatCompactUnit(value / 1_000, "k");
  return `${Math.round(value)}`;
}

function formatCompactUnit(value: number, suffix: string): string {
  const rounded = value
    .toFixed(2)
    .replace(/\.0+$/u, "")
    .replace(/(\.\d*[1-9])0+$/u, "$1");
  return `${rounded}${suffix}`;
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatCost(value: number): string {
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}
