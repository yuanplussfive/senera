import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendFeatureMessage as t } from "../../i18n/frontendFeatureMessageCatalog";
import { formatInteger } from "../../lib/util";
import { formatModelCharge } from "../../lib/modelCost";
import type { RunRecord } from "../../store/sessionStore";
import { AppIcon, Button, Input, MenuSelect, SegmentedControl } from "../../shared/ui";
import { insightTotals } from "./sessionInsightsModel";
import {
  executionInspectionRows,
  isExecutionStep,
  type ExecutionFilter,
  type ExecutionInspectionRow as Row,
} from "./executionInspectionModel";
import { ExecutionInspectionDetail, ExecutionInspectionRow } from "./ExecutionInspectionRow";
import { ExecutionTimingOverview } from "./ExecutionTimingOverview";
import { insightContextTimeline } from "./contextEventModel";
import { ContextEventList } from "./ContextEventList";
import { inspectionScopeId } from "./inspectionScopeModel";

export interface ExecutionInspectionState {
  openId?: string;
  query: string;
  filter: ExecutionFilter;
  lane: "execution" | "context";
  collapsedBatches: string[];
  collapsedTurns: string[];
  historyLimit: number;
  historyTail?: { scopeId?: string; count: number };
}

const HistoryPageSize = 50;

export function createExecutionInspectionState(): ExecutionInspectionState {
  return {
    query: "",
    filter: "all",
    lane: "execution",
    collapsedBatches: [],
    collapsedTurns: [],
    historyLimit: HistoryPageSize,
  };
}

export function ExecutionInspectionView({
  run,
  runs,
  turnNumbers,
  onExpandStep,
  onInspectRequest,
  scopeId,
  state,
  onStateChange,
  loading = false,
}: {
  run: RunRecord | undefined;
  runs?: readonly RunRecord[];
  turnNumbers?: ReadonlyMap<string, number>;
  onExpandStep?: (runId: string) => void;
  onInspectRequest: (id: string) => void;
  scopeId?: string;
  state: ExecutionInspectionState;
  onStateChange: (patch: Partial<ExecutionInspectionState>) => void;
  loading?: boolean;
}): JSX.Element {
  const { openId, query, filter, lane, collapsedBatches, collapsedTurns, historyLimit, historyTail } = state;
  const list = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [focus, setFocus] = useState<{ id: string; align: "start" | "center" }>();
  const activeRuns = useMemo(() => runs ?? (run ? [run] : []), [runs, run]);
  const totals = useMemo(() => insightTotals(activeRuns, scopeId), [activeRuns, scopeId]);
  const search = useDeferredValue(query.trim().toLocaleLowerCase());
  const count = totals.steps.filter(isExecutionStep).length;
  // Keep the mount-time history anchor: appending a new call does not evict a record being read.
  const anchor = historyTail?.scopeId === scopeId ? historyTail?.count : undefined;
  const limit = historyLimit + Math.max(0, count - (anchor ?? count));
  useEffect(() => {
    if (anchor === undefined && count > 0 && !loading) onStateChange({ historyTail: { scopeId, count } });
  }, [anchor, count, scopeId, loading, onStateChange]);
  const overviewRows = useMemo(
    () => executionInspectionRows(activeRuns, { scopeId, filter: "all", search: "", turnNumbers, historyLimit: limit }),
    [activeRuns, scopeId, turnNumbers, limit],
  );
  const rows = useMemo(
    () =>
      executionInspectionRows(activeRuns, {
        scopeId,
        filter,
        search,
        turnNumbers,
        collapsedBatches,
        collapsedTurns,
        historyLimit: limit,
      }),
    [activeRuns, scopeId, filter, search, turnNumbers, collapsedBatches, collapsedTurns, limit],
  );
  const selected = [...rows, ...overviewRows].find(
    (row): row is Extract<Row, { kind: "step" }> => row.kind === "step" && row.id === openId,
  );
  useEffect(() => {
    if (!focus) return;
    const index = rows.findIndex((row) => row.id === focus.id);
    if (index < 0) return;
    list.current?.scrollToIndex({ index, align: focus.align, behavior: "auto" });
    setFocus(undefined);
  }, [focus, rows]);
  const selectRecord = (id: string): void => {
    const record = overviewRows.find((row) => row.id === id);
    if (record?.kind !== "step") return;
    const firstInBatch =
      record.step.toolBatch &&
      overviewRows.find(
        (row) =>
          row.kind === "step" &&
          row.run.requestId === record.run.requestId &&
          inspectionScopeId(row.step.scope) === inspectionScopeId(record.step.scope) &&
          row.step.toolBatch?.id === record.step.toolBatch?.id,
      );
    onStateChange({
      openId: id,
      query: "",
      filter: "all",
      collapsedTurns: collapsedTurns.filter((value) => value !== record.run.requestId),
      collapsedBatches: collapsedBatches.filter(
        (value) => value !== (firstInBatch ? `${firstInBatch.id}:parallel` : undefined),
      ),
    });
    onExpandStep?.(record.run.requestId);
    setFocus({ id, align: "center" });
  };
  const events = useMemo(
    () =>
      lane === "context"
        ? insightContextTimeline(activeRuns, scopeId, turnNumbers).filter((event) =>
            `${event.label} ${event.source ?? ""} ${t(`insights.events.kind.${event.kind}`)}`
              .toLocaleLowerCase()
              .includes(search),
          )
        : [],
    [activeRuns, scopeId, search, lane, turnNumbers],
  );
  if (!run) return <p className="insights-empty">{frontendMessage("observability.diagnostic.noRun")}</p>;
  if (loading && totals.models.length === 0 && totals.tools.length === 0)
    return (
      <p className="insights-empty" role="status">
        {t("insights.historyLoading")}
      </p>
    );
  const empty = lane === "context" ? events.length === 0 : rows.length === 0;
  return (
    <div className="insights-execution" data-execution-inspection>
      <section className="insights-execution-totals" aria-label={t("insights.process.title")}>
        <dl className="insights-facts">
          <div>
            <dt>{t("insights.process.requests")}</dt>
            <dd>{totals.models.length}</dd>
          </div>
          <div>
            <dt>{t("insights.process.tools")}</dt>
            <dd>{totals.tools.length}</dd>
          </div>
          <div>
            <dt>{t(scopeId === undefined ? "insights.process.tokens" : "insights.process.agentTokens")}</dt>
            <dd>{totals.tokens.value === undefined ? "—" : formatInteger(totals.tokens.value)}</dd>
          </div>
          <div>
            <dt>{t(scopeId === undefined ? "insights.process.cost" : "insights.process.agentCost")}</dt>
            <dd>{formatModelCharge(totals.charge)}</dd>
          </div>
        </dl>
        {loading ? (
          <p className="insights-note" role="status">
            {t("insights.historyLoading")}
          </p>
        ) : null}
      </section>
      <div className="insights-event-navigation">
        <SegmentedControl
          value={lane}
          onChange={(value) => onStateChange({ lane: value })}
          ariaLabel={t("insights.events.view")}
          options={[
            { value: "execution", label: t("insights.events.execution") },
            { value: "context", label: t("insights.events.context") },
          ]}
        />
      </div>
      <div className="insights-process-filter">
        <Input
          size="sm"
          value={query}
          onChange={(event) => onStateChange({ query: event.target.value })}
          placeholder={t("insights.process.search")}
          aria-label={t("insights.process.search")}
        />
        {lane === "execution" ? (
          <MenuSelect
            size="md"
            value={filter}
            onChange={(value) => {
              if (value === "all" || value === "model" || value === "tool" || value === "failed")
                onStateChange({ filter: value });
            }}
            placeholder={t("insights.process.filter.all")}
            ariaLabel={t("insights.process.filter")}
            options={(["all", "model", "tool", "failed"] as const).map((value) => ({
              value,
              label: t(`insights.process.filter.${value}`),
            }))}
          />
        ) : null}
      </div>
      {empty ? (
        <p className="insights-empty">
          {t(
            loading
              ? "insights.historyLoading"
              : run.status === "running" && totals.steps.length === 0
                ? "insights.process.waiting"
                : "insights.process.noMatches",
          )}
        </p>
      ) : null}
      {lane === "context" ? (
        <ContextEventList events={events} onInspectRequest={onInspectRequest} />
      ) : (
        <>
          <ExecutionTimingOverview rows={overviewRows} selectedId={openId} onSelect={selectRecord} />
          <div className="insights-trajectory-workspace" data-has-detail={Boolean(selected) || undefined}>
            <div className="insights-trajectory-ledger">
              <div className="insights-record-columns">
                <span>{t("insights.process.actionColumn")}</span>
                <span>{t("insights.process.resultColumn")}</span>
                <span>{t("insights.process.durationColumn")}</span>
              </div>
              {!search && filter === "all" && count > limit ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="insights-load-earlier"
                  onClick={() => {
                    setAtBottom(false);
                    if (rows[0]) setFocus({ id: rows[0].id, align: "start" });
                    onStateChange({ historyLimit: historyLimit + HistoryPageSize });
                  }}
                >
                  <AppIcon icon="chevron-up" size={12} />
                  {t("insights.process.loadEarlier", { count: count - limit })}
                </Button>
              ) : null}
              <Virtuoso
                ref={list}
                initialTopMostItemIndex={{ index: Math.max(0, rows.length - 1), align: "end" }}
                followOutput={(bottom) =>
                  bottom && !focus && !selected && !search && filter === "all" ? "auto" : false
                }
                atBottomStateChange={setAtBottom}
                className="insights-execution-list"
                data={rows}
                computeItemKey={(_index, row) => row.id}
                itemContent={(_index, row) => (
                  <ExecutionInspectionRow
                    row={row}
                    open={row.id === openId}
                    onToggle={() => {
                      if (row.kind === "turn") {
                        onStateChange({
                          collapsedTurns: row.collapsed
                            ? collapsedTurns.filter((id) => id !== row.run.requestId)
                            : [...collapsedTurns, row.run.requestId],
                        });
                        return;
                      }
                      if (row.kind !== "step") return;
                      const open = row.id === openId;
                      onStateChange({ openId: open ? undefined : row.id });
                      if (!open) onExpandStep?.(row.run.requestId);
                    }}
                    onToggleParallel={() => {
                      if (row.kind !== "step" || !row.parallel) return;
                      const parallel = row.parallel;
                      onStateChange({
                        collapsedBatches: parallel.collapsed
                          ? collapsedBatches.filter((id) => id !== parallel.id)
                          : [...collapsedBatches, parallel.id],
                      });
                    }}
                  />
                )}
              />
              {!atBottom ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="insights-jump-latest"
                  onClick={() =>
                    list.current?.scrollToIndex({ index: Math.max(0, rows.length - 1), align: "end", behavior: "auto" })
                  }
                >
                  <AppIcon icon="arrow-down" size={12} />
                  {t("insights.process.jumpLatest")}
                </Button>
              ) : null}
            </div>
            {selected ? (
              <ExecutionInspectionDetail
                row={selected}
                onClose={() => onStateChange({ openId: undefined })}
                onInspectRequest={onInspectRequest}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
