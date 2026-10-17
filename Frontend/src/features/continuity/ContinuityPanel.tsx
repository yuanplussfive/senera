import { useMemo, useState } from "react";
import type { WsRequest } from "../../api/eventTypes";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { AppIcon, type AppIconName } from "../../shared/ui";
import { useStore, type RunRecord } from "../../store/sessionStore";
import { ContinuityOverviewView } from "./ContinuityOverviewView";
import { ContinuityRecallView } from "./ContinuityRecallView";

export interface ContinuityPanelProps {
  send: (request: WsRequest) => boolean;
  connected: boolean;
}

type ContinuityPanelTab = "overview" | "knowledge";

const ContinuityPanelTabs: readonly {
  readonly id: ContinuityPanelTab;
  readonly label: FrontendMessageKey;
  readonly icon: AppIconName;
}[] = [
  { id: "overview", label: "continuity.tab.overview", icon: "book-open" },
  { id: "knowledge", label: "continuity.tab.knowledge", icon: "archive" },
];

export function ContinuityPanel(_props: ContinuityPanelProps): JSX.Element {
  const activeSessionId = useStore((state) => state.activeSessionId);
  const session = useStore((state) => (activeSessionId ? state.sessions[activeSessionId] : undefined));
  const viewedRunId = useStore((state) => (activeSessionId ? state.viewedRunIdBySession[activeSessionId] : undefined));
  const run = useMemo(() => selectRun(session?.runs ?? [], viewedRunId), [session?.runs, viewedRunId]);
  const [requestedTab, setRequestedTab] = useState<ContinuityPanelTab>("overview");

  if (!run?.continuity) {
    return <ContinuityEmpty hasHistory={Boolean(session?.runs.length)} />;
  }

  const availableTabs = ContinuityPanelTabs;
  const selectedTab = availableTabs.find((tab) => tab.id === requestedTab) ?? availableTabs[0];

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-surface-panel"
      data-continuity-panel
      data-testid="continuity-panel"
    >
      <header className="shrink-0 border-b border-line-subtle bg-surface-panel">
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center text-content-secondary">
              <AppIcon icon="clock" size={16} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium leading-4 text-content-muted">
                {frontendMessage("continuity.label")}
              </p>
              <h2 className="truncate text-[15px] font-semibold leading-5 text-content-primary">
                {frontendMessage("continuity.title")}
              </h2>
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-2 text-[11px] leading-4 text-content-secondary">
            <span
              className={cn("h-2 w-2 rounded-full", run?.continuity?.enabled ? "bg-moss-500" : "bg-ink-300")}
              aria-hidden="true"
            />
            {frontendMessage("continuity.currentTurn")}
          </span>
        </div>
        <nav
          role="tablist"
          aria-label={frontendMessage("continuity.title")}
          className="grid min-h-12 w-full min-w-0 grid-cols-2 border-t border-line-subtle px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                  "relative flex min-w-0 min-h-12 items-center justify-center gap-2 px-1 text-[12px] font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus",
                  active ? "text-accent-content" : "text-content-muted hover:text-content-primary",
                )}
              >
                <AppIcon icon={tab.icon} size={16} aria-hidden="true" />
                <span className="truncate">{frontendMessage(tab.label)}</span>
                {active ? (
                  <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t bg-accent-solid" aria-hidden="true" />
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
      className="flex h-full min-h-0 flex-col bg-surface-panel px-5 pt-6"
      data-continuity-panel
      data-continuity-empty
      data-testid="continuity-empty"
    >
      <p className="text-[11px] font-medium text-accent-content">{frontendMessage("continuity.label")}</p>
      <h2 className="mt-2 text-[16px] font-semibold leading-6 text-content-primary">
        {frontendMessage("continuity.empty.title")}
      </h2>
      <p className="mt-1 max-w-[34rem] text-[13px] leading-6 text-content-secondary">
        {frontendMessage(hasHistory ? "continuity.empty.history" : "continuity.empty.newRun")}
      </p>
      <span className="mt-5 block h-px w-10 bg-accent-solid" aria-hidden="true" />
    </section>
  );
}
