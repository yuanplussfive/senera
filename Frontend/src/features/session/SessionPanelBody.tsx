import { LayoutGroup } from "framer-motion";
import { useRef, type KeyboardEvent } from "react";
import { AppIcon, IconButton, ScrollArea, StateView } from "../../shared/ui";
import {
  FluidHoverHighlight,
  MotionList,
  MotionListItem,
  useFluidHover,
  useMotionLevel,
} from "../../shared/motion";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { readActiveRun, type SessionRecord } from "../../store/sessionStore";
import { EmptyState, SessionRow } from "./SessionRows";
import { SessionChannelFilterMenu, type SessionChannelFilter } from "./SessionChrome";

interface SessionPanelBodyProps {
  compactFrame?: boolean;
  sessions: readonly SessionRecord[];
  totalSessionCount: number;
  catalogSynced: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  channelFilter: SessionChannelFilter;
  onChannelFilterChange: (value: SessionChannelFilter) => void;
  activeSessionId: string | null;
  historyLoadingIds: Readonly<Record<string, boolean>>;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (session: SessionRecord, returnFocus: HTMLElement | null) => void;
  onDeleteSession: (session: SessionRecord, returnFocus: HTMLElement | null) => void;
  selectionMode: boolean;
  selectedSessionIds: ReadonlySet<string>;
  selectedSessionCount: number;
  hiddenSelectedCount: number;
  onToggleSelectionMode: () => void;
  onEnterSelectionMode: (sessionId: string) => void;
  onToggleSessionSelection: (sessionId: string, shift?: boolean) => void;
  onClearSelection: () => void;
  onToggleVisibleSelection: () => void;
  onDeleteSelected: () => void;
}

export function SessionPanelBody({
  compactFrame = false,
  sessions,
  totalSessionCount,
  catalogSynced,
  query,
  onQueryChange,
  channelFilter,
  onChannelFilterChange,
  activeSessionId,
  historyLoadingIds,
  onNewSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  selectionMode,
  selectedSessionIds,
  selectedSessionCount,
  hiddenSelectedCount,
  onToggleSelectionMode,
  onEnterSelectionMode,
  onToggleSessionSelection,
  onClearSelection,
  onToggleVisibleSelection,
  onDeleteSelected,
}: SessionPanelBodyProps): JSX.Element {
  const { disableMotion } = useMotionLevel();
  const sessionListRef = useRef<HTMLDivElement>(null);
  const sessionHover = useFluidHover(sessionListRef, { axis: "y" });
  // The active row already paints an opaque selection surface; the hover layer
  // must not run a second animation for the same rect underneath it.
  const selectedSessionIndex = sessions.findIndex((session) => session.sessionId === activeSessionId);
  const visibleSelectedCount = sessions.filter((session) => selectedSessionIds.has(session.sessionId)).length;
  const visibleAllSelected = sessions.length > 0 && visibleSelectedCount === sessions.length;
  const visibleSomeSelected = visibleSelectedCount > 0 && !visibleAllSelected;

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target;
    const typing =
      target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type !== "checkbox");
    if (typing) return;
    if (event.key === "Escape") {
      if (event.defaultPrevented) return;
      // Radix closes an open menu on Escape via a document listener that runs
      // after this bubbled handler; skip so one keypress does not also clear
      // the selection.
      if (document.querySelector('[role="menu"][data-state="open"]')) return;
      if (selectionMode) onToggleSelectionMode();
      return;
    }
    if (!selectionMode) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      const allVisibleSelected =
        sessions.length > 0 && sessions.every((session) => selectedSessionIds.has(session.sessionId));
      if (!allVisibleSelected) onToggleVisibleSelection();
      return;
    }
    if (event.key.toLowerCase() === "x" && sessionHover.activeIndex !== null) {
      const session = sessions[sessionHover.activeIndex];
      if (session) {
        event.preventDefault();
        onToggleSessionSelection(session.sessionId);
      }
    }
  };

  return (
    <div
      className={cn("relative flex min-h-0 flex-1 flex-col", compactFrame ? "px-0 pb-0" : "px-2 pb-2")}
      onKeyDown={handleListKeyDown}
    >
      {selectionMode ? (
        <div
          data-session-action-bar
          className="mb-3 flex min-w-0 shrink-0 items-center gap-2 rounded-[10px] border border-line-subtle bg-surface-soft px-2.5 py-1.5"
        >
          <button
            type="button"
            onClick={onToggleVisibleSelection}
            aria-label={frontendMessage("session.selectVisible")}
            aria-pressed={visibleAllSelected}
            disabled={sessions.length === 0}
            className={cn(
              "grid h-3.5 w-3.5 shrink-0 cursor-pointer place-items-center rounded-[4px] border transition-[background-color,border-color,color] duration-150 ease-out",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:cursor-default disabled:opacity-45",
              visibleAllSelected
                ? "border-content-secondary bg-content-secondary text-content-inverse"
                : visibleSomeSelected
                  ? "border-content-secondary bg-transparent text-content-secondary"
                  : "border-line-strong bg-transparent text-transparent",
            )}
          >
            {visibleSomeSelected ? (
              <span className="h-[1.5px] w-2 rounded-full bg-current" />
            ) : (
              <AppIcon icon="checkmark" className="h-2.5 w-2.5" strokeWidth={3} />
            )}
          </button>
          <span className="min-w-0 shrink-0 text-[11px] text-content-secondary">
            {frontendMessage("session.selectedCount", { count: selectedSessionCount })}
          </span>
          {hiddenSelectedCount > 0 ? (
            <span className="min-w-0 truncate text-[11px] text-content-muted">
              {frontendMessage("session.selectedCountHidden", { count: hiddenSelectedCount })}
            </span>
          ) : null}
          <span className="flex-1" />
          {selectedSessionCount > 0 ? (
            <IconButton
              label={frontendMessage("session.deleteSelected")}
              tooltip={frontendMessage("session.deleteSelected")}
              size="sm"
              tone="danger"
              onClick={onDeleteSelected}
            >
              <AppIcon icon="trash" className="h-3.5 w-3.5" />
            </IconButton>
          ) : null}
          <IconButton
            label={frontendMessage("session.cancelSelection")}
            tooltip={frontendMessage("session.cancelSelection")}
            size="sm"
            tone="muted"
            onClick={onToggleSelectionMode}
          >
            <AppIcon icon="close" className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      ) : (
        <div className="mb-3 flex min-w-0 shrink-0 items-center gap-1.5">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{frontendMessage("session.searchPlaceholder")}</span>
            <AppIcon
              icon="search"
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-muted"
            />
            <input
              type="search"
              data-selectable="true"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={frontendMessage("session.searchPlaceholder")}
              className="h-9 w-full rounded-[10px] border border-line-subtle bg-surface-raised pl-8 pr-8 text-[12px] text-content-primary outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-content-muted"
            />
            {query ? (
              <button
                type="button"
                onClick={() => onQueryChange("")}
                className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-content-muted transition-colors duration-150 hover:bg-surface-hover hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
                aria-label={frontendMessage("session.searchClear")}
              >
                <AppIcon icon="close" className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
          <SessionChannelFilterMenu value={channelFilter} onChange={onChannelFilterChange} />
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="pb-2">
          {totalSessionCount === 0 ? (
            catalogSynced ? (
              <EmptyState onNewSession={onNewSession} />
            ) : (
              <StateView status="loading" className="min-h-[200px] px-4" />
            )
          ) : sessions.length === 0 ? (
            <StateView
              status="empty"
              className="min-h-[120px] px-3"
              description={frontendMessage("session.searchEmpty")}
            />
          ) : (
            <div ref={sessionListRef} className="relative" data-session-list {...sessionHover.handlers}>
              <FluidHoverHighlight
                hover={sessionHover}
                hidden={disableMotion || sessionHover.activeIndex === selectedSessionIndex}
                className="rounded-[10px]"
                data-session-fluid-hover
              />
              <LayoutGroup id="session-list-selection">
                <MotionList className="flex flex-col gap-1 pt-0">
                  {sessions.map((session, index) => {
                    const isActive = session.sessionId === activeSessionId;
                    const activeRun = readActiveRun(session);
                    const lastRun = session.runs[session.runs.length - 1];
                    const isRunning = activeRun !== undefined;
                    const hasFailed = !activeRun && lastRun?.status === "failed";
                    const isHistoryLoading = !!historyLoadingIds[session.sessionId];

                    return (
                      <MotionListItem key={session.sessionId} initial={false}>
                        <SessionRow
                          index={index}
                          registerItem={sessionHover.registerItem}
                          fluidHoverEnabled={!disableMotion}
                          active={isActive}
                          sessionId={session.sessionId}
                          title={session.title}
                          accent={isHistoryLoading || isRunning ? "running" : hasFailed ? "failed" : "idle"}
                          selectionMode={selectionMode}
                          selected={selectedSessionIds.has(session.sessionId)}
                          selectionCount={selectedSessionCount}
                          onClick={() => onSelectSession(session.sessionId)}
                          onToggleSelected={(shift) => onToggleSessionSelection(session.sessionId, shift)}
                          onEnterSelectionMode={() => onEnterSelectionMode(session.sessionId)}
                          onClearSelection={onClearSelection}
                          onDeleteSelected={onDeleteSelected}
                          onRename={(returnFocus) => onRenameSession(session, returnFocus)}
                          onClose={(returnFocus) => onDeleteSession(session, returnFocus)}
                          onFocus={() => sessionHover.setActiveIndex(index)}
                        />
                      </MotionListItem>
                    );
                  })}
                </MotionList>
              </LayoutGroup>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
