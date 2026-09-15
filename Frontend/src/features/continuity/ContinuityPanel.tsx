import { useEffect, useMemo, useState } from "react";
import type { WsRequest } from "../../api/eventTypes";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { useStore, type RunRecord } from "../../store/sessionStore";
import { ContinuityConditionView } from "./ContinuityConditionView";
import { ContinuityOverviewView } from "./ContinuityOverviewView";
import { ContinuityRecallView } from "./ContinuityRecallView";
import { ContinuityAgendaView } from "./ContinuityAgendaView";

export interface ContinuityPanelProps {
  send: (request: WsRequest) => boolean;
  connected: boolean;
}

type ContinuityPanelTab = "overview" | "knowledge" | "conditions" | "agenda";

const ContinuityPanelTabs: readonly {
  readonly id: ContinuityPanelTab;
  readonly label: FrontendMessageKey;
}[] = [
  { id: "overview", label: "continuity.tab.overview" },
  { id: "knowledge", label: "continuity.tab.knowledge" },
  { id: "conditions", label: "continuity.tab.conditions" },
  { id: "agenda", label: "continuity.tab.agenda" },
];

export function ContinuityPanel({ send, connected }: ContinuityPanelProps): JSX.Element {
  const activeSessionId = useStore((state) => state.activeSessionId);
  const session = useStore((state) => (activeSessionId ? state.sessions[activeSessionId] : undefined));
  const agenda = useStore((state) => state.agenda);
  const world = useStore((state) => state.world);
  const viewedRunId = useStore((state) => (activeSessionId ? state.viewedRunIdBySession[activeSessionId] : undefined));
  const run = useMemo(() => selectRun(session?.runs ?? [], viewedRunId), [session?.runs, viewedRunId]);
  const [requestedTab, setRequestedTab] = useState<ContinuityPanelTab>("overview");

  useEffect(() => {
    if (!connected) return;
    send({ type: "agenda.get" });
    send({ type: "world.get" });
  }, [connected, send]);

  if (!agenda && !world && !run?.continuity) {
    return <ContinuityEmpty hasHistory={Boolean(session?.runs.length)} />;
  }

  const availableTabs = ContinuityPanelTabs.filter((tab) => tab.id === "agenda" || Boolean(run?.continuity));
  const selectedTab = availableTabs.find((tab) => tab.id === requestedTab) ?? availableTabs[0];

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-surface-panel"
      data-continuity-panel
      data-testid="continuity-panel"
    >
      <header className="shrink-0 border-b border-line-subtle bg-surface-panel">
        <div className="px-4 pb-2.5 pt-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-medium tracking-[0.06em] text-accent-content">
                {frontendMessage("continuity.worldbookLabel")}
              </p>
            </div>
            <span className="mt-1 flex shrink-0 items-center gap-1.5 text-[9.5px] leading-4 text-content-muted">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  agenda || world || run?.continuity?.enabled ? "bg-moss-500" : "bg-ink-300",
                )}
                aria-hidden="true"
              />
              {frontendMessage("continuity.currentTurn")}
            </span>
          </div>
          <p className="mt-1 truncate text-[10px] leading-4 text-content-muted">
            {world
              ? frontendMessage("continuity.agenda.clockSummary", {
                  date: world.time.localDate,
                  weekday: world.time.weekdayLabel,
                  time: world.time.localTime,
                })
              : agenda
                ? frontendMessage("continuity.agenda.clockSummary", {
                    date: agenda.clock.localDate,
                    weekday: agenda.clock.weekdayLabel,
                    time: agenda.clock.localTime,
                  })
                : frontendMessage("continuity.currentTurn")}
          </p>
        </div>
        <nav
          role="tablist"
          aria-label={frontendMessage("continuity.title")}
          className="flex h-9 w-full min-w-0 gap-4 overflow-x-auto border-x-0 border-b-0 bg-transparent px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onKeyDown={(event) => {
            const currentIndex = availableTabs.findIndex((tab) => tab.id === selectedTab.id);
            const nextIndex = resolveTabNavigationIndex(event.key, currentIndex, availableTabs.length);
            if (nextIndex === undefined) return;
            event.preventDefault();
            setRequestedTab(availableTabs[nextIndex].id);
          }}
        >
          {availableTabs.map((tab) => {
            const active = selectedTab.id === tab.id;
            return (
              <button
                key={tab.id}
                id={`continuity-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`continuity-panel-${tab.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setRequestedTab(tab.id)}
                className={cn(
                  "relative flex h-9 shrink-0 items-center gap-1.5 px-0 text-[10.5px] font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus",
                  active ? "text-content-primary" : "text-content-muted hover:text-content-secondary",
                )}
              >
                <span className="truncate">{frontendMessage(tab.label)}</span>
                {active ? (
                  <span className="absolute inset-x-0 bottom-0 h-px bg-accent-solid" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </nav>
      </header>

      <div
        id={`continuity-panel-${selectedTab.id}`}
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto"
        role="tabpanel"
        aria-labelledby={`continuity-tab-${selectedTab.id}`}
        data-continuity-tab={selectedTab.id}
      >
        {selectedTab.id === "overview" && run?.continuity ? <ContinuityOverviewView run={run} /> : null}
        {selectedTab.id === "knowledge" && run?.continuity ? <ContinuityRecallView run={run} /> : null}
        {selectedTab.id === "conditions" && run?.continuity ? <ContinuityConditionView run={run} /> : null}
        {selectedTab.id === "agenda" ? <ContinuityAgendaView agenda={agenda} world={world} run={run} /> : null}
      </div>
    </section>
  );
}

function selectRun(runs: readonly RunRecord[], viewedRunId: string | undefined): RunRecord | undefined {
  if (viewedRunId) {
    const viewedRun = runs.find((run) => run.requestId === viewedRunId);
    if (viewedRun) return viewedRun;
  }
  return runs.at(-1);
}

function resolveTabNavigationIndex(key: string, currentIndex: number, tabCount: number): number | undefined {
  if (tabCount === 0) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return tabCount - 1;
  if (key === "ArrowRight") return (currentIndex + 1) % tabCount;
  if (key === "ArrowLeft") return (currentIndex - 1 + tabCount) % tabCount;
  return undefined;
}

function ContinuityEmpty({ hasHistory }: { hasHistory: boolean }): JSX.Element {
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-surface-panel px-4 pt-5"
      data-continuity-panel
      data-continuity-empty
      data-testid="continuity-empty"
    >
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-accent-content">
        {frontendMessage("continuity.worldbookLabel")}
      </p>
      <h2 className="mt-2 text-[14px] font-medium leading-5 text-content-primary">
        {frontendMessage("continuity.empty.title")}
      </h2>
      <p className="mt-1 max-w-[300px] text-[10.5px] leading-5 text-content-muted">
        {frontendMessage(hasHistory ? "continuity.empty.history" : "continuity.empty.newRun")}
      </p>
      <span className="mt-5 block h-px w-10 bg-accent-solid" aria-hidden="true" />
    </section>
  );
}
