import "./insights.css";
import { Activity, memo, useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import { frontendFeatureMessage as t } from "../../i18n/frontendFeatureMessageCatalog";
import { useStore } from "../../store/sessionStore";
import {
  AppIcon,
  Dialog,
  DialogContent,
  IconButton,
  InlineError,
  MenuSelect,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../shared/ui";
import { ContextInspectionView, createContextInspectionState } from "./ContextInspectionView";
import { ExecutionInspectionView, createExecutionInspectionState } from "./ExecutionInspectionView";
import { EventMonitorPanel } from "./EventMonitorPanel";
import { inspectionScopes } from "./inspectionScopeModel";
import { SessionOverviewView } from "./SessionOverviewView";
import { useSessionInsights } from "./useSessionInsights";
import { createInsightRunSelector } from "./sessionInsightsModel";
import type { RunRecord } from "../../store/session/types";

type InsightsView = "overview" | "context" | "process";
const Views = ["overview", "context", "process"] as const;
const EmptyRuns: RunRecord[] = [];
const MemoizedOverview = memo(SessionOverviewView);
const createInspectionState = (runKey: string) => ({
  runKey,
  scopeId: undefined as string | undefined,
  requestId: undefined as string | undefined,
  context: createContextInspectionState(),
  process: createExecutionInspectionState(),
});

export function SessionInsightsPanel({ initialView = "overview" }: { initialView?: InsightsView }): JSX.Element {
  const sessionId = useStore((state) => state.activeSessionId);
  const [view, setView] = useState<InsightsView>(initialView);
  const [showLogs, setShowLogs] = useState(false);
  const [observing, setObserving] = useState(initialView === "overview");
  const [historyRequested, setHistoryRequested] = useState(initialView === "process");
  const changeView = useCallback((next: InsightsView) => {
    if (next === "overview") setObserving(true);
    if (next === "process") setHistoryRequested(true);
    setView(next);
  }, []);
  const insights = useSessionInsights({ enabled: observing || historyRequested });
  return (
    <SessionInsightsSurface
      key={sessionId ?? "no-session"}
      sessionId={sessionId}
      view={view}
      setView={changeView}
      retainOverview={observing}
      showLogs={showLogs}
      setShowLogs={setShowLogs}
      {...insights}
    />
  );
}

function SessionInsightsSurface({
  sessionId,
  runs: currentRuns,
  loading: historyLoading,
  error,
  refresh,
  view,
  setView,
  retainOverview,
  showLogs,
  setShowLogs,
}: ReturnType<typeof useSessionInsights> & {
  sessionId: string | null;
  view: InsightsView;
  setView: (view: InsightsView) => void;
  retainOverview: boolean;
  showLogs: boolean;
  setShowLogs: (visible: boolean) => void;
}): JSX.Element {
  // A new conversation paints its shell first. The keyed surface can never show the previous one's data.
  const runs = useDeferredValue(currentRuns, EmptyRuns);
  const loading = historyLoading || runs !== currentRuns;
  const setViewedRun = useStore((state) => state.setViewedRun);
  const [selected, setSelection] = useState("all");
  const activeRuns = useMemo(
    () =>
      selected === "all"
        ? runs
        : runs.filter((run) => run.requestId === (selected === "latest" ? runs.at(-1)?.requestId : selected)),
    [runs, selected],
  );
  const selectOverview = useMemo(() => createInsightRunSelector({ overviewOnly: true }), []);
  const overviewRuns = useMemo(() => selectOverview(activeRuns), [activeRuns, selectOverview]);
  const turnOrder = runs.map((run) => run.requestId).join("\0");
  const turnNumbers = useMemo(
    () =>
      new Map(
        turnOrder
          .split("\0")
          .filter(Boolean)
          .map((id, index) => [id, index + 1]),
      ),
    [turnOrder],
  );
  const activeRunsRef = useRef(activeRuns);
  useLayoutEffect(() => {
    activeRunsRef.current = activeRuns;
  }, [activeRuns]);
  const runKey = JSON.stringify([sessionId, selected]);
  const [inspectionState, setInspectionState] = useState(() => createInspectionState(runKey));
  const inspection = inspectionState.runKey === runKey ? inspectionState : createInspectionState(runKey);
  const updateInspection = useCallback(
    (patch: Partial<typeof inspection>) =>
      setInspectionState((current) => ({
        ...(current.runKey === runKey ? current : createInspectionState(runKey)),
        ...patch,
      })),
    [runKey],
  );
  const updateSection = useCallback(
    <K extends "context" | "process">(section: K, patch: Partial<(typeof inspection)[K]>) =>
      setInspectionState((current) => {
        const next = current.runKey === runKey ? current : createInspectionState(runKey);
        return { ...next, [section]: { ...next[section], ...patch } };
      }),
    [runKey],
  );
  const scopes = useMemo(
    () => [...new Map(activeRuns.flatMap((run) => inspectionScopes(run)).map((entry) => [entry.id, entry])).values()],
    [activeRuns],
  );
  const [expanded, setExpanded] = useState(false);
  const detailStates = useStore((state) => (sessionId ? state.runHistoryDetailStates[sessionId] : undefined));
  const detailLoading = activeRuns.some((run) => detailStates?.[run.requestId] === "loading");
  const inspectRequest = useCallback(
    (id: string) => {
      const run = activeRunsRef.current.find((item) => item.steps.some((step) => step.id === id));
      const step = run?.steps.find((item) => item.id === id);
      if (step?.kind === "tool") {
        updateSection("process", { openId: id });
        setView("process");
      } else {
        updateInspection({ requestId: id });
        setView("context");
      }
      if (sessionId && run) setViewedRun(sessionId, run.requestId);
    },
    [sessionId, setViewedRun, setView, updateInspection, updateSection],
  );
  const contextView = (
    <ContextInspectionView
      runs={activeRuns}
      run={activeRuns.at(-1)}
      requestId={inspection.requestId}
      onSelectRequest={(requestId) => updateInspection({ requestId })}
      loading={loading || detailLoading}
      scopeId={inspection.scopeId}
      state={inspection.context}
      onStateChange={(patch) => updateSection("context", patch)}
    />
  );
  const body = (
    <section
      className="session-insights"
      data-session-insights
      data-testid={expanded ? "session-insights-dialog" : "session-insights-panel"}
    >
      <header className="insights-header">
        <div>
          <h2>{t("insights.title")}</h2>
          <span className="insights-header-caption" role={historyLoading && view === "overview" ? "status" : undefined}>
            {historyLoading ? t("insights.historyLoading") : t("insights.subtitle")}
          </span>
        </div>
        <IconButton
          label={t("insights.refresh")}
          tooltip={t("insights.refresh")}
          size="sm"
          tone="muted"
          onClick={refresh}
          loading={historyLoading}
        >
          <AppIcon icon="refresh" size={14} />
        </IconButton>
        <IconButton
          label={t(showLogs ? "insights.back" : "insights.logs")}
          tooltip={t(showLogs ? "insights.back" : "insights.logs")}
          size="sm"
          tone="muted"
          onClick={() => setShowLogs(!showLogs)}
        >
          <AppIcon icon={showLogs ? "arrow-left" : "code"} size={15} />
        </IconButton>
        <IconButton
          label={t(expanded ? "continuity.collapse" : "continuity.expand")}
          tooltip={t(expanded ? "continuity.collapse" : "continuity.expand")}
          size="sm"
          tone="muted"
          onClick={() => setExpanded(!expanded)}
        >
          <AppIcon icon={expanded ? "restore" : "maximize"} size={14} />
        </IconButton>
      </header>
      {showLogs ? (
        <EventMonitorPanel />
      ) : (
        <>
          <div className="insights-toolbar">
            <MenuSelect
              value={selected}
              placeholder={t("insights.noTurns")}
              options={[
                {
                  value: "all",
                  label: t("insights.allTurns"),
                  description: t("insights.stats.scope", { count: runs.length }),
                },
                { value: "latest", label: t("insights.latest"), description: runs.at(-1)?.input },
                ...runs
                  .map((run, index) => ({
                    value: run.requestId,
                    label: t("insights.turn", { index: index + 1 }),
                    description: run.input,
                  }))
                  .reverse(),
              ]}
              onChange={(value) => {
                setSelection(value);
                if (sessionId && value !== "all") setViewedRun(sessionId, value === "latest" ? undefined : value);
              }}
              ariaLabel={t("insights.selectTurn")}
              triggerClassName="w-full"
            />
            {scopes.length > 1 ? (
              <div className="insights-agent-picker">
                <MenuSelect
                  value={inspection.scopeId ?? "all"}
                  placeholder={t("insights.agent.all")}
                  ariaLabel={t("insights.agent.select")}
                  triggerClassName="w-full"
                  options={[
                    { value: "all", label: t("insights.agent.all") },
                    ...scopes.map((entry) => ({
                      value: entry.id,
                      label:
                        entry.scope?.agentName ??
                        t(
                          entry.scope?.role === "merge"
                            ? "insights.agent.merge"
                            : entry.id === "main"
                              ? "insights.agent.main"
                              : "insights.agent.unnamed",
                        ),
                    })),
                  ]}
                  onChange={(value) =>
                    updateInspection({ scopeId: value === "all" ? undefined : value, requestId: undefined })
                  }
                />
              </div>
            ) : null}
          </div>
          {selected !== "all" && activeRuns.at(-1) ? (
            <p className="insights-selected-input">{activeRuns.at(-1)!.input}</p>
          ) : null}
          {error ? (
            <div className="insights-history-notice">
              <InlineError onRetry={refresh}>{t("insights.historyError", { message: error })}</InlineError>
            </div>
          ) : null}
          <Tabs
            value={view}
            onValueChange={(value) => {
              if (Views.some((item) => item === value)) setView(value as InsightsView);
            }}
            className="insights-tabs"
          >
            <TabsList variant="underline" className="insights-tab-list">
              {Views.map((item) => (
                <TabsTrigger value={item} key={item}>
                  {t(`insights.tab.${item}`)}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent
              value="overview"
              forceMount={retainOverview ? true : undefined}
              className="insights-tab-content insights-scroll insights-dashboard"
            >
              <Activity mode={view === "overview" ? "visible" : "hidden"}>
                <MemoizedOverview
                  runs={overviewRuns}
                  scopeId={inspection.scopeId}
                  turnNumbers={turnNumbers}
                  onInspectRequest={inspectRequest}
                />
              </Activity>
            </TabsContent>
            <TabsContent value="context" className="insights-tab-content insights-scroll">
              {contextView}
            </TabsContent>
            <TabsContent value="process" className="insights-tab-content">
              <ExecutionInspectionView
                turnNumbers={turnNumbers}
                runs={activeRuns}
                run={activeRuns.at(-1)}
                scopeId={inspection.scopeId}
                state={inspection.process}
                onStateChange={(patch) => updateSection("process", patch)}
                loading={detailLoading}
                onInspectRequest={inspectRequest}
                onExpandStep={(runId) => {
                  if (sessionId) setViewedRun(sessionId, runId);
                }}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </section>
  );
  return (
    <>
      {!expanded ? body : <div className="session-insights" />}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          title={t("insights.title")}
          showHeader={false}
          showClose={false}
          className="h-[min(960px,calc(100dvh_-_24px))] w-[min(1360px,calc(100vw_-_24px))] max-h-none max-w-none"
          bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {expanded ? body : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
