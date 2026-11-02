import { useDeferredValue, useMemo, useState } from "react";
import { frontendFeatureMessage as t } from "../../i18n/frontendFeatureMessageCatalog";
import { formatDurationMs, formatInteger } from "../../lib/util";
import { formatModelCharge } from "../../lib/modelCost";
import type { RunRecord, TimelineStep } from "../../store/session/types";
import { Button, Input, MenuSelect, Tooltip } from "../../shared/ui";
import { readWorkflowStepDurationMs } from "../workflow/workflowPresentationProjection";
import { ContextCategories, contextComposition, requestContextUsage } from "./contextInspectionModel";
import { inspectionScopeId } from "./inspectionScopeModel";
import {
  InsightsDistribution as Distribution,
  InsightsMetric as Metric,
  InsightsSectionTitle as SectionTitle,
} from "./insightsPrimitives";
import {
  insightBreakdown,
  insightRequests,
  insightTotals,
  sumInsightField,
  type InsightRequest,
} from "./sessionInsightsModel";
import { insightContextTimeline } from "./contextEventModel";
import { ContextEventRow } from "./ContextEventList";

export function SessionOverviewView({
  runs,
  scopeId,
  onInspectRequest,
  turnNumbers,
}: {
  runs: readonly RunRecord[];
  scopeId?: string;
  onInspectRequest: (id: string) => void;
  turnNumbers?: ReadonlyMap<string, number>;
}): JSX.Element {
  const totals = useMemo(() => insightTotals(runs, scopeId), [runs, scopeId]);
  const requests = useMemo(() => insightRequests(runs, scopeId), [runs, scopeId]);
  const usages = totals.models.map((step) => step.modelUsage);
  const fields = ["inputTokens", "cacheReadTokens", "cacheWriteTokens", "outputTokens"] as const;
  const parts = fields.map((field) => ({
    id: field,
    label: t(`insights.stats.${field}`),
    ...sumInsightField(usages, field),
  }));
  const input = parts.slice(0, 3).reduce((sum, part) => sum + (part.value ?? 0), 0);
  const cache = sumInsightField(usages, "cacheReadTokens");
  const cacheRate = cache.known > 0 && input > 0 ? cache.value! / input : undefined;
  const timing = (["model", "tool"] as const).map((kind) => {
    const steps = kind === "model" ? totals.models : totals.tools;
    const durations = steps.flatMap((step) => {
      const duration = readWorkflowStepDurationMs(step);
      return duration === undefined ? [] : [duration];
    });
    return {
      id: kind,
      label: t(`insights.stats.${kind}Time`),
      value: durations.length ? durations.reduce((sum, value) => sum + value, 0) : undefined,
      known: durations.length,
      count: steps.length,
    };
  });
  return (
    <div className="insights-overview" data-session-overview>
      <section className="insights-section insights-stats">
        <SectionTitle
          title={t("insights.stats.title")}
          count={runs.length}
          countLabel={t("insights.stats.scope", { count: runs.length })}
        />
        <dl className="insights-kpis">
          <Metric label={t("insights.stats.turns")} value={formatInteger(runs.length)} />
          <Metric label={t("insights.process.requests")} value={formatInteger(totals.models.length)} />
          <Metric label={t("insights.process.tools")} value={formatInteger(totals.tools.length)} />
          <Metric
            label={t("insights.stats.failures")}
            value={formatInteger(
              totals.models.filter((step) => step.status === "failed").length +
                totals.tools.filter((step) => step.status === "failed").length,
            )}
          />
          <Metric
            label={t("insights.process.tokens")}
            value={totals.tokens.value === undefined ? "—" : formatInteger(totals.tokens.value)}
          />
          <Metric label={t("insights.process.cost")} value={formatModelCharge(totals.charge)} />
        </dl>
        <p className="insights-note">
          {t("insights.stats.coverage", {
            metered: totals.tokens.known,
            priced: totals.priced,
            total: totals.usageCount,
          })}
        </p>
      </section>
      <section className="insights-section insights-token-stats">
        <SectionTitle
          title={t("insights.stats.tokens")}
          note={`${t("insights.stats.cacheRate")} ${cacheRate === undefined ? "—" : `${(cacheRate * 100).toFixed(1)}%`}`}
        />
        <Distribution parts={parts} format={formatInteger} />
        <p className="insights-note">
          {t("insights.stats.requestCoverage", { count: usages.filter(Boolean).length, total: usages.length })}
        </p>
      </section>
      <section className="insights-section insights-timing-stats">
        <SectionTitle title={t("insights.stats.timing")} note={t("insights.stats.callTime")} />
        <Distribution parts={timing} format={formatDurationMs} />
        <div className="insights-timing-strip" aria-label={t("insights.stats.callTimeline")}>
          {totals.steps
            .filter((step) => step.kind === "model" || step.callId)
            .map((step) => {
              const duration = readWorkflowStepDurationMs(step);
              return duration === undefined || duration <= 0 ? null : (
                <button
                  key={step.id}
                  type="button"
                  data-series={step.kind}
                  style={{ flexGrow: duration }}
                  title={`${step.toolName ?? step.responseModel ?? step.modelName ?? step.title} · ${formatDurationMs(duration)}`}
                  aria-label={`${step.toolName ?? step.responseModel ?? step.modelName ?? step.title} · ${formatDurationMs(duration)}`}
                  onClick={() => onInspectRequest(step.id)}
                />
              );
            })}
        </div>
        <p className="insights-note">{t("insights.stats.timingNote")}</p>
      </section>
      <SessionTrend requests={requests} onSelect={onInspectRequest} />
      <CallBreakdown steps={totals.steps} />
      <ContextEvents runs={runs} scopeId={scopeId} turnNumbers={turnNumbers} onSelect={onInspectRequest} />
    </div>
  );
}

function SessionTrend({ requests, onSelect }: { requests: readonly InsightRequest[]; onSelect: (id: string) => void }) {
  const [group, setGroup] = useState<"step" | "turn">("step");
  const [mode, setMode] = useState<"total" | "delta">("total");
  const bars = useMemo(() => {
    const previousByScope = new Map<string, ReturnType<typeof requestContextUsage>>();
    return requests
      .filter((entry, index) => group === "step" || requests[index + 1]?.run.requestId !== entry.run.requestId)
      .map((entry) => {
        const usage = requestContextUsage(entry.step);
        const scope = inspectionScopeId(entry.step.scope);
        const previousUsage = previousByScope.get(scope);
        previousByScope.set(scope, usage);
        return {
          entry,
          usage,
          value:
            mode === "total"
              ? usage?.tokens
              : usage === undefined || previousUsage?.source !== usage.source
                ? undefined
                : usage.tokens - previousUsage.tokens,
        };
      });
  }, [requests, group, mode]);
  const max = bars.reduce((maximum, bar) => Math.max(maximum, Math.abs(bar.value ?? 0)), 1);
  return (
    <section className="insights-section insights-session-trend">
      <SectionTitle
        title={t("insights.stats.trend")}
        count={requests.length}
        countLabel={t("insights.context.requests", { count: requests.length })}
      />
      <div className="insights-chart-controls">
        <MenuSelect
          size="sm"
          value={group}
          placeholder=""
          onChange={(value) => setGroup(value as typeof group)}
          ariaLabel={t("insights.trend.group")}
          options={(["step", "turn"] as const).map((value) => ({ value, label: t(`insights.trend.${value}`) }))}
        />
        <MenuSelect
          size="sm"
          value={mode}
          placeholder=""
          onChange={(value) => setMode(value as typeof mode)}
          ariaLabel={t("insights.trend.mode")}
          options={(["total", "delta"] as const).map((value) => ({ value, label: t(`insights.trend.${value}`) }))}
        />
      </div>
      <div className="insights-trend-plot">
        <div className="insights-trend-axis">
          <span>{formatInteger(max)}</span>
          <span>0</span>
          {mode === "delta" ? <span>−{formatInteger(max)}</span> : null}
        </div>
        <div className="insights-session-bars" data-mode={mode}>
          {bars.map(({ entry, usage, value }, index) => (
            <Tooltip
              key={entry.step.id}
              content={`${t("insights.turn", { index: entry.turn })} · ${entry.step.responseModel ?? entry.step.modelName ?? ""} · ${value === undefined ? "—" : `${usage?.source === "local_estimate" ? "≈" : ""}${formatInteger(value)}`}`}
            >
              <button
                type="button"
                aria-label={t("insights.trend.inspect", { turn: entry.turn, step: index + 1 })}
                onClick={() => onSelect(entry.step.id)}
                data-negative={(value !== undefined && value < 0) || undefined}
              >
                <span
                  className="insights-session-bar"
                  data-unknown={value === undefined || undefined}
                  style={{ height: `${value === undefined ? 1 : Math.max(1, (Math.abs(value) / max) * 100)}%` }}
                >
                  {mode === "total" && entry.step.contextSnapshot ? (
                    contextComposition(entry.step.contextSnapshot).map((part) => (
                      <i key={part.id} data-category={part.id} style={{ flexGrow: part.tokens }} />
                    ))
                  ) : (
                    <i data-series="model" style={{ flexGrow: 1 }} />
                  )}
                </span>
                <small>{group === "turn" ? entry.turn : index + 1}</small>
              </button>
            </Tooltip>
          ))}
        </div>
      </div>
      <div className="insights-chart-legend">
        {ContextCategories.map((part) => (
          <span key={part.id} data-category={part.id}>
            <i />
            {t(part.label)}
          </span>
        ))}
      </div>
      <p className="insights-note">{t("insights.trend.note")}</p>
    </section>
  );
}

function CallBreakdown({ steps }: { steps: readonly TimelineStep[] }) {
  const [kind, setKind] = useState<"model" | "tool">("tool");
  const [sort, setSort] = useState<"count" | "duration" | "failed">("count");
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query.trim().toLocaleLowerCase());
  const breakdown = useMemo(() => insightBreakdown(steps, kind), [steps, kind]);
  const rows = useMemo(
    () => breakdown.filter((row) => row.name.toLocaleLowerCase().includes(search)).sort((a, b) => b[sort] - a[sort]),
    [breakdown, search, sort],
  );
  const maximumCount = rows.reduce((maximum, row) => Math.max(maximum, row.count), 1);
  return (
    <section className="insights-section insights-call-breakdown">
      <SectionTitle
        title={t("insights.stats.breakdown")}
        count={rows.length}
        countLabel={t("insights.stats.kinds", { count: rows.length })}
      />
      <div className="insights-chart-controls">
        <Input
          size="sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("insights.breakdown.search")}
          aria-label={t("insights.breakdown.search")}
        />
        <MenuSelect
          size="sm"
          value={kind}
          placeholder=""
          onChange={(value) => setKind(value as typeof kind)}
          ariaLabel={t("insights.breakdown.kind")}
          options={(["tool", "model"] as const).map((value) => ({
            value,
            label: t(`insights.process.filter.${value}`),
          }))}
        />
        <MenuSelect
          size="sm"
          value={sort}
          placeholder=""
          onChange={(value) => setSort(value as typeof sort)}
          ariaLabel={t("insights.breakdown.sort")}
          options={(["count", "duration", "failed"] as const).map((value) => ({
            value,
            label: t(`insights.breakdown.${value}`),
          }))}
        />
      </div>
      <div className="insights-table-scroll">
        <table className="insights-table">
          <thead>
            <tr>
              <th>{t("insights.breakdown.name")}</th>
              <th>{t("insights.breakdown.count")}</th>
              <th>{t("insights.breakdown.duration")}</th>
              <th>{t("insights.breakdown.failed")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td title={row.name}>
                  <b>{row.name}</b>
                  <span className="insights-mini-meter">
                    <i style={{ width: `${(row.count / maximumCount) * 100}%` }} />
                  </span>
                </td>
                <td>{row.count}</td>
                <td>{row.timed ? formatDurationMs(row.duration) : "—"}</td>
                <td>{row.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length ? <p className="insights-note">{t("insights.process.noMatches")}</p> : null}
    </section>
  );
}

function ContextEvents({
  runs,
  scopeId,
  turnNumbers,
  onSelect,
}: {
  runs: readonly RunRecord[];
  scopeId?: string;
  turnNumbers?: ReadonlyMap<string, number>;
  onSelect: (id: string) => void;
}) {
  const [limit, setLimit] = useState(10);
  const events = useMemo(() => insightContextTimeline(runs, scopeId, turnNumbers), [runs, scopeId, turnNumbers]);
  return (
    <section className="insights-section insights-context-events">
      <SectionTitle
        title={t("insights.events.context")}
        count={events.length}
        countLabel={t("insights.events.count", { count: events.length })}
      />
      <div className="insights-context-events-list">
        {events.slice(0, limit).map((event) => (
          <ContextEventRow key={event.id} event={event} onInspectRequest={onSelect} />
        ))}
      </div>
      {events.length > limit ? (
        <Button variant="ghost" size="sm" onClick={() => setLimit((value) => value + 20)}>
          {t("insights.events.more", { count: events.length - limit })}
        </Button>
      ) : null}
      <p className="insights-note">{t("insights.events.note")}</p>
    </section>
  );
}
