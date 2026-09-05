import { Search, X } from "lucide-react";
import { LayoutGroup } from "framer-motion";
import { useRef, useState, type DragEvent } from "react";
import { MenuSelect, ScrollArea, StateView } from "../../shared/ui";
import { MotionList, MotionListItem } from "../../shared/motion";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { readActiveRun, type SessionOrderPlacement, type SessionRecord } from "../../store/sessionStore";
import { EmptyState, SessionRow } from "./SessionRows";
import type { FrontendMessageKey } from "../../i18n/frontendMessageCatalog";

type SessionChannelFilter = "all" | "console" | "qq" | "telegram" | "discord";

const SessionChannelMessageKeys = {
  all: "session.channel.all",
  console: "session.channel.console",
  qq: "session.channel.qq",
  telegram: "session.channel.telegram",
  discord: "session.channel.discord",
} as const satisfies Record<SessionChannelFilter, FrontendMessageKey>;

interface SessionPanelBodyProps {
  sessions: readonly SessionRecord[];
  totalSessionCount: number;
  catalogSynced: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  channelFilter: SessionChannelFilter;
  onChannelFilterChange: (value: SessionChannelFilter) => void;
  activeSessionId: string | null;
  historyLoadingIds: Readonly<Record<string, boolean>>;
  showInlineRowActions: boolean;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onMoveSession: (sessionId: string, targetSessionId: string, placement: SessionOrderPlacement) => void;
  onRenameSession: (session: SessionRecord, returnFocus: HTMLElement | null) => void;
  onDeleteSession: (session: SessionRecord, returnFocus: HTMLElement | null) => void;
}

export function SessionPanelBody({
  sessions,
  totalSessionCount,
  catalogSynced,
  query,
  onQueryChange,
  channelFilter,
  onChannelFilterChange,
  activeSessionId,
  historyLoadingIds,
  showInlineRowActions,
  onNewSession,
  onSelectSession,
  onMoveSession,
  onRenameSession,
  onDeleteSession,
}: SessionPanelBodyProps): JSX.Element {
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ sessionId: string; placement: SessionOrderPlacement } | null>(null);
  const draggedSessionIdRef = useRef<string | null>(null);
  const dropTargetRef = useRef<{ sessionId: string; placement: SessionOrderPlacement } | null>(null);

  const clearDragState = (): void => {
    draggedSessionIdRef.current = null;
    dropTargetRef.current = null;
    setDraggedSessionId((current) => (current === null ? current : null));
    setDropTarget((current) => (current === null ? current : null));
  };

  const handleDragStart = (sessionId: string, event: DragEvent<HTMLButtonElement>): void => {
    draggedSessionIdRef.current = sessionId;
    dropTargetRef.current = null;
    setDraggedSessionId(sessionId);
    setDropTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", sessionId);
  };

  const handleDragOver = (sessionId: string, event: DragEvent<HTMLDivElement>): void => {
    const sourceSessionId = draggedSessionIdRef.current ?? event.dataTransfer.getData("text/plain");
    if (!sourceSessionId || sourceSessionId === sessionId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY <= bounds.top + bounds.height / 2 ? "before" : "after";
    const current = dropTargetRef.current;
    if (current?.sessionId === sessionId && current.placement === placement) return;
    const next = { sessionId, placement } satisfies { sessionId: string; placement: SessionOrderPlacement };
    dropTargetRef.current = next;
    setDropTarget(next);
  };

  const handleDrop = (sessionId: string, event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const sourceSessionId = draggedSessionIdRef.current ?? event.dataTransfer.getData("text/plain");
    const currentTarget = dropTargetRef.current;
    const placement = currentTarget?.sessionId === sessionId ? currentTarget.placement : "before";
    if (sourceSessionId && sourceSessionId !== sessionId) {
      onMoveSession(sourceSessionId, sessionId, placement);
    }
    clearDragState();
  };

  const handleKeyboardMove = (sessionId: string, direction: "up" | "down" | "start" | "end"): void => {
    const currentIndex = sessions.findIndex((session) => session.sessionId === sessionId);
    if (currentIndex < 0 || sessions.length < 2) return;
    if (direction === "up" && currentIndex > 0) {
      onMoveSession(sessionId, sessions[currentIndex - 1].sessionId, "before");
    } else if (direction === "down" && currentIndex < sessions.length - 1) {
      onMoveSession(sessionId, sessions[currentIndex + 1].sessionId, "after");
    } else if (direction === "start" && currentIndex > 0) {
      onMoveSession(sessionId, sessions[0].sessionId, "before");
    } else if (direction === "end" && currentIndex < sessions.length - 1) {
      onMoveSession(sessionId, sessions[sessions.length - 1].sessionId, "after");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
      <div className="mb-2 flex min-w-0 shrink-0 items-center gap-1.5">
        <label className="group relative min-w-0 flex-1">
          <span className="sr-only">{frontendMessage("session.searchPlaceholder")}</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-muted group-focus-within:text-accent-content" />
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
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>
        <MenuSelect
          value={channelFilter}
          placeholder={frontendMessage("session.channel.all")}
          ariaLabel={frontendMessage("session.channel.filter")}
          options={(Object.keys(SessionChannelMessageKeys) as SessionChannelFilter[]).map((value) => ({
            value,
            label: frontendMessage(SessionChannelMessageKeys[value]),
          }))}
          triggerClassName="h-8 w-[92px] shrink-0 rounded-[10px] border border-line-subtle bg-surface-raised px-2 text-[11px] shadow-none"
          contentClassName="min-w-[150px]"
          onChange={(value) => onChannelFilterChange(value as SessionChannelFilter)}
        />
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
                    <MotionListItem
                      key={session.sessionId}
                      index={index}
                      itemCount={sessions.length}
                      layout={draggedSessionId ? false : "position"}
                      initial={false}
                    >
                      <SessionRow
                        active={isActive}
                        sessionId={session.sessionId}
                        title={session.title}
                        accent={isHistoryLoading || isRunning ? "running" : hasFailed ? "failed" : "idle"}
                        onClick={() => onSelectSession(session.sessionId)}
                        dragging={draggedSessionId === session.sessionId}
                        dragActive={draggedSessionId !== null}
                        dropPosition={dropTarget?.sessionId === session.sessionId ? dropTarget.placement : undefined}
                        onDragStart={handleDragStart}
                        onDragEnd={clearDragState}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                        onKeyboardMove={handleKeyboardMove}
                        showInlineActions={showInlineRowActions}
                        onRename={(returnFocus) => onRenameSession(session, returnFocus)}
                        onClose={(returnFocus) => onDeleteSession(session, returnFocus)}
                      />
                    </MotionListItem>
                  );
                })}
              </MotionList>
            </LayoutGroup>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
