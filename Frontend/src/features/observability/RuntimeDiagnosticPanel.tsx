import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, CircleAlert, History, RotateCcw, X } from "lucide-react";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { frontendFeatureMessage } from "../../i18n/frontendFeatureMessageCatalog";
import { cn } from "../../lib/util";
import { activeRunActivityLabel, runActivityLabel } from "../workflow/runActivityPresentation";
import { projectToolActivity } from "../workflow/toolActivityPresentation";
import { useStore } from "../../store/sessionStore";
import { useEventJournalStore } from "./eventJournalStore";
import {
  projectRuntimeDiagnostic,
  projectRuntimeDiagnosticFromRun,
  RuntimeDiagnosticLanes,
  type RuntimeDiagnosticHealth,
  type RuntimeDiagnosticModel,
  type RuntimeDiagnosticSpan,
} from "./runtimeDiagnosticProjection";
import type { RunRecord } from "../../store/sessionStore";
import { summarizeRun } from "../workflow/runSummary";
import { Spinner, Tooltip } from "../../shared/ui";

const StatusMessageKeys = {
  healthy: "observability.diagnostic.status.healthy",
  active: "observability.diagnostic.status.active",
  failed: "observability.diagnostic.status.failed",
  unknown: "observability.diagnostic.status.unknown",
  running: "observability.diagnostic.status.running",
  completed: "observability.diagnostic.status.completed",
} as const satisfies Record<RuntimeDiagnosticHealth | "running" | "completed", FrontendMessageKey>;

const HealthMessageKeys = {
  connection: "observability.diagnostic.status.connection",
  runtime: "observability.diagnostic.status.runtime",
  model: "observability.diagnostic.status.model",
  tools: "observability.diagnostic.status.tools",
  response: "observability.diagnostic.status.response",
} as const satisfies Record<string, FrontendMessageKey>;

const SourceMessageKeys = {
  activity: "observability.diagnostic.source.activity",
  tool: "observability.diagnostic.source.tool",
} as const;

export function RuntimeDiagnosticPanel(): JSX.Element {
  const records = useEventJournalStore((state) => state.records);
  const viewPausedAt = useEventJournalStore((state) => state.viewPausedAt);
  const activeSessionId = useStore((state) => state.activeSessionId);
  const session = useStore((state) => (activeSessionId ? state.sessions[activeSessionId] : undefined));
  const viewedRunId = useStore((state) => (activeSessionId ? state.viewedRunIdBySession[activeSessionId] : undefined));
  const setViewedRun = useStore((state) => state.setViewedRun);
  const [nowEpoch, setNowEpoch] = useState(() => Date.now());
  const [expandedSpanId, setExpandedSpanId] = useState<string>();
  const runs = session?.runs ?? [];
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
  const model = useMemo(
    () =>
      selectedRun && !isHistorical && journalModel.spans.length > 0
        ? journalModel
        : selectedRun
          ? projectRuntimeDiagnosticFromRun(selectedRun, {
              nowEpoch,
              contextUsage: journalModel.contextUsage,
              sessionUsage: journalModel.sessionUsage,
            })
          : journalModel,
    [isHistorical, journalModel, nowEpoch, selectedRun],
  );
  const hasRunningSpan = selectedRun?.status === "running" || selectedRun?.status === "cancelling";

  useEffect(() => {
    if (!hasRunningSpan) return undefined;
    const timer = window.setInterval(() => setNowEpoch(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [hasRunningSpan]);

  useEffect(() => {
    if (!expandedSpanId || model.spans.some((span) => span.id === expandedSpanId)) return;
    setExpandedSpanId(undefined);
  }, [expandedSpanId, model.spans]);

  const overallStatus = readOverallStatus(model);
  const elapsedMs =
    model.startedAtEpoch === undefined || model.endAtEpoch === undefined
      ? undefined
      : Math.max(0, model.endAtEpoch - model.startedAtEpoch);

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-surface-panel"
      aria-label={frontendMessage("observability.diagnostic.title")}
      data-runtime-diagnostic
    >
      <div
        className="scrollbar-thin min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
        data-runtime-diagnostic-scroll
      >
        <RunHistoryStrip
          runs={runs}
          selectedRun={selectedRun}
          historical={isHistorical}
          onSelect={(requestId) => activeSessionId && setViewedRun(activeSessionId, requestId)}
          onFollowLatest={() => activeSessionId && setViewedRun(activeSessionId, undefined)}
        />
        <ConsoleHeader
          model={model}
          overallStatus={overallStatus}
          elapsedMs={elapsedMs}
          paused={viewPausedAt !== undefined}
        />
        <SessionUsageConsole contextUsage={model.contextUsage} usage={model.sessionUsage} />
        <HealthConsole model={model} />
        {model.spans.length === 0 ? (
          <EmptyDiagnostic />
        ) : (
          <>
            <RuntimeTrajectoryOverview model={model} />
            <RuntimeConsole
              model={model}
              expandedSpanId={expandedSpanId}
              onToggle={(spanId) => setExpandedSpanId((current) => (current === spanId ? undefined : spanId))}
            />
          </>
        )}
      </div>
    </section>
  );
}

function RunHistoryStrip({
  runs,
  selectedRun,
  historical,
  onSelect,
  onFollowLatest,
}: {
  runs: readonly RunRecord[];
  selectedRun?: RunRecord;
  historical: boolean;
  onSelect: (requestId: string) => void;
  onFollowLatest: () => void;
}): JSX.Element | null {
  if (runs.length === 0) return null;
  return (
    <section className="border-b border-line-subtle px-3 pb-2 pt-2.5 sm:px-4" data-run-history>
      <div className="mb-1 flex items-center gap-2 text-[10px] text-content-muted">
        <History className="h-3 w-3" aria-hidden="true" />
        <span>{frontendMessage("observability.diagnostic.runHistory")}</span>
        <span className="ml-auto font-mono tabular-nums text-content-disabled">{runs.length}</span>
      </div>
      <div className="scrollbar-thin max-h-[144px] min-w-0 overflow-y-auto" role="list">
        {runs.map((run, index) => (
          <RunHistoryItem
            key={run.requestId}
            run={run}
            index={index}
            total={runs.length}
            selected={run.requestId === selectedRun?.requestId}
            onSelect={() => onSelect(run.requestId)}
          />
        ))}
      </div>
      {historical ? (
        <button
          type="button"
          className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-content-secondary hover:text-content-primary"
          onClick={onFollowLatest}
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
          {frontendMessage("workflow.panel.followLatest")}
        </button>
      ) : null}
    </section>
  );
}

function RunHistoryItem({
  run,
  index,
  total,
  selected,
  onSelect,
}: {
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
      aria-pressed={selected}
      aria-label={`${frontendMessage("workflow.run.index", { index: index + 1, total })}: ${label}`}
      onClick={onSelect}
      className={cn(
        "group grid min-h-[42px] w-full min-w-0 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        selected ? "bg-surface-hover text-content-primary" : "text-content-secondary hover:bg-surface-hover/70",
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
  if (status === "running" || status === "cancelling") return <Spinner size="xs" className="text-accent-content" />;
  if (status === "failed") return <CircleAlert className="h-3 w-3 text-brick-600" aria-hidden="true" />;
  if (status === "cancelled") return <X className="h-3 w-3 text-content-muted" aria-hidden="true" />;
  return <Check className="h-3 w-3 text-moss-600" aria-hidden="true" />;
}

function ConsoleHeader({
  model,
  overallStatus,
  elapsedMs,
  paused,
}: {
  model: RuntimeDiagnosticModel;
  overallStatus: RuntimeDiagnosticHealth;
  elapsedMs?: number;
  paused: boolean;
}): JSX.Element {
  return (
    <header className="px-3 pb-2 pt-3 sm:px-4" data-runtime-diagnostic-header>
      <div className="flex min-w-0 items-center gap-2 text-[11px]">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", statusDotClass(overallStatus))} aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate font-sans text-[12px] font-semibold text-content-primary">
          {frontendFeatureMessage("observability.diagnostic.consoleTitle")}
        </h2>
        <span className={cn("shrink-0 font-sans text-[10px]", statusTextClass(overallStatus))}>
          {statusLabel(overallStatus)}
        </span>
        {elapsedMs !== undefined ? (
          <span className="shrink-0 text-[10px] tabular-nums text-content-muted">{formatDuration(elapsedMs)}</span>
        ) : null}
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-2 pl-4 text-[10px] text-content-muted">
        <span>{frontendMessage(paused ? "observability.diagnostic.paused" : "observability.diagnostic.live")}</span>
        {model.requestId ? (
          <>
            <span className="text-content-disabled">/</span>
            <span className="min-w-0 truncate">{shortIdentifier(model.requestId)}</span>
          </>
        ) : null}
      </div>
    </header>
  );
}

function SessionUsageConsole({
  contextUsage,
  usage,
}: {
  contextUsage: RuntimeDiagnosticModel["contextUsage"];
  usage: RuntimeDiagnosticModel["sessionUsage"];
}): JSX.Element {
  const hasContextTokens = contextUsage?.tokens !== null && contextUsage?.tokens !== undefined;
  const used = hasContextTokens ? Math.max(0, contextUsage.tokens) : 0;
  const remaining = contextUsage ? Math.max(0, contextUsage.contextWindow - used) : undefined;
  const percent = contextUsage
    ? Math.max(
        0,
        Math.min(100, contextUsage.percent ?? (hasContextTokens ? (used / contextUsage.contextWindow) * 100 : 0)),
      )
    : 0;
  const contextValue =
    contextUsage && hasContextTokens
      ? `${formatPercent(percent)}%  ${formatTokenCount(used)} / ${formatTokenCount(contextUsage.contextWindow)}`
      : frontendMessage("observability.diagnostic.usage.unknown");
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

  return (
    <section
      className="px-3 pb-3 pt-1 sm:px-4"
      data-session-usage-board
      aria-label={frontendMessage("observability.diagnostic.usage.title")}
    >
      <div className="flex min-w-0 items-baseline gap-2 text-[10px]">
        <span className="shrink-0 text-content-muted">{frontendMessage("observability.diagnostic.usage.context")}</span>
        <strong className="min-w-0 flex-1 truncate text-[12px] font-semibold tabular-nums text-content-primary">
          {contextValue}
        </strong>
        {remaining !== undefined ? (
          <span className="shrink-0 tabular-nums text-content-muted">
            {frontendMessage("observability.diagnostic.context.remaining", { count: formatTokenCount(remaining) })}
          </span>
        ) : null}
      </div>
      <div
        className="mt-1.5 h-1 overflow-hidden bg-line-subtle"
        role="progressbar"
        aria-label={frontendMessage("observability.diagnostic.usage.context")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={contextUsage && hasContextTokens ? percent : 0}
        data-context-usage-meter
      >
        <span
          className={cn(
            "block h-full transition-[width,background-color] duration-300",
            percent >= 90 ? "bg-brick-500" : percent >= 75 ? "bg-umber-500" : "bg-moss-500",
          )}
          style={{ width: contextUsage && hasContextTokens ? `${percent}%` : "0%" }}
        />
      </div>
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

function HealthConsole({ model }: { model: RuntimeDiagnosticModel }): JSX.Element {
  const items = [
    { id: "connection", status: model.connection },
    { id: "runtime", status: readLaneHealth(model, RuntimeDiagnosticLanes.Runtime) },
    { id: "model", status: readLaneHealth(model, RuntimeDiagnosticLanes.Model) },
    { id: "tools", status: readLaneHealth(model, RuntimeDiagnosticLanes.Tools) },
    { id: "response", status: readLaneHealth(model, RuntimeDiagnosticLanes.Response) },
  ] as const;

  return (
    <div className="px-3 pb-3 sm:px-4" data-runtime-health-console>
      <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[10px]">
        {items.map(({ id, status }) => (
          <span key={id} className="inline-flex min-w-0 items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(status))} aria-hidden="true" />
            <span className="text-content-muted">{frontendMessage(HealthMessageKeys[id])}</span>
            <span className={cn("font-medium", statusTextClass(status))}>{healthStatusLabel(id, status)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function RuntimeTrajectoryOverview({ model }: { model: RuntimeDiagnosticModel }): JSX.Element {
  const start = model.startedAtEpoch ?? model.spans[0]?.startedAtEpoch ?? model.nowEpoch;
  const end = Math.max(start + 1, model.endAtEpoch ?? model.nowEpoch);
  const duration = end - start;
  const lanes = model.lanes.filter((lane) => lane.spans.length > 0);

  return (
    <section
      className="border-y border-line-subtle bg-surface-subtle/25 px-3 py-2.5 sm:px-4"
      aria-label={frontendFeatureMessage("observability.diagnostic.trajectoryOverview")}
      data-runtime-trajectory-overview
    >
      <div className="mb-2 flex items-center justify-between text-[9.5px] text-content-muted">
        <span>{frontendFeatureMessage("observability.diagnostic.trajectoryOverview")}</span>
        <span className="font-mono tabular-nums text-content-disabled">{formatDuration(duration)}</span>
      </div>
      <div className="space-y-1.5">
        {lanes.map((lane) => (
          <div key={lane.lane} className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-2">
            <span className="truncate text-[9px] text-content-muted">{laneLabel(lane.lane)}</span>
            <div className="relative h-2 overflow-hidden rounded-[2px] bg-line-subtle/70">
              {lane.spans.map((span) => {
                const left = ((span.startedAtEpoch - start) / duration) * 100;
                const spanDuration =
                  span.durationMs ??
                  (span.status === "running" ? Math.max(0, model.nowEpoch - span.startedAtEpoch) : 0);
                const width = Math.max(0.8, (spanDuration / duration) * 100);
                return (
                  <Tooltip
                    key={span.id}
                    content={`${spanLabel(span)} · ${formatSpanDuration(span, model.nowEpoch)}`}
                    side="top"
                  >
                    <span
                      className={cn(
                        "absolute inset-y-0 rounded-[2px] opacity-85",
                        trajectorySpanClass(span),
                        span.status === "running" && "motion-safe:animate-pulse",
                      )}
                      style={{ left: `${Math.max(0, Math.min(100, left))}%`, width: `${Math.min(100, width)}%` }}
                    />
                  </Tooltip>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RuntimeConsole({
  model,
  expandedSpanId,
  onToggle,
}: {
  model: RuntimeDiagnosticModel;
  expandedSpanId?: string;
  onToggle: (spanId: string) => void;
}): JSX.Element {
  return (
    <section aria-label={frontendMessage("observability.diagnostic.timeline")} data-runtime-waterfall>
      <div className="sticky top-0 z-[1] grid h-8 grid-cols-[26px_58px_minmax(0,1fr)_48px_12px] items-center gap-1.5 border-b border-line-subtle bg-surface-panel/95 px-3 text-[9px] text-content-muted backdrop-blur sm:px-4">
        <span aria-label={frontendFeatureMessage("observability.diagnostic.trajectoryIndex")}>#</span>
        <span>{frontendFeatureMessage("observability.diagnostic.trajectoryEvent")}</span>
        <span>{frontendFeatureMessage("observability.diagnostic.trajectoryContent")}</span>
        <span className="text-right">{frontendFeatureMessage("observability.diagnostic.detail.duration")}</span>
        <span aria-hidden="true" />
      </div>
      <div data-runtime-terminal-stream>
        {model.spans.map((span, index) => (
          <RuntimeConsoleRow
            key={span.id}
            index={index + 1}
            span={span}
            nowEpoch={model.nowEpoch}
            expanded={span.id === expandedSpanId}
            onToggle={onToggle}
          />
        ))}
      </div>
    </section>
  );
}

function RuntimeConsoleRow({
  index,
  span,
  nowEpoch,
  expanded,
  onToggle,
}: {
  index: number;
  span: RuntimeDiagnosticSpan;
  nowEpoch: number;
  expanded: boolean;
  onToggle: (spanId: string) => void;
}): JSX.Element {
  const label = spanLabel(span);
  const ToggleIcon = expanded ? ChevronDown : ChevronRight;
  return (
    <div
      className={cn("group border-b border-line-subtle/65", expanded && "bg-surface-subtle/45")}
      data-runtime-span={span.id}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${label} · ${statusLabel(span.status)} · ${formatSpanDuration(span, nowEpoch)}`}
        className="grid min-h-9 w-full min-w-0 grid-cols-[26px_58px_minmax(0,1fr)_48px_12px] items-center gap-1.5 px-3 py-1.5 text-left outline-none transition-colors hover:bg-surface-hover/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus sm:px-4"
        onClick={() => onToggle(span.id)}
      >
        <span className="font-mono text-[9px] tabular-nums text-content-disabled">
          {String(index).padStart(2, "0")}
        </span>
        <span
          className={cn(
            "inline-flex h-5 min-w-0 items-center gap-1 rounded px-1.5 text-[9px] font-medium",
            trajectoryTagClass(span),
          )}
        >
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(span.status))} aria-hidden="true" />
          <span className="truncate">{laneLabel(span.lane)}</span>
        </span>
        <span className="min-w-0 truncate text-[10.5px] leading-4 text-content-secondary group-hover:text-content-primary">
          {label}
        </span>
        <span className={cn("text-right font-mono text-[9px] tabular-nums", trajectoryDurationClass(span.status))}>
          {formatSpanDuration(span, nowEpoch)}
        </span>
        <ToggleIcon className="h-3 w-3 text-content-disabled" aria-hidden="true" />
      </button>
      {expanded ? <RuntimeConsoleDetail span={span} nowEpoch={nowEpoch} /> : null}
    </div>
  );
}

function RuntimeConsoleDetail({ span, nowEpoch }: { span: RuntimeDiagnosticSpan; nowEpoch: number }): JSX.Element {
  const values = [
    [
      frontendFeatureMessage("observability.diagnostic.detail.type"),
      span.source === "tool" ? toolOriginLabel(span) : frontendMessage(SourceMessageKeys.activity),
    ],
    [frontendFeatureMessage("observability.diagnostic.detail.status"), statusLabel(span.status)],
    [frontendFeatureMessage("observability.diagnostic.detail.duration"), formatSpanDuration(span, nowEpoch)],
    [
      frontendFeatureMessage("observability.diagnostic.detail.step"),
      span.step === undefined ? undefined : String(span.step),
    ],
    [frontendFeatureMessage("observability.diagnostic.detail.callId"), span.callId],
  ] as const;
  return (
    <div
      className="grid gap-x-3 gap-y-1 border-t border-line-subtle/60 bg-surface-raised/45 py-2 pl-[98px] pr-5 text-[9.5px] leading-4 text-content-muted"
      data-runtime-span-detail
    >
      {values.flatMap(([label, value]) =>
        value ? (
          <div key={label} className="grid min-w-0 grid-cols-[48px_minmax(0,1fr)] gap-2">
            <span className="text-content-disabled">{label}</span>
            <span className="min-w-0 break-all text-content-secondary">{value}</span>
          </div>
        ) : (
          []
        ),
      )}
    </div>
  );
}

function EmptyDiagnostic(): JSX.Element {
  return (
    <div className="flex items-center gap-2 px-3 py-4 text-[10.5px] text-content-muted sm:px-4">
      <span className="text-content-disabled">›</span>
      <span>{frontendMessage("observability.diagnostic.noRun")}</span>
    </div>
  );
}

function readOverallStatus(model: RuntimeDiagnosticModel): RuntimeDiagnosticHealth {
  if (model.spans.some((span) => span.status === "failed")) return "failed";
  if (model.spans.some((span) => span.status === "running")) return "active";
  if (model.spans.length > 0) return "healthy";
  return model.connection;
}

function readLaneHealth(
  model: RuntimeDiagnosticModel,
  lane: (typeof RuntimeDiagnosticLanes)[keyof typeof RuntimeDiagnosticLanes],
): RuntimeDiagnosticHealth {
  const spans = model.lanes.find((entry) => entry.lane === lane)?.spans ?? [];
  if (spans.some((span) => span.status === "failed")) return "failed";
  if (spans.some((span) => span.status === "running")) return "active";
  return spans.length > 0 ? "healthy" : "unknown";
}

function laneLabel(lane: RuntimeDiagnosticSpan["lane"]): string {
  const keys = {
    [RuntimeDiagnosticLanes.Context]: "observability.diagnostic.lane.context",
    [RuntimeDiagnosticLanes.Runtime]: "observability.diagnostic.lane.runtime",
    [RuntimeDiagnosticLanes.Model]: "observability.diagnostic.lane.model",
    [RuntimeDiagnosticLanes.Tools]: "observability.diagnostic.lane.tools",
    [RuntimeDiagnosticLanes.Response]: "observability.diagnostic.lane.response",
  } as const satisfies Record<RuntimeDiagnosticSpan["lane"], FrontendMessageKey>;
  return frontendMessage(keys[lane]);
}

function trajectorySpanClass(span: RuntimeDiagnosticSpan): string {
  if (span.status === "failed") return "bg-brick-500";
  const classes = {
    [RuntimeDiagnosticLanes.Context]: "bg-ink-400",
    [RuntimeDiagnosticLanes.Runtime]: "bg-ink-500",
    [RuntimeDiagnosticLanes.Model]: "bg-accent-solid",
    [RuntimeDiagnosticLanes.Tools]: "bg-umber-500",
    [RuntimeDiagnosticLanes.Response]: "bg-moss-500",
  } as const satisfies Record<RuntimeDiagnosticSpan["lane"], string>;
  return classes[span.lane];
}

function trajectoryTagClass(span: RuntimeDiagnosticSpan): string {
  if (span.status === "failed") return "bg-brick-50 text-brick-600";
  const classes = {
    [RuntimeDiagnosticLanes.Context]: "bg-ink-900/[0.045] text-content-secondary",
    [RuntimeDiagnosticLanes.Runtime]: "bg-ink-900/[0.045] text-content-secondary",
    [RuntimeDiagnosticLanes.Model]: "bg-accent-surface text-accent-content",
    [RuntimeDiagnosticLanes.Tools]: "bg-umber-50 text-umber-700",
    [RuntimeDiagnosticLanes.Response]: "bg-moss-50 text-moss-600",
  } as const satisfies Record<RuntimeDiagnosticSpan["lane"], string>;
  return classes[span.lane];
}

function trajectoryDurationClass(status: RuntimeDiagnosticSpan["status"]): string {
  if (status === "failed") return "text-brick-600";
  if (status === "running") return "text-accent-content";
  return "text-content-muted";
}

function spanLabel(span: RuntimeDiagnosticSpan): string {
  if (span.source === "tool") {
    return projectToolActivity({
      toolName: span.toolName ?? "tool",
      origin: span.toolOrigin,
      arguments: span.toolArguments,
      status: span.status === "failed" ? "failed" : span.status === "completed" ? "completed" : "active",
    });
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

function statusLabel(status: RuntimeDiagnosticHealth | RuntimeDiagnosticSpan["status"]): string {
  return frontendMessage(StatusMessageKeys[status]);
}

function healthStatusLabel(id: keyof typeof HealthMessageKeys, status: RuntimeDiagnosticHealth): string {
  if (status !== "unknown" || id === "connection") return statusLabel(status);
  return frontendFeatureMessage("observability.diagnostic.status.idle");
}

function formatSpanDuration(span: RuntimeDiagnosticSpan, nowEpoch: number): string {
  if (span.durationMs !== undefined) return formatDuration(span.durationMs);
  if (span.status === "running") return formatDuration(Math.max(0, nowEpoch - span.startedAtEpoch));
  return frontendMessage("observability.diagnostic.duration.unmeasured");
}

function formatDuration(milliseconds?: number): string {
  if (milliseconds === undefined) return "--";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1_000)}s`;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(2)}K`;
  return `${Math.round(tokens)}`;
}

function formatPercent(value: number): string {
  return value.toFixed(2);
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatCost(value: number): string {
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

function shortIdentifier(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function statusTextClass(status: RuntimeDiagnosticHealth | RuntimeDiagnosticSpan["status"]): string {
  if (status === "failed") return "text-brick-600";
  if (status === "active" || status === "running") return "text-umber-600";
  if (status === "healthy" || status === "completed") return "text-moss-600";
  return "text-content-muted";
}

function statusDotClass(status: RuntimeDiagnosticHealth | RuntimeDiagnosticSpan["status"]): string {
  if (status === "failed") return "bg-brick-500";
  if (status === "active" || status === "running") return "bg-umber-500";
  if (status === "healthy" || status === "completed") return "bg-moss-500";
  return "bg-ink-300";
}
