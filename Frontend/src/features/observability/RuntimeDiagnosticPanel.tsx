import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Activity, BookOpen, BrainCircuit, Clock3, Cable, Gauge, MessageSquareText, Wrench } from "lucide-react";
import type { LucideProps } from "lucide-react";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { runActivityLabel } from "../workflow/runActivityPresentation";
import { useStore } from "../../store/sessionStore";
import { useEventJournalStore } from "./eventJournalStore";
import {
  projectRuntimeDiagnostic,
  RuntimeDiagnosticLaneOrder,
  RuntimeDiagnosticLanes,
  type RuntimeDiagnosticHealth,
  type RuntimeDiagnosticLane,
  type RuntimeDiagnosticModel,
  type RuntimeDiagnosticSpan,
  type RuntimeDiagnosticSpanSource,
} from "./runtimeDiagnosticProjection";

type LaneIcon = ComponentType<LucideProps>;

const LaneIcons: Record<RuntimeDiagnosticLane, LaneIcon> = {
  [RuntimeDiagnosticLanes.Context]: BookOpen,
  [RuntimeDiagnosticLanes.Runtime]: Activity,
  [RuntimeDiagnosticLanes.Model]: BrainCircuit,
  [RuntimeDiagnosticLanes.Tools]: Wrench,
  [RuntimeDiagnosticLanes.Response]: MessageSquareText,
};

const HealthIcons: Record<string, LaneIcon> = {
  connection: Cable,
  runtime: Activity,
  model: BrainCircuit,
  tools: Wrench,
  response: MessageSquareText,
};

const LaneMessageKeys: Record<RuntimeDiagnosticLane, FrontendMessageKey> = {
  [RuntimeDiagnosticLanes.Context]: "observability.diagnostic.lane.context",
  [RuntimeDiagnosticLanes.Runtime]: "observability.diagnostic.lane.runtime",
  [RuntimeDiagnosticLanes.Model]: "observability.diagnostic.lane.model",
  [RuntimeDiagnosticLanes.Tools]: "observability.diagnostic.lane.tools",
  [RuntimeDiagnosticLanes.Response]: "observability.diagnostic.lane.response",
};

const HealthMessageKeys = {
  connection: "observability.diagnostic.status.connection",
  runtime: "observability.diagnostic.status.runtime",
  model: "observability.diagnostic.status.model",
  tools: "observability.diagnostic.status.tools",
  response: "observability.diagnostic.status.response",
} as const satisfies Record<string, FrontendMessageKey>;

const StatusMessageKeys = {
  healthy: "observability.diagnostic.status.healthy",
  active: "observability.diagnostic.status.active",
  failed: "observability.diagnostic.status.failed",
  unknown: "observability.diagnostic.status.unknown",
  running: "observability.diagnostic.status.running",
  completed: "observability.diagnostic.status.completed",
} as const satisfies Record<RuntimeDiagnosticHealth | "running" | "completed", FrontendMessageKey>;

const SourceMessageKeys = {
  activity: "observability.diagnostic.source.activity",
  tool: "observability.diagnostic.source.tool",
} as const satisfies Record<RuntimeDiagnosticSpanSource, FrontendMessageKey>;

export function RuntimeDiagnosticPanel(): JSX.Element {
  const records = useEventJournalStore((state) => state.records);
  const viewPausedAt = useEventJournalStore((state) => state.viewPausedAt);
  const activeSessionId = useStore((state) => state.activeSessionId);
  const [nowEpoch, setNowEpoch] = useState(() => Date.now());
  const [selectedSpanId, setSelectedSpanId] = useState<string>();
  const model = useMemo(
    () => projectRuntimeDiagnostic(records, { nowEpoch, pausedAt: viewPausedAt, activeSessionId }),
    [activeSessionId, nowEpoch, records, viewPausedAt],
  );
  const hasRunningSpan = model.spans.some((span) => span.status === "running");

  useEffect(() => {
    if (!hasRunningSpan) return undefined;
    const timer = window.setInterval(() => setNowEpoch(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [hasRunningSpan]);

  useEffect(() => {
    if (selectedSpanId && model.spans.some((span) => span.id === selectedSpanId)) return;
    setSelectedSpanId(model.current?.id);
  }, [model, selectedSpanId]);

  const selectedSpan = model.spans.find((span) => span.id === selectedSpanId) ?? model.current;
  const overallStatus = readOverallStatus(model);
  const elapsedMs =
    model.startedAtEpoch === undefined || model.endAtEpoch === undefined
      ? undefined
      : Math.max(0, model.endAtEpoch - model.startedAtEpoch);

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-transparent"
      aria-label={frontendMessage("observability.diagnostic.title")}
      data-runtime-diagnostic
    >
      <DiagnosticHeader
        model={model}
        overallStatus={overallStatus}
        elapsedMs={elapsedMs}
        paused={viewPausedAt !== undefined}
      />
      <SessionUsageBoard contextUsage={model.contextUsage} usage={model.sessionUsage} />
      <HealthRail model={model} />
      {model.spans.length === 0 ? (
        <EmptyDiagnostic />
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-4" data-runtime-diagnostic-scroll>
            <RuntimeWaterfall model={model} selectedSpanId={selectedSpan?.id} onSelect={setSelectedSpanId} />
          </div>
          <DiagnosticSpanDetail span={selectedSpan} nowEpoch={nowEpoch} />
        </>
      )}
    </section>
  );
}

function SessionUsageBoard({
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
      ? `${formatPercent(percent)}% · ${formatTokenCount(used)} / ${formatTokenCount(contextUsage.contextWindow)}`
      : frontendMessage("observability.diagnostic.usage.unknown");

  return (
    <section
      className="shrink-0 border-b border-line-subtle bg-transparent px-3 py-2.5 sm:px-4"
      data-session-usage-board
      aria-label={frontendMessage("observability.diagnostic.usage.title")}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Gauge className="h-3.5 w-3.5 shrink-0 text-content-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[10.5px] font-semibold text-content-secondary">
          {frontendMessage("observability.diagnostic.usage.title")}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-moss-600">
          <span className="h-1.5 w-1.5 rounded-full bg-moss-500" aria-hidden="true" />
          {frontendMessage("observability.diagnostic.usage.live")}
        </span>
      </div>
      <div className="mt-1.5 flex min-w-0 items-baseline justify-between gap-3">
        <strong className="min-w-0 truncate font-mono text-[14px] font-semibold tabular-nums text-content-primary">
          {contextValue}
        </strong>
        {contextUsage && remaining !== undefined ? (
          <span className="shrink-0 text-[10px] tabular-nums text-content-muted">
            {frontendMessage("observability.diagnostic.context.remaining", { count: formatTokenCount(remaining) })}
          </span>
        ) : null}
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-line-subtle"
        role="progressbar"
        aria-label={frontendMessage("observability.diagnostic.usage.context")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={contextUsage && hasContextTokens ? percent : 0}
        data-context-usage-meter
      >
        <span
          className={cn(
            "block h-full rounded-full transition-[width,background-color] duration-300",
            percent >= 90 ? "bg-brick-500" : percent >= 75 ? "bg-umber-500" : "bg-accent-solid",
          )}
          style={{ width: contextUsage && hasContextTokens ? `${percent}%` : "0%" }}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-5">
        <UsageStat
          label={frontendMessage("observability.diagnostic.usage.totalTokens")}
          value={usage ? formatTokenCount(usage.tokens.total) : "--"}
        />
        <UsageStat
          label={frontendMessage("observability.diagnostic.usage.messages")}
          value={usage ? formatInteger(usage.totalMessages) : "--"}
        />
        <UsageStat
          label={frontendMessage("observability.diagnostic.usage.input")}
          value={usage ? formatTokenCount(usage.tokens.input) : "--"}
        />
        <UsageStat
          label={frontendMessage("observability.diagnostic.usage.output")}
          value={usage ? formatTokenCount(usage.tokens.output) : "--"}
        />
        <UsageStat
          label={frontendMessage("observability.diagnostic.usage.cacheRead")}
          value={usage ? formatTokenCount(usage.tokens.cacheRead) : "--"}
        />
        <UsageStat
          label={frontendMessage("observability.diagnostic.usage.cacheWrite")}
          value={usage ? formatTokenCount(usage.tokens.cacheWrite) : "--"}
        />
        <UsageStat
          label={frontendMessage("observability.diagnostic.usage.toolCalls")}
          value={usage ? formatInteger(usage.toolCalls) : "--"}
        />
        <UsageStat
          label={frontendMessage("observability.diagnostic.usage.cost")}
          value={usage ? formatCost(usage.cost) : "--"}
        />
      </div>
    </section>
  );
}

function UsageStat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 border-t border-line-subtle py-1.5">
      <span className="truncate text-[10px] text-content-muted">{label}</span>
      <span className="shrink-0 font-mono text-[10.5px] font-medium tabular-nums text-content-primary">{value}</span>
    </div>
  );
}

function DiagnosticHeader({
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
    <header
      className="shrink-0 border-b border-line-subtle bg-transparent px-3 py-2.5 sm:px-4"
      data-runtime-diagnostic-header
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            statusDotClass(overallStatus),
            overallStatus === "active" && "animate-pulse",
          )}
          aria-hidden="true"
        ></span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[13px] font-semibold text-content-primary">
              {frontendMessage("observability.diagnostic.title")}
            </h2>
            <span className={cn("shrink-0 text-[10px] font-medium", healthTextClass(overallStatus))}>
              {statusLabel(overallStatus)}
            </span>
            <span className="shrink-0 text-[10px] text-content-muted">
              {frontendMessage(paused ? "observability.diagnostic.paused" : "observability.diagnostic.live")}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[10.5px] text-content-muted">
            {frontendMessage("observability.diagnostic.subtitle")}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-[13px] font-semibold tabular-nums text-content-primary">
            {formatDuration(elapsedMs)}
          </div>
          <div className="text-[9.5px] text-content-muted">{frontendMessage("observability.diagnostic.elapsed")}</div>
        </div>
      </div>
      {model.requestId ? (
        <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[10px] text-content-muted">
          <span className="shrink-0 uppercase tracking-[0.08em]">
            {frontendMessage("observability.diagnostic.requestId")}
          </span>
          <code className="min-w-0 truncate font-mono text-content-secondary">{model.requestId}</code>
        </div>
      ) : null}
    </header>
  );
}

function HealthRail({ model }: { model: RuntimeDiagnosticModel }): JSX.Element {
  const items = [
    { id: "connection", status: model.connection },
    { id: "runtime", status: readLaneHealth(model, RuntimeDiagnosticLanes.Runtime) },
    { id: "model", status: readLaneHealth(model, RuntimeDiagnosticLanes.Model) },
    { id: "tools", status: readLaneHealth(model, RuntimeDiagnosticLanes.Tools) },
    { id: "response", status: readLaneHealth(model, RuntimeDiagnosticLanes.Response) },
  ] as const;
  return (
    <div className="shrink-0 border-b border-line-subtle bg-transparent px-3 py-2 sm:px-4" data-runtime-health-rail>
      <div className="grid min-w-0 grid-cols-5 gap-2">
        {items.map(({ id, status }) => {
          const Icon = HealthIcons[id];
          return (
            <div key={id} className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <Icon className={cn("h-3 w-3 shrink-0", healthTextClass(status))} />
                <span className="truncate text-[9.5px] text-content-muted">
                  {frontendMessage(HealthMessageKeys[id])}
                </span>
              </div>
              <div className={cn("mt-0.5 truncate text-[10px] font-medium", healthTextClass(status))}>
                {statusLabel(status)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RuntimeWaterfall({
  model,
  selectedSpanId,
  onSelect,
}: {
  model: RuntimeDiagnosticModel;
  selectedSpanId?: string;
  onSelect: (spanId: string) => void;
}): JSX.Element {
  return (
    <section aria-label={frontendMessage("observability.diagnostic.timeline")} data-runtime-waterfall>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-content-muted">
          {frontendMessage("observability.diagnostic.timeline")}
        </h3>
      </div>
      <div className="space-y-2">
        {RuntimeDiagnosticLaneOrder.map((lane) => {
          const laneModel = model.lanes.find((entry) => entry.lane === lane);
          if (!laneModel || laneModel.spans.length === 0) return null;
          return (
            <DiagnosticLaneRow
              key={lane}
              lane={laneModel.lane}
              spans={laneModel.spans}
              nowEpoch={model.nowEpoch}
              selectedSpanId={selectedSpanId}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    </section>
  );
}

function DiagnosticLaneRow({
  lane,
  spans,
  nowEpoch,
  selectedSpanId,
  onSelect,
}: {
  lane: RuntimeDiagnosticLane;
  spans: readonly RuntimeDiagnosticSpan[];
  nowEpoch: number;
  selectedSpanId?: string;
  onSelect: (spanId: string) => void;
}): JSX.Element {
  const Icon = LaneIcons[lane];
  return (
    <section className="overflow-hidden border-t border-line-subtle first:border-t-0" data-runtime-lane={lane}>
      <div className="flex items-center gap-1.5 px-1 py-1.5 text-[10.5px] font-medium text-content-secondary">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-content-muted" />
        <span className="truncate">{frontendMessage(LaneMessageKeys[lane])}</span>
      </div>
      <div className="relative space-y-1 pb-2 pl-1">
        <span className="absolute bottom-3 left-[5px] top-3 w-px bg-line-subtle" aria-hidden="true" />
        {spans.map((span) => (
          <DiagnosticSpanBar
            key={span.id}
            span={span}
            nowEpoch={nowEpoch}
            selected={span.id === selectedSpanId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function DiagnosticSpanBar({
  span,
  nowEpoch,
  selected,
  onSelect,
}: {
  span: RuntimeDiagnosticSpan;
  nowEpoch: number;
  selected: boolean;
  onSelect: (spanId: string) => void;
}): JSX.Element {
  const label = spanLabel(span);
  return (
    <button
      type="button"
      className={cn(
        "relative z-10 flex min-h-8 w-full items-center gap-2 overflow-hidden border px-2 py-1.5 text-left text-[10.5px] font-medium outline-none transition-[filter,box-shadow,opacity]",
        spanToneClass(span.status, span.source),
        selected && "z-20 ring-2 ring-accent-focus ring-offset-1 ring-offset-surface-subtle",
        span.status === "running" && "diagnostic-span-running",
        "hover:brightness-95 focus-visible:ring-2 focus-visible:ring-accent-focus",
      )}
      onClick={() => onSelect(span.id)}
      aria-label={`${label} · ${statusLabel(span.status)} · ${formatSpanDuration(span, nowEpoch)}`}
      data-runtime-span={span.id}
    >
      <span className="grid h-2 w-2 shrink-0 place-items-center rounded-full bg-current" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums opacity-75">
        {formatSpanDuration(span, nowEpoch)}
      </span>
    </button>
  );
}

function DiagnosticSpanDetail({ span, nowEpoch }: { span?: RuntimeDiagnosticSpan; nowEpoch: number }): JSX.Element {
  return (
    <div className="shrink-0 border-t border-line-subtle bg-surface-panel px-3 py-2.5 sm:px-4" data-runtime-span-detail>
      <div className="flex min-w-0 items-center gap-2">
        <Clock3 className="h-3.5 w-3.5 shrink-0 text-content-muted" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-content-primary">
          {span ? spanLabel(span) : frontendMessage("observability.diagnostic.currentNone")}
        </span>
        {span ? (
          <span className={cn("shrink-0 text-[10px] font-medium", statusTextClass(span.status))}>
            {statusLabel(span.status)}
          </span>
        ) : null}
      </div>
      {span ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-content-muted">
          <span>{frontendMessage(SourceMessageKeys[span.source])}</span>
          <span className="font-mono tabular-nums">{formatSpanDuration(span, nowEpoch)}</span>
          {span.callId ? <code className="max-w-[180px] truncate font-mono">{span.callId}</code> : null}
        </div>
      ) : null}
    </div>
  );
}

function EmptyDiagnostic(): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
      <Activity className="h-6 w-6 text-content-muted" />
      <p className="mt-3 text-[13px] font-medium text-content-primary">
        {frontendMessage("observability.diagnostic.noRun")}
      </p>
      <p className="mt-1 max-w-[280px] text-[11.5px] leading-5 text-content-muted">
        {frontendMessage("observability.diagnostic.noRunDescription")}
      </p>
    </div>
  );
}

function readOverallStatus(model: RuntimeDiagnosticModel): RuntimeDiagnosticHealth {
  if (model.spans.some((span) => span.status === "failed")) return "failed";
  if (model.spans.some((span) => span.status === "running")) return "active";
  if (model.spans.length > 0) return "healthy";
  return model.connection;
}

function readLaneHealth(model: RuntimeDiagnosticModel, lane: RuntimeDiagnosticLane): RuntimeDiagnosticHealth {
  const spans = model.lanes.find((entry) => entry.lane === lane)?.spans ?? [];
  if (spans.some((span) => span.status === "failed")) return "failed";
  if (spans.some((span) => span.status === "running")) return "active";
  return spans.length > 0 ? "healthy" : "unknown";
}

function spanLabel(span: RuntimeDiagnosticSpan): string {
  return span.source === "tool"
    ? (span.toolName ?? "tool")
    : span.operation
      ? runActivityLabel(span.operation)
      : "activity";
}

function statusLabel(status: RuntimeDiagnosticHealth | RuntimeDiagnosticSpan["status"]): string {
  return frontendMessage(StatusMessageKeys[status]);
}

function formatSpanDuration(span: RuntimeDiagnosticSpan, nowEpoch: number): string {
  if (span.durationMs !== undefined) return formatDuration(span.durationMs);
  if (span.status === "running") return formatDuration(Math.max(0, nowEpoch - span.startedAtEpoch));
  return frontendMessage("observability.diagnostic.duration.unmeasured");
}

function formatDuration(milliseconds?: number): string {
  if (milliseconds === undefined) return frontendMessage("observability.diagnostic.duration.unmeasured");
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

function healthTextClass(status: RuntimeDiagnosticHealth): string {
  if (status === "failed") return "text-brick-600";
  if (status === "active") return "text-umber-600";
  if (status === "healthy") return "text-moss-600";
  return "text-content-muted";
}

function statusDotClass(status: RuntimeDiagnosticHealth): string {
  if (status === "failed") return "bg-brick-500";
  if (status === "active") return "bg-umber-500";
  if (status === "healthy") return "bg-moss-500";
  return "bg-ink-300";
}

function statusTextClass(status: RuntimeDiagnosticSpan["status"]): string {
  if (status === "failed") return "text-brick-600";
  if (status === "running") return "text-umber-600";
  return "text-moss-600";
}

function spanToneClass(status: RuntimeDiagnosticSpan["status"], source: RuntimeDiagnosticSpanSource): string {
  if (status === "failed") return "border-brick-300 bg-brick-100 text-brick-700";
  if (status === "running") return "border-umber-300 bg-umber-100 text-umber-700";
  return source === "tool"
    ? "border-accent-border bg-accent-surface text-accent-content"
    : "border-moss-200 bg-moss-100 text-moss-700";
}
