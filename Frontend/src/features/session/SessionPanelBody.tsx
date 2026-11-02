import { AppIcon, IconButton, ScrollArea, StateView } from "../../shared/ui";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import type { SessionListEntry } from "../../store/selectors/chatSelectors";
import { EmptyState } from "./SessionRows";
import { SessionChannelList } from "./SessionChannelList";

interface SessionPanelBodyProps {
  compactFrame?: boolean;
  sessions: readonly SessionListEntry[];
  totalSessionCount: number;
  catalogSynced: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  activeSessionId: string | null;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (session: SessionListEntry, returnFocus: HTMLElement | null) => void;
  onDeleteSession: (session: SessionListEntry, returnFocus: HTMLElement | null) => void;
  selectionMode: boolean;
  selectedSessionIds: ReadonlySet<string>;
  selectedSessionCount: number;
  onToggleSelectionMode: () => void;
  onToggleSessionSelection: (sessionId: string) => void;
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
  activeSessionId,
  onNewSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  selectionMode,
  selectedSessionIds,
  selectedSessionCount,
  onToggleSelectionMode,
  onToggleSessionSelection,
  onToggleVisibleSelection,
  onDeleteSelected,
}: SessionPanelBodyProps): JSX.Element {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", compactFrame ? "px-0 pb-0" : "px-2 pb-2")}>
      <div className="mb-3 flex min-w-0 shrink-0 items-center gap-1.5">
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
            className="h-9 w-full rounded-[10px] border border-line-subtle bg-surface-raised pl-8 pr-8 text-[12px] text-content-primary outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-content-muted focus:border-accent-border-strong focus:ring-2 focus:ring-accent-focus"
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
        {totalSessionCount > 0 ? (
          <IconButton
            label={frontendMessage(selectionMode ? "session.cancelSelection" : "session.startSelection")}
            tooltip={frontendMessage(selectionMode ? "session.cancelSelection" : "session.startSelection")}
            size="md"
            tone={selectionMode ? "primary" : "muted"}
            onClick={onToggleSelectionMode}
          >
            <AppIcon icon={selectionMode ? "close" : "list-checks"} className="h-4 w-4" />
          </IconButton>
        ) : null}
      </div>

      {selectionMode ? (
        <div
          className="mb-2 flex min-h-8 shrink-0 items-center gap-2 border-b border-line-subtle pb-2 text-[11px] text-content-muted"
          data-session-selection-toolbar
        >
          <input
            type="checkbox"
            aria-label={frontendMessage("session.selectVisible")}
            checked={sessions.length > 0 && sessions.every((session) => selectedSessionIds.has(session.sessionId))}
            ref={(node) => {
              if (!node) return;
              const selectedVisibleCount = sessions.filter((session) =>
                selectedSessionIds.has(session.sessionId),
              ).length;
              node.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < sessions.length;
            }}
            onChange={onToggleVisibleSelection}
            disabled={sessions.length === 0}
            className="h-3.5 w-3.5 shrink-0 accent-content-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
          />
          <span className="min-w-0 flex-1 truncate">
            {frontendMessage("session.selectedCount", { count: selectedSessionCount })}
          </span>
          <IconButton
            label={frontendMessage("session.deleteSelected")}
            tooltip={frontendMessage("session.deleteSelected")}
            size="sm"
            tone="danger"
            disabled={selectedSessionCount === 0}
            onClick={onDeleteSelected}
          >
            <AppIcon icon="trash" className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        <div className="pb-2">
          {totalSessionCount === 0 ? (
            catalogSynced ? (
              <EmptyState onNewSession={onNewSession} />
            ) : (
              <StateView status="loading" className="min-h-[200px] px-4" />
            )
          ) : (
            <>
              {sessions.length === 0 ? (
                <StateView
                  status="empty"
                  className="min-h-[120px] px-3"
                  description={frontendMessage("session.searchEmpty")}
                />
              ) : null}
              <SessionChannelList
                sessions={sessions}
                activeSessionId={activeSessionId}
                revealAll={Boolean(query.trim()) || selectionMode}
                selectionMode={selectionMode}
                selectedSessionIds={selectedSessionIds}
                onSelectSession={onSelectSession}
                onToggleSessionSelection={onToggleSessionSelection}
                onRenameSession={onRenameSession}
                onDeleteSession={onDeleteSession}
              />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
