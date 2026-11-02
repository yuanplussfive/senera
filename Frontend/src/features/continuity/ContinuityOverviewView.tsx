import "./continuity.css";
import { frontendFeatureMessage as t } from "../../i18n/frontendFeatureMessageCatalog";
import type { RunRecord } from "../../store/sessionStore";
import { AppIcon, Input } from "../../shared/ui";
import { InsightsDistribution, InsightsSectionTitle } from "../observability/insightsPrimitives";
import { ContinuityAuditCard } from "./ContinuityRecallView";
import { ContinuityMemoryTable, type ContinuityMemorySort } from "./ContinuityMemoryTable";
import {
  formatContinuityInteger,
  formatContinuityPercent,
  formatContinuityScore,
  memoryTypeLabel,
  readContinuitySummary,
} from "./ContinuityPanelPrimitives";

export interface ContinuityInspectionState {
  expandedRecords: Readonly<Record<string, string | undefined>>;
  expandedScores: Readonly<Record<string, string | undefined>>;
  query: string;
  sort?: ContinuityMemorySort;
  auditOpen: boolean;
}

export function createContinuityInspectionState(): ContinuityInspectionState {
  return { expandedRecords: {}, expandedScores: {}, query: "", auditOpen: false };
}

export function ContinuityOverviewView({
  run,
  state,
  onStateChange,
}: {
  run: RunRecord;
  state: ContinuityInspectionState;
  onStateChange: (patch: Partial<ContinuityInspectionState>) => void;
}): JSX.Element {
  const memory = run.continuity;
  if (!memory)
    return (
      <div className="insights-empty" data-testid="continuity-empty">
        {t("continuity.empty.newRun")}
      </div>
    );
  const summary = readContinuitySummary(memory);
  const latency = memory.retrieval?.totalLatencyMs ?? run.recall?.latencyMs;
  const groups = [
    { id: "frozen", title: "insights.memory.frozen", entries: memory.eventCandidates },
    { id: "task", title: "insights.memory.task", entries: memory.taskCandidates ?? [] },
    { id: "related", title: "insights.memory.related", entries: memory.relatedCandidates ?? [] },
  ] as const;
  const records = groups.flatMap((group) => group.entries);
  const composition = Array.from(new Set(records.map((record) => record.type))).map((type) => ({
    id: type,
    label: memoryTypeLabel(type),
    value: records.filter((record) => record.type === type).length,
  }));
  const query = state.query.trim().toLocaleLowerCase();
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      entries: group.entries.filter(
        (record) => !query || `${record.summary} ${memoryTypeLabel(record.type)}`.toLocaleLowerCase().includes(query),
      ),
    }))
    .filter((group) => group.entries.length > 0);
  return (
    <div className="continuity-overview" data-continuity-overview>
      <section className="insights-section continuity-summary">
        <div className="continuity-summary-charts">
          <section className="continuity-composition" data-continuity-composition>
            <InsightsSectionTitle title={t("continuity.chart.composition")} />
            <InsightsDistribution parts={composition} format={formatContinuityInteger} />
          </section>
          <section className="continuity-budget" data-continuity-budget>
            <InsightsSectionTitle title={t("insights.memory.budget")} />
            <strong className="continuity-budget__percent">{formatContinuityPercent(summary.usedRatio)}</strong>
            <div className="continuity-budget__line">
              <span>{formatContinuityInteger(summary.usedTokens)}</span>
              <span>/</span>
              <span>{formatContinuityInteger(summary.maxTokens)}</span>
              <span>tokens</span>
            </div>
            <div
              className="insights-memory-meter"
              role="img"
              aria-label={t("continuity.budget.aria", { percent: formatContinuityScore(summary.usedRatio * 100) })}
            >
              <i style={{ width: `${summary.usedRatio * 100}%` }} />
            </div>
          </section>
        </div>
        <dl className="continuity-summary-facts">
          <div>
            <dt>{t("continuity.metric.matched")}</dt>
            <dd>{formatContinuityInteger(summary.matched)}</dd>
          </div>
          <div>
            <dt>{t("continuity.metric.injected")}</dt>
            <dd>{formatContinuityInteger(summary.selected)}</dd>
          </div>
          <div>
            <dt>{t("continuity.metric.latency")}</dt>
            <dd>{latency === undefined ? "—" : `${formatContinuityInteger(latency)} ms`}</dd>
          </div>
        </dl>
      </section>
      {records.length > 0 ? (
        <div className="continuity-table-toolbar">
          <AppIcon icon="search" size={13} />
          <Input
            value={state.query}
            onChange={(event) => onStateChange({ query: event.target.value })}
            aria-label={t("continuity.table.search")}
            placeholder={t("continuity.table.search")}
            className="h-8 pl-8 text-xs"
          />
        </div>
      ) : null}
      {visibleGroups.map((group) => (
        <ContinuityMemoryTable
          key={group.id}
          memory={memory}
          entries={group.entries}
          title={group.title}
          group={group.id}
          expandedId={state.expandedRecords[group.title]}
          scoresId={state.expandedScores[group.title]}
          sort={state.sort}
          onSort={(sort) => onStateChange({ sort })}
          onExpand={(id) => onStateChange({ expandedRecords: { ...state.expandedRecords, [group.title]: id } })}
          onExpandScores={(id) => onStateChange({ expandedScores: { ...state.expandedScores, [group.title]: id } })}
        />
      ))}
      {visibleGroups.length === 0 ? (
        <p className="continuity-candidates__empty continuity-no-records">
          {t(records.length > 0 ? "continuity.table.noMatches" : "continuity.emptyEventCandidates")}
        </p>
      ) : null}
      <details
        className="insights-section insights-audit continuity-audit-panel"
        open={state.auditOpen}
        onToggle={(event) => {
          if (state.auditOpen !== event.currentTarget.open) onStateChange({ auditOpen: event.currentTarget.open });
        }}
      >
        <summary>
          <AppIcon icon="chevron-right" size={11} />
          <h3>{t("insights.memory.audit")}</h3>
        </summary>
        {state.auditOpen ? <ContinuityAuditCard memory={memory} recall={run.recall} /> : null}
      </details>
    </div>
  );
}
