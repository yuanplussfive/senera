import { LayoutGroup } from "framer-motion";
import { useRef } from "react";
import { AppIcon, ScrollArea, StateView } from "../../shared/ui";
import { FluidHoverHighlight, MotionList, MotionListItem, useFluidHover, useMotionLevel } from "../../shared/motion";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { readActiveRun, type SessionRecord } from "../../store/sessionStore";
import { EmptyState, SessionRow } from "./SessionRows";

interface SessionPanelBodyProps {
  compactFrame?: boolean;
  sessions: readonly SessionRecord[];
  totalSessionCount: number;
  catalogSynced: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  activeSessionId: string | null;
  historyLoadingIds: Readonly<Record<string, boolean>>;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (session: SessionRecord, returnFocus: HTMLElement | null) => void;
  onDeleteSession: (session: SessionRecord, returnFocus: HTMLElement | null) => void;
}

export function SessionPanelBody({
  compactFrame = false,
  sessions,
  totalSessionCount,
  catalogSynced,
  query,
  onQueryChange,
  activeSessionId,
  historyLoadingIds,
  onNewSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
}: SessionPanelBodyProps): JSX.Element {
  const { disableMotion } = useMotionLevel();
  const sessionListRef = useRef<HTMLDivElement>(null);
  const sessionHover = useFluidHover(sessionListRef, { axis: "y" });
  // The active row already paints an opaque selection surface; the hover layer
  // must not run a second animation for the same rect underneath it.
  const selectedSessionIndex = sessions.findIndex((session) => session.sessionId === activeSessionId);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", compactFrame ? "px-0 pb-0" : "px-2 pb-2")}>
      <div className="mb-2 flex min-w-0 shrink-0 items-center gap-1.5">
        <label className="group relative min-w-0 flex-1">
          <span className="sr-only">{frontendMessage("session.searchPlaceholder")}</span>
          <AppIcon
            icon="search"
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-muted group-focus-within:text-accent-content"
          />
          <input
            type="search"
            data-selectable="true"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={frontendMessage("session.searchPlaceholder")}
            className="h-8 w-full rounded-[10px] border border-line-subtle bg-surface-raised pl-8 pr-8 text-[12px] text-content-primary outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-content-muted focus:border-accent-border-strong focus:ring-2 focus:ring-accent-focus"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-content-muted transition-colors duration-150 hover:bg-surface-hover hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus:ring-accent-focus"
              aria-label={frontendMessage("session.searchClear")}
            >
              <AppIcon icon="close" className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>
      </div>

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
                className="rounded-[9px]"
                data-session-fluid-hover
              />
              <LayoutGroup id="session-list-selection">
                <MotionList className="flex flex-col gap-0.5 pt-1">
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
                          onClick={() => onSelectSession(session.sessionId)}
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
