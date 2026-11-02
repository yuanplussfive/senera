import "../observability/insights.css";
import { useCallback, useRef, useState } from "react";
import { frontendFeatureMessage as t } from "../../i18n/frontendFeatureMessageCatalog";
import { useStore } from "../../store/sessionStore";
import { AppIcon, Dialog, DialogContent, IconButton, MenuSelect } from "../../shared/ui";
import { ContinuityOverviewView, createContinuityInspectionState } from "./ContinuityOverviewView";

export function ContinuityPanel(): JSX.Element {
  const sessionId = useStore((state) => state.activeSessionId);
  const session = useStore((state) => (sessionId ? state.sessions[sessionId] : undefined));
  const viewedRunId = useStore((state) => (sessionId ? state.viewedRunIdBySession[sessionId] : undefined));
  const setViewedRun = useStore((state) => state.setViewedRun);
  const runs = session?.runs ?? [];
  const run = viewedRunId ? runs.find((item) => item.requestId === viewedRunId) : runs.at(-1);
  const loading = useStore((state) =>
    sessionId && run ? state.runHistoryDetailStates[sessionId]?.[run.requestId] === "loading" : false,
  );
  const key = JSON.stringify([sessionId, run?.requestId]);
  const [inspection, setInspection] = useState(() => ({ key, state: createContinuityInspectionState() }));
  const state = inspection.key === key ? inspection.state : createContinuityInspectionState();
  const [expanded, setExpanded] = useState(false);
  const scrollPosition = useRef({ key, top: 0 });
  const restoreScrollPosition = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) node.scrollTop = scrollPosition.current.key === key ? scrollPosition.current.top : 0;
    },
    [key],
  );
  const memory = run?.continuity;
  const status = memory
    ? t(memory.enabled ? "continuity.status.ready" : "continuity.status.paused")
    : t("continuity.status.waiting");
  const body = (
    <section className="session-insights" data-testid={expanded ? "continuity-panel-dialog" : "continuity-panel"}>
      <header className="insights-header">
        <div>
          <h2>{t("continuity.title")}</h2>
          <span className="insights-header-caption">
            {memory ? status : t(loading ? "insights.historyLoading" : "continuity.status.waiting")}
          </span>
        </div>
        <IconButton
          size="sm"
          tone="muted"
          label={t(expanded ? "continuity.collapse" : "continuity.expand")}
          onClick={() => setExpanded(!expanded)}
        >
          <AppIcon icon={expanded ? "restore" : "maximize"} size={14} />
        </IconButton>
      </header>
      <div className="insights-toolbar">
        <MenuSelect
          value={viewedRunId ?? "latest"}
          ariaLabel={t("insights.selectTurn")}
          placeholder={t("insights.noTurns")}
          triggerClassName="w-full"
          options={[
            { value: "latest", label: t("insights.latest"), description: runs.at(-1)?.input },
            ...runs
              .map((item, index) => ({
                value: item.requestId,
                label: t("insights.turn", { index: index + 1 }),
                description: item.input,
              }))
              .reverse(),
          ]}
          onChange={(value) => {
            if (sessionId) setViewedRun(sessionId, value === "latest" ? undefined : value);
          }}
        />
      </div>
      {run ? <p className="insights-selected-input">{run.input}</p> : null}
      <div
        ref={restoreScrollPosition}
        className="insights-scroll insights-dashboard continuity-scroll"
        onScroll={(event) => {
          scrollPosition.current = { key, top: event.currentTarget.scrollTop };
        }}
      >
        {run && !(loading && !run.continuity) ? (
          <ContinuityOverviewView
            run={run}
            state={state}
            onStateChange={(patch) =>
              setInspection((current) => ({
                key,
                state: { ...(current.key === key ? current.state : createContinuityInspectionState()), ...patch },
              }))
            }
          />
        ) : (
          <p className="insights-empty" data-testid="continuity-empty">
            {t(loading ? "insights.historyLoading" : "continuity.empty.newRun")}
          </p>
        )}
      </div>
    </section>
  );
  return (
    <>
      {!expanded ? body : <div className="session-insights" />}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          title={t("continuity.title")}
          showHeader={false}
          showClose={false}
          className="h-[min(880px,calc(100dvh_-_24px))] w-[min(1120px,calc(100vw_-_24px))] max-h-none max-w-none"
          bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {expanded ? body : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
