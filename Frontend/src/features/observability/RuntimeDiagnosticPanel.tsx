import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { activeRunActivityLabel, runActivityLabel } from "../workflow/runActivityPresentation";
import { projectToolActivity } from "../workflow/toolActivityPresentation";
import { useStore } from "../../store/sessionStore";
import { useEventJournalStore } from "./eventJournalStore";
import {
  projectRuntimeDiagnostic,
  RuntimeDiagnosticLanes,
  type RuntimeDiagnosticHealth,
  type RuntimeDiagnosticModel,
  type RuntimeDiagnosticSpan,
} from "./runtimeDiagnosticProjection";

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
  const [nowEpoch, setNowEpoch] = useState(() => Date.now());
  const [expandedSpanId, setExpandedSpanId] = useState<string>();
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
      <div className="min-h-0 flex-1 overflow-auto font-mono" data-runtime-diagnostic-scroll>
        <ConsoleHeader
          model={model}
          overallStatus={overallStatus}
          elapsedMs={elapsedMs}
          paused={viewPausedAt !== undefined}
        />
        <SessionUsageConsole contextUsage={model.contextUsage} usage={model.sessionUsage} />
        <HealthConsole model={model} />
        <div className="h-px bg-line-subtle" />
        {model.spans.length === 0 ? (
          <EmptyDiagnostic />
        ) : (
          <RuntimeConsole
            model={model}
            expandedSpanId={expandedSpanId}
            onToggle={(spanId) => setExpandedSpanId((current) => (current === spanId ? undefined : spanId))}
          />
        )}
      </div>
    </section>
  );
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
          {frontendMessage("observability.diagnostic.consoleTitle")}
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
      <div className="px-3 pb-1 pt-2 text-[9.5px] uppercase text-content-disabled sm:px-4">
        {frontendMessage("observability.diagnostic.consoleStream")}
      </div>
      <div data-runtime-terminal-stream>
        {model.spans.map((span) => (
          <RuntimeConsoleRow
            key={span.id}
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
  span,
  nowEpoch,
  expanded,
  onToggle,
}: {
  span: RuntimeDiagnosticSpan;
  nowEpoch: number;
  expanded: boolean;
  onToggle: (spanId: string) => void;
}): JSX.Element {
  const label = spanLabel(span);
  const ToggleIcon = expanded ? ChevronDown : ChevronRight;
  return (
    <div
      className={cn("group border-t border-line-subtle/70", expanded && "bg-surface-subtle/45")}
      data-runtime-span={span.id}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${label} · ${statusLabel(span.status)} · ${formatSpanDuration(span, nowEpoch)}`}
        className="flex min-h-8 w-full min-w-0 items-start gap-2 px-3 py-2 text-left outline-none transition-colors hover:bg-surface-hover/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus sm:px-4"
        onClick={() => onToggle(span.id)}
      >
        <time className="w-[54px] shrink-0 pt-px text-[9.5px] tabular-nums text-content-disabled">
          {formatConsoleTime(span.startedAt)}
        </time>
        <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(span.status))} aria-hidden="true" />
        <span className="min-w-0 flex-1 font-sans text-[11px] leading-[17px] text-content-secondary group-hover:text-content-primary">
          {label}
        </span>
        <span className={cn("shrink-0 pt-px text-[9.5px] tabular-nums", statusTextClass(span.status))}>
          {formatSpanDuration(span, nowEpoch)}
        </span>
        <ToggleIcon className="mt-0.5 h-3 w-3 shrink-0 text-content-disabled" aria-hidden="true" />
      </button>
      {expanded ? <RuntimeConsoleDetail span={span} nowEpoch={nowEpoch} /> : null}
    </div>
  );
}

function RuntimeConsoleDetail({ span, nowEpoch }: { span: RuntimeDiagnosticSpan; nowEpoch: number }): JSX.Element {
  const values = [
    [frontendMessage("observability.diagnostic.detail.type"), span.source === "tool" ? toolOriginLabel(span) : frontendMessage(SourceMessageKeys.activity)],
    [frontendMessage("observability.diagnostic.detail.status"), statusLabel(span.status)],
    [frontendMessage("observability.diagnostic.detail.duration"), formatSpanDuration(span, nowEpoch)],
    [frontendMessage("observability.diagnostic.detail.step"), span.step === undefined ? undefined : String(span.step)],
    [frontendMessage("observability.diagnostic.detail.callId"), span.callId],
  ] as const;
  return (
    <div className="pb-2 pl-[88px] pr-4 text-[9.5px] leading-4 text-content-muted" data-runtime-span-detail>
      {values.flatMap(([label, value]) =>
        value ? (
          <div key={label} className="flex min-w-0 gap-2">
            <span className="w-12 shrink-0 text-content-disabled">{label}</span>
            <span className="min-w-0 break-all text-content-secondary">{value}</span>
          </div>
        ) : [],
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

function spanLabel(span: RuntimeDiagnosticSpan): string {
  if (span.source === "tool") {
    return projectToolActivity({
      toolName: span.toolName ?? "tool",
      origin: span.toolOrigin,
      arguments: span.toolArguments,
      status: span.status === "failed" ? "failed" : span.status === "completed" ? "completed" : "active",
    });
  }
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
  return frontendMessage("observability.diagnostic.status.idle");
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

function formatConsoleTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf())
    ? "--:--:--"
    : date.toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
